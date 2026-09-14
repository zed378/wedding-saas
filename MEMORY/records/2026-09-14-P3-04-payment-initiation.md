# P3-04 — Payment Initiation Endpoint

| | |
|---|---|
| **Task** | `P3-04` |
| **Date** | 2026-09-14 |
| **Branch** | `feat/P3-04-payment-initiation` |
| **Status** | DONE |
| **Spec** | [`MEMORY/specs/P3-04-payment-initiation.md`](../specs/P3-04-payment-initiation.md) |

---

## What changed

- **`POST /api/v1/orders/:order_id/payment`** (`PaymentController` → `PaymentService`), returning
  `{ redirect_url, token, expires_at }`.
- **`OrderService.withPayableOrder`** — the order module's owner-scoped, locked "may this be paid now"
  (404 / 422 `ORDER_NOT_PAYABLE`), so the payment module never reads `orders` itself.
- **`PaymentRepository`** — pending lookup with an in-flight age from the database clock, insert, store
  checkout, mark a dead initiation failed.
- **Migration `0011`**: `payments.checkout_url`, `payments.checkout_token`.
- `ServiceUnavailableError` takes a code (`PAYMENT_UNAVAILABLE`).

## Why

`docs/API/07` § Initiation Flow; the webhook (`P3-05`) needs a payment row to match.

## How

Spec § 9 and ADR-076: lock → decide → commit row → call provider unlocked → store checkout or mark failed.

## Files and Components Touched

- New: `src/modules/payment/{payment.controller.ts, payment.service.ts, payment.repository.ts}`, `migrations/0011_payment_checkout{.sql,.down.sql}` + snapshot, `test/payment-http.spec.ts`, `test/integration/payment-initiation.itest.ts`, `MEMORY/specs/P3-04-payment-initiation.md`
- Changed: `src/modules/payment/payment.module.ts`, `src/modules/order/order.service.ts`, `src/shared/tenancy/order-repository.ts`, `src/infra/db/schema/orders.ts`, `src/http/errors.ts`, `test/support/phase-one-tenant.ts` (a pending order on the second invitation), `test/integration/idor-sweep.itest.ts`
- Docs: `docs/API/07`, `docs/DATABASE/08`

## Decisions Made

ADR-076.

## Deviations from `docs/`

`docs/API/07` said `snap_token`; the response uses `token` (provider-neutral) and adds `expires_at`.
`docs/DATABASE/08` gains two columns. Both amended.

## Tests Added

| Test | Proves |
|---|---|
| `payment-initiation.itest.ts` (14) | Row with the order's amount, reference shape ≤ 50 chars, exact response keys, gateway received order amount + name/email only; row committed while the provider call is still open; second initiation reuses page with one provider call; concurrent initiation → one call + 409; dead in-flight row recovered; retryable and refused outages → 503, order `pending`, invitation `pending_payment`, row `failed`, retry works; paid/expired/failed/refunded orders and a pending order past its deadline → 422 with no call; another user's order → 404 with no call and no row; malformed/unknown id → 404 |
| `payment-http.spec.ts` (7) | 201 envelope with no status/paid/success text; any body field → 400 without calling the service; 503 friendly message; 401 |
| `idor-sweep.itest.ts` (+1 case) | `POST /orders/:order_id/payment`: attack 404, owner control, no token 401 |

**Mutation run**: making `markInitiationFailed` a no-op failed 3 tests (dead-initiation recovery and both
outage cases).

## Security Verification

- IDOR: `payment-initiation.itest.ts` › "answers another user's order with 404, calling nothing and
  writing nothing"; `idor-sweep.itest.ts` › "POST /orders/:order_id/payment answers a non-owner with 404
  and no data".
- Server-decided amount: gateway input asserted in the first itest; body refused in the HTTP spec.
- No status in the response: HTTP spec test named above.
- PII minimisation: gateway `customer` asserted to be exactly name and email.

## Abuse Cases Covered

Spec § 11, all with named tests.

## Definition of Done Verification

All four card items checked with named tests. `pnpm verify` passed; integration suite 37 files / 974 tests passed; `db:roundtrip` passed with migration `0011`.

## What Did Not Work

Nothing failed on the first run. The design changed before code: the first sketch held the order lock
across the provider call, rejected because it is the pool-starvation shape `P3-02` had just found.

## Follow-Ups and Open Questions

- `P3-05` must handle a `success` notification for a payment initiation marked `failed` (the provider
  created the transaction but we timed out) as a late payment for review, not ignore it.
- Snap page expiry is not aligned with `orders.expired_at` yet (`P3-03` follow-up).
- Not exercised against the Midtrans sandbox (no key here).

## What to Watch

`payment.initiated` with `reused: true` share: a high share means customers are coming back to the page,
which is expected; `PAYMENT_IN_PROGRESS` spikes mean slow provider responses.
