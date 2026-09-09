# 07 - Payment Security

## Concept Separation (Must Be Understood)
```
Order → Payment → Payment Provider → Payment Callback (webhook) → Invoice → Entitlement (paid/published status)
```
Each arrow is a SEPARATE process with a different source of truth; there MUST NOT be any shortcut that skips verification.

## The Golden Rule
> `payment_success` MUST NOT be equated with a `user_request_parameter`.

This means: payment status may **only** come from:
1. An official webhook from the provider with a VERIFIED signature, OR
2. The server directly polling/querying status from the provider's API (server-to-server, never trusting anything from the browser).

NEVER from:
- A redirect URL query parameter (`?transaction_status=success`) — this is purely for display purposes and can be manipulated by anyone who knows the format.
- A request body from the frontend claiming "payment is complete."
- Any local storage/client state.

## Webhook Signature Verification
- Each provider (Midtrans/Xendit) has a different signature mechanism (e.g., Midtrans: SHA512 of `order_id+status_code+gross_amount+server_key`) — implementation MUST follow the active provider's official documentation, and MUST be verified BEFORE any logic runs.
- A webhook request with an invalid signature: respond 401, log it as a security event, do NOT process the payload at all.

## Idempotency
- The `payments.provider_reference_id` UNIQUE constraint (see DATABASE/08) — a webhook received multiple times (a provider retry is normal) must not produce duplicate effects (double-crediting, double notifications).

## PCI-DSS Scope
- The system NEVER touches/stores raw credit card numbers — all card input happens on the provider's own page/official embedded SDK (redirect or embedded), not a custom form owned by the application. This minimizes the PCI-DSS compliance scope to the lightest level (SAQ A/A-EP depending on the integration).

## Pricing
- `amount_total` is ALWAYS calculated server-side from the `packages`/`addons` table (DATABASE/07) when the order is created — the client never sends the price. This prevents price manipulation (altering the request body to pay a cheaper amount).

## Refund
- Only via a manual admin endpoint (API/09), no self-service automatic refunds from the user — reduces refund fraud risk.

## Logging Sensitive Data
- `raw_callback_payload` (DATABASE/08) is stored for auditing, but fields that potentially contain card data/extensive financial PII are reviewed and redacted before being logged to a separate log system (DEVOPS/06-LOGGING.md) — the payment database may store the full payload (restricted access), but the application log (which may have broader access) must NOT.

## Timeout & Expiry
- A `pending` order expires (e.g., after 24 hours) → an automatic job sets it to `expired` (BACKEND/08-JOBS-WORKERS.md); if a "success" webhook arrives AFTER the order has already expired in the system, it should still be processed as valid (a late-payment edge case is recorded), but flagged specially for manual review if this happens.
