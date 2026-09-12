# P1-07 — The rate limiter's cold start

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-07 (defect found after completion) |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `fix/P1-07-rate-limiter-cold-start` |
| **Status** | Completed |
| **Spec** | Not required |

---

## What Changed

`RateLimitModule` now opens its Redis connection in `onModuleInit`, before the application
accepts a request. Five tests, two of which fail if that call is removed.

## Why

**Found by deploying, not by a test.** The first `POST /api/v1/auth/register` against the
freshly deployed staging stack answered **503 SERVICE_UNAVAILABLE**. The same call a minute
later answered **201**. Redis was healthy, on the same compose network, and reachable from
inside the API container — a raw socket `PING` from that container returned `+PONG`.

The log said exactly what had happened, and it took reading to believe:

```
rate_limit.config_refresh_failed   reason: Error
rate_limit.unavailable  policy: register  action: fail_closed
```

The limiter refused a credential endpoint because it could not reach Redis. That is
**ADR-050 working correctly**. The bug is that it could not reach Redis.

## How

`rate-limit.module.ts` builds its client with both of these:

```ts
lazyConnect: true,          // no socket until something needs one
enableOfflineQueue: false,  // never hold a command while disconnected
```

Each is right on its own, and each is there for a stated reason. Lazy keeps a unit test
from opening a socket nothing will use. Refusing to queue is what makes ADR-050's decision
**reachable at all** — a queued command would wait for the connection instead of failing,
and the limiter would hold the request open rather than deciding anything.

Together they mean the **first** command is rejected outright: lazy says "no connection
yet", the empty offline queue says "and I will not wait for one", and ioredis fails it with
*Stream isn't writeable*. The connection then establishes in the background, which is why
the retry succeeds and why this looks like a transient network fault.

The fix is one `await this.redis.connect()` at module init, guarded on
`status === "wait"` because calling `connect()` on an already-connecting client throws.

**A failure there does not stop the application.** Redis being unreachable is a state this
subsystem is designed to survive — fail closed on credential endpoints, open elsewhere —
and refusing to boot would turn a degraded service into an outage. It logs
`rate_limit.initial_connect_failed` and carries on.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/shared/rate-limit/rate-limit.module.ts` | `OnModuleInit`, the guarded connect, and the log line for a failure |
| `backend/api/test/integration/rate-limit.itest.ts` | 5 tests across two new describes |

## Decisions Made

| Decision | Rationale |
|---|---|
| Connect at init rather than dropping `lazyConnect` | `lazyConnect: false` connects at construction but does not **wait**, so the race survives with a smaller window — which is worse, because it would fail intermittently rather than always |
| Keep `enableOfflineQueue: false` | It is the reason ADR-050's fail-open/fail-closed decision is reachable. Queuing would make the limiter hold requests open during an outage |
| A failed initial connect logs and continues | Refusing to boot converts "degraded" into "down" for a subsystem whose whole design is about surviving this |
| Assert the hazard as its own test | `"is rejected outright when nothing connected first"` pins the behaviour the guard exists for. If future client options make it pass, the test says the guard is no longer needed rather than protecting nothing |

## Deviations from `docs/`

None. `docs/SECURITY/10` and ADR-050 describe the behaviour that was already correct; this
is a connection-lifecycle bug underneath them.

## Tests Added

5. Integration total 762 → 767.

| Test | What it pins |
|---|---|
| `"is rejected outright when nothing connected first"` | The hazard itself, with the production client options |
| `"succeeds when the module connected at startup"` | That `connect()` is the whole of the fix |
| `"a limiter on a connected client answers its first check"` | The property the guard depends on — a *decision*, not just a working command |
| **`"hands the guard a client that is already ready"`** | Boots the real `AppModule` and asks the container for the client the guard will actually use |
| **`"answers the FIRST request to a credential endpoint, rather than 503"`** | The symptom exactly as staging produced it |

The first three build their own clients and would all pass with the fix deleted. The last
two are the regression test, and they are why they exist.

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| Credential endpoints fail closed when the limiter is unavailable | ADR-050, `docs/SECURITY/10` | Unchanged and still covered by the existing suite. This fix removes a **false** unavailability, not the behaviour |
| The fix is actually wired in | — | **Mutation**: `await this.redis.connect()` removed from `onModuleInit`. Caught by `"hands the guard a client that is already ready"` and `"answers the FIRST request to a credential endpoint, rather than 503"`, both by name |

## Abuse Cases Covered

None new. Worth stating what this was **not**: the 503 was not an attacker, not a flood,
and not a misconfiguration. Anyone reading `rate_limit.unavailable` in a log as evidence of
either would have been looking in the wrong place.

## DoD Verification

`P1-07`'s own DoD is unchanged and still met. This record exists because the task was
`DONE` and wrong in a way its tests could not see.

## What Did Not Work

**The suite was structurally unable to catch this, and it looked thorough.**
`rate-limit.itest.ts` had 33 passing tests, including concurrency and escalating blocks.
Every one of them builds its client **without** `lazyConnect` and calls `ping()` in
`beforeAll` — so the harness had already done the exact thing production had not. The
suite was testing a warm client and the application was shipping a cold one.

That is the seventh time in this project a layer has turned out to be untestable through
the layer above it, and the first time the untested layer was **the test harness's own
setup**. A `beforeAll` that makes the system ready is a `beforeAll` that can hide whether
the system makes itself ready.

**`/readyz` did not notice either.** It answered `{"status":"ok","checks":{"database":"ok"}}`
while the limiter could not reach Redis — so the container was healthy by its own account,
and the orchestrator would have kept routing to it. See Follow-Ups.

## Follow-Ups and Open Questions

- **`/readyz` does not check Redis.** It has a `database` check and nothing else, while
  Redis carries rate limiting, the cache and the job queue. A readiness probe that cannot
  see half the dependencies reports healthy through exactly this class of fault. Worth
  adding before Phase 3 puts payments on the same Redis — raised for `P0-13`'s successor.
- **The same options exist on the queue's client** (`queue.module.ts`, BullMQ). BullMQ
  manages its own connection lifecycle and `P0-15`'s producer swallows enqueue failures by
  design, so the symptom would be a silently dropped job rather than a 503 — which is
  worse to detect. Not investigated here.
- **Nothing probes staging.** Synthetic monitoring has been unblocked since `P0-23` and is
  still not done. A probe hitting one credential endpoint after each deploy would have
  found this before a person did.

## What to Watch

**A 503 from a credential endpoint now means Redis is genuinely unreachable.** Before this
fix it meant that *or* that the container had just started, and the two were
indistinguishable from the outside. If `rate_limit.unavailable` appears in a log now, it is
real.

**The first-command hazard applies to any ioredis client built this way.** The combination
is not wrong — it is what makes the fail-closed decision reachable — but it requires an
explicit connect somewhere. Two clients in this codebase use these options; one is now
handled and the other is BullMQ's, which manages its own.
