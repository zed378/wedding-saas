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
    "package_id": "premium",
    "addons": ["custom_domain"],
    "amount_total": 250000,
    "status": "pending",
    "expired_at": "2026-06-10T10:00:00Z"
  }
}
```

## Critical Rules
- `amount_total` is ALWAYS recalculated server-side from `package_id`/`addon_ids` against the official price table when the request is received — the client never sends a price amount.
- A `pending` order whose `expired_at` has passed automatically becomes `expired` via a job (BACKEND/08-JOBS-WORKERS.md); the GET endpoint always returns the current status (not the status at creation time). The same job returns the invitation from `pending_payment` to `draft` (BR-5.3).

## Error Cases
- 409 `ACTIVE_ORDER_EXISTS` — if there is already an active `pending` order for the same invitation (direct the user to continue the old order rather than creating a new one).
- 422 `INVITATION_NOT_READY` — if the invitation's data prerequisites are incomplete (optional; this can also be checked only at publish time, an implementation decision).
