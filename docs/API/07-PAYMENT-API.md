# 07 - Payment API

## Client-Facing Endpoints
```
POST   /api/v1/orders/:order_id/payment          Initiates payment, response contains a redirect_url/snap_token from the provider
GET    /api/v1/orders/:order_id/payment/status     Poll for the current status (the server checks the provider if needed, not just reading a stale DB value)
```

## Webhook Endpoint (Server-to-Server, NOT called by the browser)
```
POST   /api/webhooks/payment/:provider            A dedicated endpoint that receives callbacks from the payment gateway
```

## Initiation Flow
1. `POST /orders/:order_id/payment` (no body) → the backend locks the caller's order, checks it is `pending` and before `expired_at`, and commits a `Payment` row with status `pending`, the order's `amount_total` and a fresh `provider_reference_id` — **before** calling the provider, so a notification can never arrive for a payment the database does not know.
2. With nothing locked, the backend calls the provider with that reference, the amount from the order row, and the customer's name and email only → receives a checkout URL and token, stored on the row.
3. The client response contains only the info needed to redirect/render the widget — there is NO "success" status in this response:
   ```json
   { "success": true, "data": { "redirect_url": "https://…", "token": "…", "expires_at": "2026-06-10T10:00:00Z" } }
   ```
   `token` (not `snap_token`): the response does not name the provider (ADR-075). `expires_at` is the order's payment deadline.
4. **Repeating the request returns the same payment page** while that payment is `pending` and the order is payable (ADR-076). Two live pages for one order is how a customer pays twice.

Errors: 404 `NOT_FOUND` (not the caller's order); 422 `ORDER_NOT_PAYABLE` (not `pending`, or past `expired_at`); 409 `PAYMENT_IN_PROGRESS` (another request is mid-call to the provider for this order); 503 `PAYMENT_UNAVAILABLE` (provider down or unconfigured — order and invitation are untouched; try again).

## Webhook Flow (Critical — see SECURITY/07-PAYMENT-SECURITY.md)
1. The provider POSTs to `/api/webhooks/payment/:provider` with a signed payload. **Where the signature lives is provider-specific**: Midtrans puts it in the JSON body as `signature_key`, computed with the merchant **server key** — there is no signature header and no separate webhook secret (P3-03, ADR-075).
2. The backend **MUST verify the signature** with the provider's documented algorithm before processing anything.
3. The backend looks up the `Payment` record by `provider_reference_id` (idempotency: if the status is already `success`, return 200 with no further effect).
4. If the signature is valid & the new status is `success`: in a SINGLE DB transaction — update `Payment.status`, `Order.status = paid`, `Invitation.status = paid`; enqueue an invoice notification.
5. Response to the provider: 200 OK quickly (< 5 seconds) — heavy processing (email, etc.) is offloaded to a queue, not processed synchronously inside the webhook handler.
6. If the signature is INVALID → 401, logged as a potential fraud attempt (SECURITY/12).

**As implemented (P3-05, ADR-077):**
- **Every arrival is recorded** in `payment_notifications` (DATABASE/08) before processing, forged ones with `signature_valid = false`. A forged notification never touches the payment row it claims.
- **200 for every verified notification**, whatever it did — applied, duplicate, unknown reference, amount mismatch, late payment, refund notification — so the provider stops retrying. The ones a human must look at are flagged `needs_review` and alerted on.
- **401** for a forged, tampered, unsigned or malformed one. **404** when `:provider` is not the configured gateway. **500** only when processing failed and rolled back, so the provider retries.
- A verified **failure** sets the order `failed` and the invitation back to `draft` (BR-5.3) unless another payment attempt for that order is still live. A verified success **after the order expired** is applied and flagged (SECURITY/07 § Timeout & Expiry).
- Not rate limited and not behind user authentication; the signature is the authentication.

## Status Polling
```json
GET /api/v1/orders/:order_id/payment/status
{
  "success": true,
  "data": { "order_status": "paid", "payment_status": "success", "paid_at": "2026-06-01T10:05:00Z" }
}
```
This endpoint is safe to call repeatedly by the frontend after redirecting back from the gateway (to show the "Payment Successful" page) — BUT it is never the source of the DECISION about status (only displaying a result that has already been decided by the webhook flow).

## Explicit Prohibition
> It is STRICTLY FORBIDDEN to change the Order/Invitation status based on a browser redirect query parameter (`?status=success`). The redirect URL is only for UX (display purposes), not a source of truth for data.
