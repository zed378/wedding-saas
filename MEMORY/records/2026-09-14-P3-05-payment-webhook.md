# P3-05 — Payment Webhook: Signature, Idempotency, Transaction

| | |
|---|---|
| **Task** | `P3-05` |
| **Date** | 2026-09-14 |
| **Branch** | `feat/P3-05-payment-webhook` |
| **Status** | DONE |
| **Spec** | [`MEMORY/specs/P3-05-payment-webhook.md`](../specs/P3-05-payment-webhook.md) |

---

## What changed

- **`POST /api/webhooks/payment/:provider`** (`PaymentWebhookController` → `PaymentWebhookService`): the
  only code path that grants a paid invitation.
- **Migration `0012`**: `payment_notifications`, one row per arrival, forged ones included; application
  role can insert/select, update only four processing columns, never delete.
- **`OrderService.settlePaid` / `settleFailed`** — the order module applies a verified outcome inside the
  webhook's transaction (order + invitation), so the payment module still never touches invitations.
- **State machine**: `draft → paid`, SYSTEM only, for a late payment.
- **Metrics**: `shared/metrics` counter registry, `GET /metrics` behind `METRICS_TOKEN`, three payment
  counters; `deploy/prometheus/alerts.yml` with `PaymentWebhookInvalidSignatures` and `PaymentNeedsReview`.
- **Rate-limit exemption** corrected from the nonexistent `/api/v1/webhooks/` to `/api/webhooks/`.

## Why

Card goal; `docs/SECURITY/07`'s golden rule; the four gaps in ADR-077.

## How

Spec § 8–9. Record the arrival → verify (invalid: metric, security log, 401) → one transaction (lock
payment, amount check, outcome table, mark processed) → after commit, enqueue `notification.send`
`order_paid` only if this delivery made the order paid.

## Files and Components Touched

- New: `src/modules/payment/{payment-webhook.controller.ts, payment-webhook.service.ts}`, `src/shared/metrics/{metrics.ts, metrics.controller.ts, metrics.module.ts}`, `migrations/0012_payment_notifications{.sql,.down.sql}` + snapshot, `deploy/prometheus/alerts.yml`, `test/{payment-webhook-http.spec.ts, metrics.spec.ts}`, `test/integration/payment-webhook.itest.ts`, `MEMORY/specs/P3-05-payment-webhook.md`
- Changed: `src/modules/payment/{payment.repository.ts, payment.module.ts}`, `src/modules/order/order.service.ts`, `src/shared/tenancy/order-repository.ts`, `src/shared/invitation-status/invitation-status.service.ts`, `src/shared/rate-limit/policies.ts`, `src/infra/db/schema/orders.ts`, `src/config/env.schema.ts` (`METRICS_TOKEN`), `src/app.module.ts`, `backend/worker/src/handlers/index.ts` (comment), `.env.example`
- Tests changed: `test/integration/rate-limit.itest.ts` (real webhook path), `test/integration/audit-status.itest.ts` (new edge), `test/idor-sweep-inventory.spec.ts` (exemption with named tests)
- Docs: `docs/API/07`, `docs/DATABASE/08`, `docs/PLAN/06`, `docs/DEVOPS/07`; `P3-13` card obligation

## Decisions Made

ADR-077.

## Deviations from `docs/`

Four documents amended (above). The card's step 1 asked for the raw body preserved for signature
verification; the configured provider (Midtrans) signs **fields of the parsed body** (ADR-075), so the
raw bytes are not needed and are not captured. A provider that signs raw bytes will need the port widened
to take them.

## Tests Added

| Test | Proves |
|---|---|
| `payment-webhook.itest.ts` (22) | Success pays payment/order/invitation with a SYSTEM history row and queues exactly one `order_paid`; forged → 401, nothing changed, recorded, metric +1; unsigned → 401; tampered → 401; forged claim on a real paid payment leaves its row byte-identical; oversized/non-object forged payloads not stored; unconfigured provider → 404, nothing recorded; 5 sequential and 5 concurrent deliveries → one change, one job; success then failed/pending → no downgrade; failure mid-transaction → payment, order, invitation, history all unchanged, arrival kept unprocessed, retry applies; unknown reference → 200 flagged; amount mismatch → nothing granted, flagged; success after expiry → applied, `draft → paid`, flagged; second success on a paid order → `duplicate_charge`, not granted twice; refund notification → flagged, untouched; renewal → order paid, invitation untouched; failure → order failed + draft; failure with another live attempt → order stays pending; pending → method recorded; < 5 s with job queued; application role cannot delete or rewrite a notification but can mark it processed |
| `payment-webhook-http.spec.ts` (4) | Reaches the service with no Authorization header; 200 / 401 / 404 / 500 mapping without leaking internals |
| `metrics.spec.ts` (8) | Counter exposition and escaping; `/metrics` with token → 200; no/wrong/bare token → 404; unset token → 404; alert rule present; every metric in `alerts.yml` is registered |
| `audit-status.itest.ts` (+1) | `draft → paid` refused for USER and ADMIN, allowed for SYSTEM |
| `rate-limit.itest.ts` (changed) | The real webhook path is exempt |

**Mutation runs**: removing the early duplicate check failed both idempotency tests. **Removing the
payment row lock was NOT caught** — the concurrent deliveries did not overlap closely enough, and the
conditional updates held. In response the service now also checks the conditional update's result, and a
run removing the lock, the early check and the update condition together fails both idempotency tests.
The lock's specific contribution remains untested by an assertion; it is kept as a guard.

## Security Verification

- Forged/unsigned/tampered notifications change nothing: `payment-webhook.itest.ts` › "a forged success
  changes nothing, answers 401, is recorded and counted", "a notification without a signature is refused
  the same way", "a genuine notification tampered to a success changes nothing".
- A forger cannot overwrite the genuine record: "a forged notification naming a real payment does not touch it".
- Exactly once: "the same success delivered five times…", "five concurrent deliveries…".
- Atomicity: "a failure mid-transaction rolls back payment, order and invitation together".
- Only SYSTEM may pay: `audit-status.itest.ts` › "refuses pending_payment -> paid from a user", "…from an
  ADMIN too", "allows draft -> paid only from SYSTEM…".
- Evidence is tamper-resistant from the app: "cannot delete a notification, nor rewrite what arrived…".
- Metrics not public: `metrics.spec.ts` › "answers 404 with …".

## Abuse Cases Covered

All six card rows plus spec § 11, each with its named test (card table).

## Definition of Done Verification

All five items checked on the card with named tests. `pnpm verify` passed; integration suite 38 files / 997 tests passed; `db:roundtrip` passed with migration `0012`.

## What Did Not Work

- **The rate-limit exemption had pointed at a path that does not exist since `P1-07`**, and its test
  asserted the invented path, so it passed. The real webhook would have been limited as a public endpoint
  and could have dropped Midtrans retries under load.
- **The lock mutation survived** (above) — recorded rather than hidden.
- A long shell heredoc with nested quoting failed to parse and ran nothing; files were rewritten with the
  editor tool.

## Follow-Ups and Open Questions

- **`P3-13`**: apply paid renewal orders (obligation written on its card).
- **`P3-07`**: after a late payment, a second pending order created in between is flagged, not cancelled.
- **`P3-06`**: a webhook that failed with 500 and was never retried is recovered by reconciliation.
- **Staging**: set `METRICS_TOKEN`, deploy Prometheus with `deploy/prometheus/alerts.yml`, and set the
  Midtrans notification URL to `https://app.vizunicum.my.id/api/webhooks/payment/midtrans`.
- Not exercised against the Midtrans sandbox (no key).

## What to Watch

`PaymentWebhookInvalidSignatures` (fraud or a key mismatch after rotation); `PaymentNeedsReview` (every
one needs a person); `payment_notifications` rows with `result IS NULL` older than a minute (processing
failures the provider may not retry).
