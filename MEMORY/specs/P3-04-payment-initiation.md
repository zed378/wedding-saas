# P3-04 — Feature Spec: Payment Initiation

| | |
|---|---|
| **Task** | `P3-04` |
| **Date** | 2026-09-14 |
| **Author** | Claude (autonomous run) |
| **Status** | Implemented |

---

## 1. Goal

`POST /api/v1/orders/:order_id/payment` gives the owner of a pending, unexpired order a place to pay —
a checkout URL and token from the gateway — records a `pending` payment row before answering, and says
nothing a client could read as "paid".

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/07` | Client-Facing Endpoints, Initiation Flow | Endpoint; payment row `pending` with `provider_reference_id`; response only what the client needs, no success status |
| `docs/BACKEND/05` | Payment Initiation | Owned order; guard `pending` and `expired_at > now()`; amount from the order row; name + email |
| `docs/SECURITY/07`, `SECURITY/09` | Golden rule; Third-Party Data Sharing | No status from the client; minimum PII |
| `docs/UI-UX/13` | Error Handling UX | Friendly retryable message on provider failure |
| `docs/DATABASE/08` | payments | Columns, unique `(provider, provider_reference_id)` |
| ADR-075 | — | Port and `provider_reference_id` |

**Gap**: repeating the request. A second click, a refresh, a second tab — `docs/` does not say whether
each makes a new provider transaction. Each one would be a live payment page for the same order, and a
customer who pays on two of them pays twice. Resolved in ADR-076 by reusing the pending payment's
checkout, which needs two nullable columns the schema does not have (`checkout_url`,
`checkout_token`) — migration `0011`, `docs/DATABASE/08` amended.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-5.2 | Status never from the client | Response has no status; nothing here writes `success` |
| `SECURITY/07` § Pricing | Amount from the DB | `payments.amount` and the gateway amount both = `orders.amount_total` from the locked row |

## 4. API Contract

- `POST /api/v1/orders/:order_id/payment`, authenticated, no body (any body field is 400).
- `201 { success: true, data: { redirect_url, token, expires_at } }` — `expires_at` is the order's
  payment deadline, for the countdown. **No status field** (card DoD 3).
- Errors: 404 `NOT_FOUND` (not the caller's, nonexistent, malformed); 422 `ORDER_NOT_PAYABLE` (not
  `pending`, or past `expired_at`); 409 `PAYMENT_IN_PROGRESS` (another initiation for this order is
  talking to the provider right now); 503 `PAYMENT_UNAVAILABLE` with a friendly Indonesian message
  (provider down, timeout, unconfigured).
- `docs/API/07`'s "`redirect_url`/`snap_token`" becomes `redirect_url` and `token`: the response must
  not name the provider (ADR-075).

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `orders` | Read, locked `FOR UPDATE` owner-scoped | Short transaction, never across the provider call |
| `payments` | Insert `pending`; update checkout columns; mark `failed` when the provider refuses | |

Migration `0011`: `payments.checkout_url TEXT NULL`, `payments.checkout_token VARCHAR(255) NULL`.
Expand-only.

## 6. Authorization

`OrderRepository.withLockedOwnedOrder(orderId, scope)` — `WHERE id = :order_id AND user_id = :scope
FOR UPDATE`. No row → 404. Customer name and email come from the authenticated user, loaded from the
database by the session layer. The `payment` module reaches the order only through the `order` module's
service (`docs/BACKEND/01`).

## 7. Validation and Sanitization

`:order_id` UUID-shaped before any query (else 404). Body must be empty or `{}`. No free text.

## 8. State Transitions

None for orders or invitations. A `payments` row: inserted `pending`; set `failed` only if the provider
refused or could not be reached for **this** initiation (the row never became a provider transaction
we can show anyone). Not a webhook decision and never `success`.

## 9. Side Effects

1. **Transaction A** (short): lock the order; decide reuse / in-progress / new; insert the `pending`
   payment row with a fresh `provider_reference_id` (`<order uuid>-<8 hex>`, 45 characters, within
   Midtrans's 50). Commit.
2. **Outside any transaction**: `createTransaction` with the order's amount and the user's name/email.
3. Success: store `checkout_url`/`checkout_token` on the row. Failure: mark the row `failed`, 503.

The row exists before the response (card DoD 2) and before the provider can send a notification about
it. The provider call is outside the lock so a slow provider cannot hold database connections (the
pool-starvation lesson from `P3-02`).

**Reuse (ADR-076)**: a `pending` payment for this order with a stored checkout is returned as-is. A
`pending` payment with no checkout yet, younger than 30 s, is another request mid-call → 409. Older
than that, it is an initiation that died between steps 1 and 3 → marked `failed`, and a new one starts.

## 10. Failure Modes

- Provider down / timeout: row `failed`, order and invitation untouched, 503 retryable message.
- Crash between 1 and 3: row stays `pending` without a checkout; recovered by the 30 s rule.
- Provider created the transaction but we timed out: our row is `failed`; if the customer somehow pays
  it, `P3-05` treats a success for a `failed` payment as a late payment for review.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Paying another user's order | `SECURITY/05` | 404, no row, no provider call | `payment-initiation.itest.ts` › "answers another user's order with 404…"; IDOR sweep |
| Amount in the body | `SECURITY/07` | 400 | `payment-http.spec.ts` › "refuses any body field" |
| Paying an expired or paid order | `BACKEND/05` | 422, no provider call | `payment-initiation.itest.ts` › "refuses an order that is not payable…" |
| Opening many payment pages for one order | ADR-076 | Same checkout returned; one provider transaction | "a second initiation returns the same checkout without calling the provider" |
| Concurrent initiations | ADR-076 | One provider call; the other 409 | "two concurrent initiations call the provider once" |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit (HTTP) | 201 shape with no status key; body refused; 503 mapping; auth |
| Integration | Row before response with amount from order; gateway got the order amount and name+email only; reuse; concurrency; stale in-flight recovered; provider outage leaves order/invitation untouched and row failed; not payable (paid, expired status, past deadline); IDOR; malformed id |
| Security | IDOR sweep case |

## 13. Observability

`payment.initiated` (info: order, payment, reference, reused). Provider errors come from the adapter.

## 14. Open Questions

None blocking. Snap page expiry is not yet aligned to `orders.expired_at` (Snap `expiry` option
unconfirmed, `P3-03` follow-up); the reuse rule stops at the order's deadline regardless.
