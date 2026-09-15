# P3-07 — Feature Spec: Order Expiry and the Late-Payment Case

| | |
|---|---|
| **Task** | `P3-07` |
| **Date** | 2026-09-15 |
| **Author** | Claude (autonomous run) |
| **Status** | Implemented |

---

## 1. Goal

A pending order past its `expired_at` becomes `expired` and its invitation returns to `draft` with a
history row, on a 15-minute schedule — and the user never has to wait for that schedule to check out
again. A payment that succeeds after expiry is still honoured and flagged (built in `P3-05`; proven here
against the real job).

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/BACKEND/08` | Scheduled jobs | `order_expire_check` every 15 minutes |
| `docs/PLAN/09` | § Order Expiry | Expired if `expired_at` passed with no successful payment; a new order any time after |
| `docs/PLAN/02` | BR-5.3 | Order `expired`, invitation stays/returns `draft`, user can order again |
| `docs/API/06` | Critical Rules | The expiry job also returns the invitation `pending_payment → draft` |
| `docs/SECURITY/07` | § Timeout & Expiry | A success after expiry is processed as valid, flagged |
| ADR-077, ADR-078 | — | Late payment edge; domain jobs in the API jobs process |

**Gap closed here**: `P3-02` recorded that a pending order past its deadline blocks a new checkout
(`ACTIVE_ORDER_EXISTS`) until the job runs — up to 15 minutes of "you already have an order" for an order
that can no longer be paid. The card's DoD 4 ("create a new order immediately after expiry") is met by
expiring such an order inline, through the same code, when checkout finds it.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-5.3 | Expired order → invitation `draft`, order again | `OrderService.expireOrder` (job and checkout) |
| `SECURITY/07` § Expiry | Late success honoured, flagged | `OrderService.settlePaid` (`P3-05`) |

## 4. API Contract

No new endpoint. `POST /invitations/:id/orders` changes behaviour: a pending order already past its
deadline is expired inline and the new order is created (201) instead of 409.

## 5. Data Model Impact

None. Reads and conditionally updates `orders`; status history through the status service.

## 6. Authorization

The job is a system actor (no user). Checkout's inline expiry runs under the caller's invitation lock,
on the caller's own order.

## 7. Validation and Sanitization

Not applicable.

## 8. State Transitions

`orders`: `pending → expired`, only if `expired_at <= now()` (database clock), conditional on still
`pending`. `invitations` (for `new_publish`): `pending_payment → draft`, SYSTEM, reason
"order expired"; skipped if the invitation is elsewhere. `renewal` orders: invitation untouched. Pending
`payments` rows are left as they are: a late success notification for one is processed by the webhook's
late-payment path.

## 9. Side Effects

`wi_orders_expired_total{order_type}`; `order.expired` info log per order; job summary log.

## 10. Failure Modes

**Lock order**: the job locks order then invitation — the same order as the webhook (payment → order →
invitation), so they queue rather than deadlock. It selects due orders with `FOR UPDATE SKIP LOCKED`, so
an order a webhook is settling right now is skipped this run and picked up next time (or paid).
Checkout already holds the invitation lock, so its inline expiry takes the order with `SKIP LOCKED` too:
if a webhook holds it, checkout answers `ACTIVE_ORDER_EXISTS` rather than risk a deadlock. A failed run
retries in 15 minutes; the job is idempotent by its conditional updates.

## 11. Abuse Cases

| Abuse case | Expected behaviour | Test name |
|---|---|---|
| Payment succeeds after the job expired the order | Applied, flagged | `order-expiry.itest.ts` › "a late success after the job ran is honoured and flagged" |
| Job runs twice / concurrently | One transition | "is idempotent: a second run changes nothing", "two concurrent runs expire each order once" |

## 12. Test Plan

Integration: due vs not-yet-due; history row; renewal untouched; invitation elsewhere skipped; idempotent and
concurrent runs; immediate re-checkout (inline expiry) including history; late success after the job;
domain job registered and scheduled. Unit: job contract spec covers `order_expire_check`.

## 13. Observability

`wi_orders_expired_total`, `order.expired`, job summary.

## 14. Open Questions

A second pending order created after an expired one, then a late success on the first: flagged
(`late_payment`) by the webhook; the second order stays pending and payable — a person reviewing the flag
decides whether to refund. Recorded, not automated.
