# P0-13 — Readiness checks Redis too

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-13 (gap found after completion) |
| **Phase** | Phase 0 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `fix/P0-13-readyz-checks-redis` |
| **Status** | Completed |
| **Spec** | Not required |

---

## What Changed

`/readyz` now probes Redis as well as PostgreSQL, through the rate limiter's own client.
Four tests, three of them new.

## Why

`docs/DEVOPS/05` § Health Check has named both since before any of this was built:

> The health check verifies connectivity to critical dependencies (**DB, Redis**) without
> performing heavy operations.

Only the database was ever checked. The cost became concrete during the first Phase 1
staging deploy: the rate limiter could not issue a command to Redis, every credential
endpoint was failing closed with 503, and `/readyz` answered
`{"status":"ok","checks":{"database":"ok"}}` throughout. The container reported healthy
while a dependency carrying rate limiting, the cache and the job queue was unreachable to
the code that needed it.

This is a **specification gap**, not a design change. The document asked for it; the
implementation did half of it.

## How

**It probes the limiter's client, not one of its own.** That is the whole of the design
decision here, and it comes directly from what `P1-07` turned out to be: the Redis
*server* was healthy and reachable from inside the same container — a raw socket `PING`
returned `+PONG` — while the *application's* client could not issue a command. A probe
that opened its own connection would have answered `ok` throughout, exactly as the
database-only version did, and this fix would have bought nothing.

Checking the client the application actually depends on is what makes it a readiness check
rather than a network test.

**A Redis failure is a 503**, which is the document's plain reading: it lists Redis as a
critical dependency. Worth writing down that nothing acts on this automatically — the
container `HEALTHCHECK` calls `/health`, and this host has no load balancer to remove the
service from. It is an operator and monitor signal, and the point is that it is an honest
one.

**Liveness is untouched.** Redis being down is not a reason to restart a process that is
running correctly, and a liveness probe that checked dependencies would turn one outage
into a restart loop.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/http/health.controller.ts` | Injects `RATE_LIMIT_REDIS`; a second check |
| `backend/api/test/integration/health.itest.ts` | Harness takes a Redis client; a new describe for the redis-down case |

## Decisions Made

| Decision | Rationale |
|---|---|
| Probe the limiter's client | A private connection reports on the server, not on the application's ability to use it — and would have missed `P1-07` entirely |
| Redis failure is 503, not a "degraded" 200 | `docs/DEVOPS/05` calls it critical. A 200 with a field nobody parses is how this was missed the first time |
| Liveness unchanged | A dependency check in liveness restarts healthy processes during a dependency blip |
| The body still names only *which*, never *why* | Unchanged from `P0-13`: an unauthenticated probe that names a port or an error code is free reconnaissance |

## Deviations from `docs/`

None. This closes one.

## Tests Added

3 new, 1 rewritten. Integration total 767 → 770.

| Test | What it pins |
|---|---|
| `"answers 200 with each dependency named"` | Now asserts `{database: "ok", redis: "ok"}` — an exact object, so a silently dropped check fails it |
| **`"answers 503 rather than ok"`** | Redis unreachable, database fine — the staging state exactly |
| **`"names redis as the dependency that is down, and says the database is not"`** | The two are distinguished, and neither leaks a port or an error code |
| **`"liveness still answers ok"`** | Redis being down does not make the process restartable |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| The readiness body discloses no infrastructure detail | `docs/DEVOPS/05` § Health Check | `expectNoInternalLeak`, plus explicit assertions that the body contains neither `59998` nor `ECONNREFUSED` |
| The check is actually wired in | — | **Mutation**: the `redis` line removed from the checks array. Caught by **4 named tests**, including `"answers 503 rather than ok"` |

## Abuse Cases Covered

- An unauthenticated caller reading `/readyz` for host, port or driver detail. It gets the
  name of a dependency and nothing else.

## DoD Verification

`P0-13`'s own DoD is unchanged. This record exists because the task was `DONE` while one
half of a two-part requirement was missing.

## What Did Not Work

**Nothing, in the doing — the interesting failure is that this was written down and still
missed.** `docs/DEVOPS/05` names Redis in the same sentence as the database. The
implementation checked one, the tests asserted the one it checked, and everything was
green for two phases. It took a deployment producing a 503 on a healthy system to make
anyone read the sentence again.

That is a different failure mode from the usual one in this project, and worth separating:
most defects here were **tests that verified less than their names claimed**. This was a
**test that verified exactly what the code did**, while the code did less than the
specification said. No mutation test would have found it, because the code and its tests
agreed. Only the document disagreed.

## Follow-Ups and Open Questions

- **MinIO and the queue are still unchecked.** `docs/DEVOPS/05` names DB and Redis
  specifically, so this satisfies it — but object storage is a dependency of every upload,
  and the queue's client is a separate connection from the limiter's. Adding them means
  deciding whether a storage outage should take the API out of rotation, which is a
  product question about degraded operation rather than a technical one.
- **The queue's Redis client has the same options as the limiter's** (`P1-07`'s record).
  It is BullMQ-managed and not covered by this check.
- **Nothing probes staging from outside.** Synthetic monitoring has been unblocked since
  `P0-23` and remains undone; a probe on `/readyz` after each deploy is what would have
  reported this without a person looking.

## What to Watch

**`/readyz` can now fail for a reason that does not stop the product working.** With the
limiter's fail-open policy, most endpoints keep serving with Redis down — so an
unavailable readiness response does not mean the site is down. Anyone wiring an alert to
this should page on it differently from a database failure, which genuinely does stop
everything.
