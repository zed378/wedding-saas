# P0-15 — Queue and worker skeleton

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-15 |
| **Phase** | Phase 0 |
| **Surface** | worker, infra |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-15-queue-worker-skeleton` |
| **Status** | Completed |

---

## What Changed

A worker process separate from the API, with three pools, a job catalogue carrying every retry policy, an atomic idempotency guard, a dead-letter queue, and cron leader election. 21 tests, 15 of them against a real Redis.

## Why

Three of this task's guarantees are the kind that look fine until they are not: a webhook processed twice takes money twice, a permanently failed job that vanishes takes an upload with it, and two cron instances send every couple two reminder emails. None of the three produces an error.

## How

**One job catalogue, not a retry count beside each handler.** `jobs.ts` holds every job with its pool, priority, attempts, backoff and — explicitly — whether a permanent failure dead-letters. `docs/ARCHITECTURE/07` says a failed **high or medium** job "must never be silently dropped", so `priority` decides that rather than being decoration. A test asserts the rule directly.

`analytics_counter_flush` is the one job allowed to lose work, because the document says "best-effort, safe to drop". Written as `deadLetter: false` with a comment, so a dropped batch reads as a decision rather than a bug — and so nobody copies the line onto a job where losing work matters.

**The idempotency guard is one atomic operation, not the document's two.** `docs/BACKEND/08` § Idempotency Pattern shows:

```
if (await checkIdempotencyKey(key)) return;
await doWork(data);
await markProcessed(key);
```

Correct in spirit, racy as written: two workers can both pass the check before either marks. For a payment webhook that credits an order twice. `SET key value NX EX` makes the check and the claim one operation — exactly one caller wins.

That inverts the failure mode, so the inversion is handled rather than ignored. Claiming *before* the work means a crash leaves a key marking work that never happened. The claim therefore holds a 15-minute lease, made durable only on success; a crash lets it lapse and the retry proceeds.

**A failed attempt releases its claim.** Without that, "retry 3 times" becomes "try once, then no-op twice, then dead-letter" — which produces exactly the same logs as three genuine failures.

**Leader election is a lease, and the record says what that is not.** It reduces duplicate cron execution; it is not consensus. Under a Redis failover with unsynchronised replicas two instances can briefly both believe they lead. The mitigation that actually matters is the one the documents already require — every job idempotent — so a duplicate run is a no-op rather than a second effect.

**Schedules are registered on gaining leadership and removed on losing it**, so a follower holds no timers at all rather than holding timers it declines to act on. The scheduler id is stable, so re-registering replaces rather than duplicates.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/worker/src/jobs.ts` | The catalogue: pools, retries, dead-letter decisions, cron patterns |
| `backend/worker/src/idempotency.ts` | Atomic claim, durable mark, release on failure |
| `backend/worker/src/runner.ts` | Wrapping, DLQ, the six documented observability fields |
| `backend/worker/src/leader-election.ts` | Redis lease with Lua acquire-or-renew |
| `backend/worker/src/main.ts` | Entry point, pool required with no default, graceful shutdown |
| `backend/worker/src/handlers/` | Registry (deliberately near-empty) and the example job |
| `backend/worker/src/logger.ts` | The worker's own logger — see the limitation below |
| `backend/worker/Dockerfile` | Multi-stage, non-root, no healthcheck |
| `deploy/docker-compose.yml` | Three worker services; **media pool CPU and memory capped** |
| `.env.example` | `REDIS_URL`, `WORKER_POOL` |
| `backend/worker/test/` | 6 unit, 15 integration |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| `SET NX` rather than the document's check-then-mark | The documented shape is racy, and the race is the normal case for a webhook | — |
| A short lease made durable on success | Claiming before the work would let a crash suppress the retry | — |
| Release the claim on failure | Otherwise retries no-op and look like genuine failures | — |
| One catalogue with explicit `deadLetter` per job | "Which jobs can drop work?" should have one readable answer | — |
| Dead-letter only on the final attempt | Otherwise one job produces three DLQ entries and pages twice | — |
| Cron schedules carry `tz: Asia/Jakarta` | A UTC container would run "00:05 WIB" seven hours late, every day | — |
| Pool is required, no default | A guess is either "media unprocessed" or "cron runs three times" | — |
| Handlers deliberately not stubbed | A no-op stub reports success; an unregistered job stays visibly queued | — |
| `msgpackr-extract` native build denied | Optional accelerator with a JS fallback; verified by running the queue | — |

## Deviations from `docs/`

**One, and it is an improvement on the document rather than a departure from its intent.** `docs/BACKEND/08` § Idempotency Pattern shows check-then-mark as two operations. That is racy. The implementation collapses them into `SET NX`, which is what the pattern is trying to achieve. The document was not amended: it describes the intent correctly and the pseudocode is illustrative.

## Tests Added

6 unit (`pnpm test`, no infrastructure) and 15 integration (`test:integration`, real Redis).

| Group | Cases |
|---|---|
| Catalogue | every job has a pool, retry policy and explicit dead-letter decision; **every high/medium job dead-letters**; only `analytics_counter_flush` may drop; unregistered name refused; documented retry counts; documented WIB cron times |
| Idempotency | **ten concurrent claims, exactly one wins**; completed vs in-progress distinguished; release unblocks a retry; a completed key is not released; keys scoped by job name |
| Runner | **replayed job does its work once**; wrong-pool registration refused |
| Retry and DLQ | **exactly the configured attempts, then dead-letters**; the DLQ entry keeps its payload and error; **dead-letters once, not per attempt**; a retry that succeeds does not dead-letter; **a job with an idempotency key still retries fully** |
| Leader election | **one leader among three instances**; leadership passes on shutdown; re-registering a schedule three times leaves one |

**Mutation-checked**, three times:

| Mutation | Result |
|---|---|
| Non-atomic claim (`GET` then `SET`) | `lets exactly one caller claim a key` failed |
| Removed `release()` on failure | `still retries the full number of times when the job HAS an idempotency key` failed |
| Dead-letter on every attempt | 4 tests failed |

The second mutation is why that test exists. I noticed while reviewing that the original retry test used no idempotency key, so the release path was never exercised end to end — which is precisely the payment-webhook case. Added it, and the mutation confirms it is the only test that catches a missing release.

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| A replayed webhook does its work once | `docs/ARCHITECTURE/07` § Principles | Concurrent-claim test, mutation-checked |
| A failed high/medium job is never silently dropped | `docs/ARCHITECTURE/07` | Catalogue assertion plus an end-to-end DLQ test |
| The media pool cannot starve the stack | `docs/BACKEND/04` § Resource Isolation, `docs/SECURITY/06` layer 6 | CPU and memory limits on `worker-media` in compose; the Helm chart already caps it |
| Two cron instances do not double-execute | `docs/BACKEND/08` | Three-instance election test |
| A worker cannot alter the schema it reads | `P0-06` | Uses `DATABASE_URL`, the unprivileged role |

**A real limitation, stated plainly**: the worker's logger does **not** redact. `P0-12`'s redactor lives in `@wi/api` and the worker cannot import across the package boundary yet. The worker therefore logs only fields it constructs — job names, ids, durations, error messages — and never a whole payload. That is a discipline rather than a mechanism, which is exactly what `docs/DEVOPS/06` says redaction must not rely on. Extracting a shared logging package is the fix and it belongs to `P0-19`.

## Definition of Done Verification

- [x] The worker runs as its own process and scales without the API — own binary, own Dockerfile, three compose services
- [x] A job replayed with the same key does its work once — proven end to end
- [x] A permanently failing job reaches the DLQ, and depth is exposed via `deadLetterDepth()` for `docs/DEVOPS/07`
- [x] Two cron instances execute a scheduled job once — three instances, one leader
- [x] The media pool has CPU and memory limits

## What Did Not Work

**BullMQ 6 removed the repeatable-job API I wrote against.** `repeat: { pattern, tz }` and `getRepeatableJobs()` are gone, replaced by `upsertJobScheduler` and `getJobSchedulers`. Found by typecheck, fixed by reading the installed `.d.ts` rather than guessing from memory. The replacement is better for this use: an explicit scheduler id makes re-registration idempotent, which is exactly what leadership changes need.

**TypeScript proved one of my tests could not fail.** `filter(j => !j.deadLetter && j.priority !== "low")` narrowed to `never` — with literal types from `as const`, the compiler can *prove* no non-low job is droppable. That is a stronger guarantee than the assertion, and it was also a build error. Widened to `JobPolicy[]` so the runtime check survives as a guard against a future edit that breaks the invariant without anyone noticing the type stopped proving it.

**`pnpm test` broke because the worker's tests needed Redis.** The rule from `P0-07` is that the default test command works on a laptop with nothing started. Split into `jobs.spec.ts` (pure) and `queue.itest.ts` (real Redis), matching the API's convention — and the integration suite fails rather than skips when Redis is missing.

**`ioredis` has no default export under NodeNext.** `import IORedis from "ioredis"` typechecks as a namespace and is not constructable. `import { Redis as IORedis }` is correct.

## Follow-Ups and Open Questions

- **Almost no handlers are registered**, deliberately. `media.process` is `P1-17`, `payment.webhook_process` is `P3-05`, `notification.send` is `P4-06`, the cron sweeps are `P4-*`. A no-op stub would report success while doing nothing, which is worse than an unregistered job staying visibly queued.
- **The worker logger does not redact.** Extract a shared logging package in `P0-19`.
- **`deadLetterDepth()` is a function, not a metric endpoint.** `P0-23` should expose it to Prometheus so `docs/DEVOPS/07`'s alert has something to read.
- **The API does not enqueue anything yet.** `enqueueEnvelope` from `P0-12` and `JobPayload` here have the same shape by construction, not by a shared type. `P1-17` should unify them.
- **Nothing consumes the DLQ.** Entries accumulate by design — the queue *is* the record — but there is no replay tool. `P6-*` should add one.

## What to Watch

**The lease is not consensus, and the comment saying so will be read as excessive caution.** Two instances can briefly both lead during a Redis failover. What makes that safe is idempotency, not the lock — so a future job that is *not* idempotent silently depends on a guarantee this file does not provide.

**`deadLetter: false` is one word and it will be copied.** It exists for the single job the document permits to lose work. On any other job it converts a paged alert into silence, and the diff will look like a policy tweak.

**The claim lease is 15 minutes.** A media job on a very large file that legitimately runs longer would have its lease lapse mid-work, and a retry would start a second transform of the same file. Both would succeed and one would overwrite the other. Nothing currently runs that long; `P1-17` should check its own worst case against this number.
