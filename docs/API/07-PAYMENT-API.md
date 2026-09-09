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
1. `POST /orders/:order_id/payment` → the backend calls the provider's API (Midtrans/Xendit) with `order_id`, `amount`, `customer_detail` → receives a `redirect_url` or `snap_token`.
2. A `Payment` record is stored with status `pending`, and the `provider_reference_id` from the provider.
3. The client response contains only the info needed to redirect/render the widget — there is NO "success" status in this response.

## Webhook Flow (Critical — see SECURITY/07-PAYMENT-SECURITY.md)
1. The provider POSTs to `/api/webhooks/payment/:provider` with a payload + signature header.
2. The backend **MUST verify the signature** using the secret key before processing anything.
3. The backend looks up the `Payment` record by `provider_reference_id` (idempotency: if the status is already `success`, return 200 with no further effect).
4. If the signature is valid & the new status is `success`: in a SINGLE DB transaction — update `Payment.status`, `Order.status = paid`, `Invitation.status = paid`; enqueue an invoice notification.
5. Response to the provider: 200 OK quickly (< 5 seconds) — heavy processing (email, etc.) is offloaded to a queue, not processed synchronously inside the webhook handler.
6. If the signature is INVALID → 401, logged as a potential fraud attempt (SECURITY/12).

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
