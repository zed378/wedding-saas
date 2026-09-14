# P3-02 — Order Creation

| | |
|---|---|
| **Task** | `P3-02` |
| **Date** | 2026-09-14 |
| **Branch** | `feat/P3-02-order-creation` |
| **Status** | DONE |
| **Spec** | [`MEMORY/specs/P3-02-order-creation.md`](../specs/P3-02-order-creation.md) |

---

## What changed

- **`POST /api/v1/invitations/:id/orders`** (`OrderController` → `OrderService` → `OrderRepository`).
  Verified email required; body `.strict()` `{ package_id, addon_ids }`; optional `Idempotency-Key`.
  Creates a `pending` order priced by `PricingService`, `expired_at = now() + 24h` from the database
  clock, and moves a draft to `pending_payment` with a history row — all in one transaction holding
  the invitation row lock.
- **Migration `0010`**: `idx_orders_one_pending`, a partial unique index (answers `OQ-18`).
- **`InvitationStatusService.transitionWithin(tx, …)`**: the transition inside a caller's transaction;
  `transition` now wraps it.
- **Three defects found on the way and fixed** (below): pool starvation, log redaction of `to`, 500s on
  malformed ids.

## Why

`docs/API/06`, BR-2.2, ADR-022. The next Phase 3 tasks (payment initiation, webhook) need an order.

## How

`OrderRepository` lives in `shared/tenancy/` because it locks an `invitations` row, which the tenancy
guard permits only there. `withLockedInvitation` runs a callback holding the lock with the pending
order read after it; the service decides order type, prices, inserts, transitions and writes the
idempotency record inside that callback. Details and the state table: spec § 8, ADR-074.

## Files and Components Touched

- New: `src/modules/order/{order.controller.ts, order.service.ts, order.module.ts}`, `src/shared/tenancy/order-repository.ts`, `migrations/0010_one_pending_order{.sql,.down.sql}` + `meta/0010_snapshot.json`, `test/order-http.spec.ts`, `test/integration/order-create.itest.ts`, `MEMORY/specs/P3-02-order-creation.md`
- Changed: `src/infra/db/schema/orders.ts` (index), `src/shared/invitation-status/invitation-status.service.ts` (`transitionWithin`), `src/modules/order/{pricing.service.ts, catalog.repository.ts}` (tx-bound catalogue), `src/http/errors.ts` (`ConflictError` details), `src/http/exception.filter.ts` (malformed uuid → 404), `src/shared/sanitizer/registry.ts` (`package_id`, `addon_ids`), `src/app.module.ts`
- `packages/logging/src/{redact.ts, logging.spec.ts}` (ambiguous email keys)
- Tests: `test/integration/idor-sweep.itest.ts` (orders case; malformed-id case), `test/support/phase-one-tenant.ts` (tenant row verified to match its token), `test/http-contract.spec.ts` (22P02 probes)
- Docs: `docs/API/06`, `docs/DATABASE/07`, `TASKS/BACKLOG.md` (`OQ-18`), Phase 1 card (P1-02 obligation)

## Decisions Made

ADR-074: lock + index; server-derived order type; extra body fields 400; Redis idempotency written
inside the transaction; pricing on the transaction's connection.

## Deviations from `docs/`

- `docs/API/06` amended: `order_type` in the response, request rules, idempotency, error codes.
- `docs/DATABASE/07` amended: the partial unique index.
- Card abuse case "`amount_total` … ignored" implemented as **refused (400)**.

## Tests Added

| Test | Proves |
|---|---|
| `order-create.itest.ts` (18) | Draft → order priced from the row, 24 h window, `pending_payment`, history row with actor; pricing refusal writes nothing; renewal for published/expired without transition; paid → 422; lapsed `pending_payment` recovers; 409 names the existing order; 2 and 10 concurrent checkouts → exactly one order; index refuses a bypassing insert and allows non-pending rows; key replay → same order; concurrent same-key → same order; key reuse → 422; keys namespaced per user; Redis down → 409 naming the order, no duplicate; unverified → 403 writing nothing; non-owner → 404 changing nothing; deleted / non-UUID / unknown → 404 |
| `order-http.spec.ts` (17) | 201 envelope and numeric amount; `amount_total`, `amount`, `price`, `order_type`, `status`, `user_id` in the body → 400 without calling the service; malformed bodies → 400; key passed through; malformed key → 400; unverified → 403; no token → 401 |
| `idor-sweep.itest.ts` (+2 cases) | `POST /invitations/:id/orders` in the attack, cross-tenant and owner-control passes; every invitation route answers a malformed id with 404 |
| `http-contract.spec.ts` (+2) | 22P02 for a uuid → 404 with the ordinary body; 22P02 for another type → still 500 |
| `logging.spec.ts` (+2) | A status `to` stays readable; an address under `to` is still masked; unambiguous email keys still mask anything |

**Mutation runs**: removing `FOR UPDATE` failed "two concurrent requests with one key both get the one
order" (the index still prevented a duplicate — defence in depth working as designed). Disabling the
22P02 mapping made 26 invitation routes answer 500 in the new sweep case.

## Security Verification

- **Object-level authorization**: `order-create.itest.ts` › "answers another user's invitation with
  404, and changes nothing" and `idor-sweep.itest.ts` › "POST /invitations/:id/orders answers a
  non-owner with 404 and no data" (plus the owner-control case).
- **Server-decided price**: body refusal (`order-http.spec.ts`) and row-priced total (`order-create.itest.ts`).
- **One pending order**: concurrency tests and the index test named above.
- **Email verification gate**: named above; closes the checkout half of `P1-02` DoD item 3.
- **State transition logged**: history row asserted in the happy-path test.

## Abuse Cases Covered

Spec § 11 — every row has its named test.

## Definition of Done Verification

All five card items checked with named tests. `pnpm verify` passed; integration suite 36 files / 958 tests passed; `db:roundtrip` passed with migration `0010`.

## What Did Not Work

- **Pricing inside the transaction deadlocked under concurrency.** The first run hung at "ten concurrent
  checkouts": each request held a pooled connection for its transaction and asked the same pool for a
  second one to read `packages`. With a 5-connection pool, five transactions waited forever for each
  other. Production's pool of 10 fails the same way at ten simultaneous checkouts — a launch-day
  failure mode. Fixed by reading the catalogue on the transaction's own connection.
- **The log redactor had been masking every status transition's `to` since `P0-14`.** `to` is in the
  email key list (for mail jobs), so `invitation status changed` logged `to: "*************nt"`. The
  one log line that explains why an invitation changed state was unreadable. Fixed for values without
  an `@`; addresses under `to` are still masked.
- **Every invitation `:id` route answered a malformed id with 500** and an error-level log, because the
  path string reached Postgres and failed the uuid cast. Found while adding a UUID check to the order
  service; fixed once in the exception filter and swept across all 26 routes.
- Test mistakes: queried `invitation_status_history.changed_at` (the column is `created_at`); the
  first malformed-id sweep included `/media/:mediaId`, which does not take an invitation id.

## Follow-Ups and Open Questions

- `P3-07`: an expired pending order currently still blocks a new checkout until the job marks it
  `expired`; the job must run often enough that this is not visible.
- `P3-08`: a trial invitation's first payment is a `renewal` order; the invoice should not say renewal.
- `P3-09`: owes the publish half of `P1-02` DoD item 3.
- `OQ-28` still blocks `P3-14`.

## What to Watch

- `order.created` volume against payment initiations (`P3-04`): a gap is abandoned checkouts.
- Any `ACTIVE_ORDER_EXISTS` spike: a client that is not resuming the existing order.
