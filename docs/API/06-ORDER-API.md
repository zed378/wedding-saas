# 06 - Order API

```
POST   /api/v1/invitations/:id/orders          { package_id, addon_ids: [] }
GET    /api/v1/orders                           List orders owned by the current user
GET    /api/v1/orders/:order_id                 Order detail (including the current payment status)
GET    /api/v1/orders/:order_id/invoice          Download the invoice PDF (after paid)
```

## Flow
1. `POST /invitations/:id/orders` → the backend validates that the invitation belongs to the user, and that the invitation isn't already `paid`/`published` for a "new publish" type order (for renewal, a different endpoint/flag is used — see PLAN/09).
2. Create an `Order` with status `pending`, calculating `amount_total` from the `package + addons` (price fetched from the server's master data, NOT from client input — preventing price manipulation).
3. In the same transaction as the order insert, the order service transitions the invitation `draft → pending_payment` (BR-2.2) and writes the `invitation_status_history` row. The transition belongs to order creation, not to the payment step: the invitation is awaiting payment from the moment an order exists, and a status written in a later step could be lost if the user abandons the flow between the two.
   For `order_type = 'renewal'` there is no transition — the invitation stays `published` or `expired` until the renewal is paid (PLAN/10 § Renewal).
4. The response contains the `order_id` + the data the frontend needs to redirect to the Payment API (07-PAYMENT-API.md).

## Example Response
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "invitation_id": "uuid",
    "package_id": "standard",
    "addons": [],
    "amount_total": 139000,
    "order_type": "new_publish",
    "status": "pending",
    "expired_at": "2026-06-10T10:00:00Z"
  }
}
```

`order_type` is decided by the server from the invitation's status (P3-02, ADR-074): `draft` (or a `pending_payment` invitation whose last order lapsed) → `new_publish`; `published` or `expired` → `renewal`. The client never sends it.

## Request

- Body: exactly `package_id` (string) and optional `addon_ids` (array of strings, at most 10). Any other field — including `amount_total` — is refused with 400 `VALIDATION_ERROR` rather than ignored.
- Header: optional `Idempotency-Key` (1–255 visible ASCII characters, `docs/API/00`). A repeat of the same key by the same user for the same invitation and selection returns the same order with 201 for 24 hours. The same key for a different invitation or selection is 422 `IDEMPOTENCY_KEY_REUSED`.
- Requires a verified email: 403 `EMAIL_NOT_VERIFIED` (API/01).

## Critical Rules
- `amount_total` is ALWAYS recalculated server-side from `package_id`/`addon_ids` against the official price table when the request is received — the client never sends a price amount.
- A `pending` order whose `expired_at` has passed automatically becomes `expired` via a job (BACKEND/08-JOBS-WORKERS.md); the GET endpoint always returns the current status (not the status at creation time). The same job returns the invitation from `pending_payment` to `draft` (BR-5.3).

## Error Cases
- A `pending` order already past its `expired_at` is **not** active: checkout expires it on the spot (order `expired`, invitation `pending_payment → draft` with a history row, the same code as the 15-minute sweep) and creates the new order, rather than making the user wait for the sweep (P3-07).
- 409 `ACTIVE_ORDER_EXISTS` — if there is already an active `pending` order for the same invitation (direct the user to continue the old order rather than creating a new one). `error.details[0]` is `{ "field": "order_id", "message": "<existing order id>" }`. Guaranteed by a row lock and the partial unique index `idx_orders_one_pending` (DATABASE/07, ADR-074).
- 422 `ORDER_NOT_ALLOWED` — the invitation is `paid` and not yet published: there is nothing to buy; publish it.
- 422 `PACKAGE_NOT_AVAILABLE` / `ADDON_NOT_AVAILABLE` — unknown or inactive catalogue ids (P3-01).
- 404 `NOT_FOUND` — not the caller's invitation, deleted, nonexistent, or not a UUID.
- 422 `INVITATION_NOT_READY` — if the invitation's data prerequisites are incomplete (optional; this can also be checked only at publish time, an implementation decision).
