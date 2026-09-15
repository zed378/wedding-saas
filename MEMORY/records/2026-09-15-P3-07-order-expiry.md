# P3-07 — Order Expiry Job and the Late-Payment Case

| | |
|---|---|
| **Task** | `P3-07` |
| **Date** | 2026-09-15 |
| **Branch** | `feat/P3-07-order-expiry` |
| **Status** | DONE |
| **Spec** | [`MEMORY/specs/P3-07-order-expiry.md`](../specs/P3-07-order-expiry.md) — written before the code |

---

## What changed

- **`OrderService.expireOverdueOrders()`** — the `order_expire_check` sweep, registered in `DOMAIN_JOBS`
  (consumed by the API jobs process, scheduled every 15 minutes by `worker-cron`).
- **Checkout expires an overdue pending order inline** through the same `expireIfOverdue`, then creates
  the new order — closing the `P3-02` follow-up where such an order answered `ACTIVE_ORDER_EXISTS` until the
  sweep ran.
- `OrderRepository`: `overdueOrderIds`, `lockOverdueOrder` (`FOR UPDATE SKIP LOCKED`), `transaction`;
  `withLockedInvitation` now reports `pendingOverdue` by the database clock.
- Metric `wi_orders_expired_total{order_type}`.

## Why

Card goal; BR-5.3; `docs/PLAN/09` § Order Expiry; `docs/SECURITY/07` § Timeout & Expiry.

## How

Spec § 8 and § 10. Lock order: order → invitation, as the webhook; `SKIP LOCKED` wherever the caller might
already hold the invitation or a webhook might hold the order, so neither path waits into a deadlock.

## Files and Components Touched

- Changed: `src/modules/order/order.service.ts`, `src/shared/tenancy/order-repository.ts`, `src/shared/metrics/metrics.ts`, `src/jobs/domain-jobs.ts`, `backend/worker/src/jobs.ts` (comment)
- New: `test/integration/order-expiry.itest.ts`, `MEMORY/specs/P3-07-order-expiry.md`
- Docs: `docs/API/06` (overdue order is not active), `docs/PLAN/09` § Order Expiry

## Decisions Made

Inline expiry at checkout (spec § 2 gap); `SKIP LOCKED` for both sweep and checkout. Both within ADR-078's
frame; no new ADR.

## Deviations from `docs/`

Card surface says `worker`; the job runs in the API jobs process (ADR-078). `docs/API/06` and `PLAN/09`
amended for the inline expiry.

## Tests Added

| Test | Proves |
|---|---|
| `order-expiry.itest.ts` (8) | Overdue → expired + `draft` + SYSTEM history row + metric; not due → untouched; renewal expired without touching the invitation; second run changes nothing; two concurrent runs expire each once; immediate re-checkout after the deadline (expiry and new order in one transaction); not-yet-due pending still 409; late success after the real sweep → `paid`, flagged |
| `domain-jobs.spec.ts` / `domain-jobs.itest.ts` | Now also cover `order_expire_check`: scheduled by the worker, no worker handler, runs in the booted context |

No mutation run was recorded for this task.

## Security Verification

- Late payment honoured and flagged: `order-expiry.itest.ts` › "a late success after the job ran is honoured and flagged".
- System-only status changes: the sweep uses the SYSTEM actor through the status service (`check-status-writes` still passes).

## Abuse Cases Covered

Spec § 11 with named tests.

## Definition of Done Verification

All four card items checked with named tests. `pnpm verify` passed; integration suite 41 files / 1022 tests passed.

## What Did Not Work

- The first re-checkout test asserted history rows in `created_at` order; the expiry and the new checkout
  share one transaction, so `now()` is identical for both and the order is undefined. It passed by luck;
  changed to an order-insensitive assertion before it could flake.

## Follow-Ups and Open Questions

- **The API jobs process has no dead-letter queue**, while the catalogue marks `order_expire_check`
  `deadLetter: true`. A failed run is retained in BullMQ's failed set (`removeOnFail: 100` from the
  scheduler) and the next run 15 minutes later retries; a real DLQ with the worker's alerting is owed
  before launch (`P6`).
- A new pending order created between an expiry and a late success stays payable; the late success is
  flagged for a person.

## What to Watch

`wi_orders_expired_total` rising against `order.created` — checkout abandonment or payment-page trouble.
