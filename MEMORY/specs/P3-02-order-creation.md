# P3-02 — Feature Spec: Order Creation

| | |
|---|---|
| **Task** | `P3-02` |
| **Date** | 2026-09-14 |
| **Author** | Claude (autonomous run) |
| **Status** | Implemented |

---

## 1. Goal

An owner with a verified email can check out an invitation: `POST /api/v1/invitations/:id/orders`
creates one `pending` order whose `amount_total` comes from `PricingService` (`P3-01`), moves a
draft to `pending_payment` in the same transaction, and never creates a second pending order —
not for a double click, not for two tabs, not for a retried request.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/06` | Endpoint, Flow, Critical Rules, Error Cases | `{ package_id, addon_ids }`; server-computed total; draft → `pending_payment` in the order transaction; renewal performs no transition; 409 `ACTIVE_ORDER_EXISTS` |
| `docs/API/00` | § Idempotency, § 403 vs 404 | Optional `Idempotency-Key` on create order; non-owner 404 |
| `docs/API/01` | step 2 | Checkout requires `email_verified` → 403 `EMAIL_NOT_VERIFIED` |
| `docs/DATABASE/07` | § Notes | Snapshot `amount_total`; one pending order per invitation, checked in the service |
| `docs/PLAN/09` | § Order Flow | `expired_at = now + 24h` |
| `docs/PLAN/06`, BR-2.2, BR-5.1, BR-5.3 | — | Checkout transition; one order = one invitation + one package |
| `docs/SECURITY/07` | § Pricing | Client never sends a price |
| ADR-022, ADR-052 | — | Order service owns `draft → pending_payment`; a trial invitation can be paid for |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-2.2 | Checkout → `pending_payment` | `OrderService.create`, via `InvitationStatusService.transitionWithin` in the order transaction |
| BR-5.1 | One invitation, one package, optional addons | Request schema; `PricingService` |
| `DATABASE/07` | One pending order per invitation | Row lock + service check, **and** partial unique index (ADR-074, answers `OQ-18`) |
| `SECURITY/07` | Server price | `PricingService`; `.strict()` body refuses any extra field |

## 4. API Contract

- `POST /api/v1/invitations/:id/orders`, authenticated.
- Headers: optional `Idempotency-Key` — 1–255 visible ASCII characters.
- Body (`.strict()`): `package_id` string 1–30; `addon_ids` array of strings 1–30, max 10, default `[]`.
  **Any other field — `amount_total`, `order_type`, `status` — is a 400**, following every other
  controller's `.strict()` convention. The card's abuse case says "ignored"; refusing is stricter and
  still never uses the value (deviation noted in the record).
- `201`:
  ```json
  { "success": true, "data": { "id": "uuid", "invitation_id": "uuid", "package_id": "standard",
    "addons": [], "amount_total": 139000, "order_type": "new_publish", "status": "pending",
    "expired_at": "…" } }
  ```
  `order_type` is added to `docs/API/06`'s example (the checkout needs to label a renewal).
  A replay with the same `Idempotency-Key` returns the same order, 201.
- Errors:
  - 400 `VALIDATION_ERROR` — body shape, extra fields, malformed key, repeated addon.
  - 403 `EMAIL_NOT_VERIFIED`.
  - 404 `NOT_FOUND` — not the caller's, deleted, or nonexistent.
  - 409 `ACTIVE_ORDER_EXISTS` — `details[0]` is `{ field: "order_id", message: <existing id> }`.
  - 422 `PACKAGE_NOT_AVAILABLE`, `ADDON_NOT_AVAILABLE` (`P3-01`).
  - 422 `ORDER_NOT_ALLOWED` — the invitation is `paid` (nothing to buy: publish it).
  - 422 `IDEMPOTENCY_KEY_REUSED` — the key was used for a different invitation or selection.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `invitations` | Read (locked), Write status via status service | Owner-scoped `FOR UPDATE` |
| `orders` | Read pending, Insert | Snapshot `amount_total`, `expired_at = now() + 24h` |
| `invitation_status_history` | Insert | Via status service, same transaction |
| `packages`, `addons` | Read | `PricingService` |

Migration required: **yes** — `0010`, partial unique index `idx_orders_one_pending ON
orders(invitation_id) WHERE status = 'pending'`. Additive; no existing row can violate it because no
order-creating code existed before this task. `docs/DATABASE/07` amended.

## 6. Authorization

- Authenticated (`requireAuth`), then `requireVerifiedEmail` in the service (a property of the
  caller; reveals nothing about a resource).
- Ownership at the query: `SELECT … FROM invitations WHERE id = :id AND owner_id = :scope AND
  deleted_at IS NULL FOR UPDATE` in `OrderRepository` (`shared/tenancy/`). No row → 404.
- The order's `user_id` is the scope, never a body field.
- The idempotency cache key includes the user id; a replay loads the order with `user_id = :scope`.
- No nested ids. No admin path.

## 7. Validation and Sanitization

- Structural: Zod at the controller. `package_id` and `addon_ids` are identifiers, registered in
  `NOT_USER_TEXT`.
- Business: status suits an order; no pending order; package/addons available.
- Not accepted: amount, order type, status, user id, expiry.

## 8. State Transitions

| Invitation status | Order type | Transition |
|---|---|---|
| `draft` | `new_publish` | `draft → pending_payment`, actor USER, in the order transaction |
| `pending_payment` (no pending order — an expiry left it behind) | `new_publish` | none |
| `paid` | — | 422 `ORDER_NOT_ALLOWED` |
| `published`, `expired` | `renewal` | none (`docs/API/06` step 3) |

A trial invitation (BR-2.8, never paid) is `published` or `expired`, so by the card's rule its first
payment is a `renewal` order. Mechanically correct — `P3-05` then extends `expiry_date` or moves
`expired → published` — but an invoice would call a first purchase a renewal. Flagged for `P3-08`.

## 9. Side Effects

- `invitation_status_history` row, inside the transaction.
- Idempotency record in Redis (`CachePort`, namespace `idem:orders`, 24h TTL), written **inside**
  the transaction while the invitation row is locked, so a concurrent replay that waits on the lock
  finds it. If the transaction then fails, the record points at a nonexistent order and is ignored.
- `order.created` info log. No cache to invalidate; no job.

## 10. Failure Modes

- Redis down: `CachePort` never throws; the replay degrades from "same order" to 409
  `ACTIVE_ORDER_EXISTS` naming the same order. No duplicate is possible: the lock and index hold.
- Two requests racing: the row lock serialises them; the second sees the pending order → 409. If the
  lock were ever bypassed, the index turns the second insert into 23505 → 409.
- Pricing failure: nothing locked, nothing written.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| `amount_total` in the body | `SECURITY/07` | 400, no order | `order-http.spec.ts` › "refuses an amount in the body without calling the service" |
| Order against another user's invitation | `SECURITY/05` | 404, no order, no transition | `order-create.itest.ts` › IDOR case; `idor-sweep.itest.ts` › `POST /invitations/:id/orders` |
| Parallel double checkout | `DATABASE/07` | One order, one 409 | `order-create.itest.ts` › "two concurrent checkouts make one order and one 409" |
| Retried request | `API/00` | Same order | `order-create.itest.ts` › "a repeated Idempotency-Key returns the same order" |
| Key reused for another invitation | — | 422, nothing created | `order-create.itest.ts` › "refuses a key reused for a different invitation" |
| Unverified email | `API/01` | 403 | `order-create.itest.ts` › "refuses an unverified user"; `order-http.spec.ts` |
| Second pending order bypassing the service | `OQ-18` | 23505 | `order-create.itest.ts` › "the database refuses a second pending order" |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit (HTTP) | Body strictness; key header shape; 201 envelope and number `amount_total`; auth required |
| Integration | Draft → order + transition + history; amount equals row; `expired_at` ≈ +24h; renewal for published and expired without transition; paid → 422; pending → 409 with id; recovered `pending_payment`; inactive addon → nothing written; concurrency with and without keys; replay; key reuse; unverified; IDOR; index |
| Security | IDOR sweep case; sanitizer registry check; `:id` guard |

## 13. Observability

`order.created` (info: order id, invitation id, user id, type, amount). 409s and 422s are client
errors logged by the HTTP layer.

## 14. Open Questions

- `OQ-18` answered by ADR-074 (both service check and index), as the backlog entry itself proposed.
- Trial invitation's first payment is typed `renewal` (§ 8) — for `P3-08`.
