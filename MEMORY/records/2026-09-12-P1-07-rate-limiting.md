# P1-07 — Rate limiting

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-07 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-07-rate-limiting` |
| **Status** | Completed |
| **Spec** | [`MEMORY/specs/P1-07-rate-limiting.md`](../specs/P1-07-rate-limiting.md) |

---

## What Changed

`backend/api/src/shared/rate-limit/` — a sliding-window limiter in Redis, all nine
policies from `docs/SECURITY/10`'s table plus one addition, the three headers
`docs/API/00` names, escalating blocks, and a decided answer to "what happens when Redis
is down" (ADR-050).

Applied to `register`, `login`, `forgot-password` and `reset-password`. The remaining
policies are defined and tested but have no route yet — their endpoints are `P1-09`,
`P1-17` and Phase 2.

## Why

`docs/SECURITY/10` § Rate Limiting. The task also carried an obligation inherited from
`P1-05`: `forgot-password` at 3 per hour, which that card deferred here rather than
building a second limiter.

## How

**A sliding window, not a fixed one.** A fixed window resets on a clock boundary, so an
attacker spends the whole allowance in the last second of one window and the whole
allowance in the first second of the next — **10 attempts in two seconds** against a limit
of "5 per 15 minutes". The window here is a sorted set of timestamps, trimmed on every
check, so the limit holds across every instant rather than between boundaries.

**One Lua script.** Trim, count and add have to be atomic. As three round trips, two
concurrent requests both read 4, both decide they are under a limit of 5, and both add.

**The script returns the decision, not just the count.** The count alone is ambiguous: at
the limit it means both "this one just filled the last slot" and "this one was turned
away". Deriving `allowed` in TypeScript from the count was the first version and it never
refused anything — see below.

**Only failures count for login**, because `docs/SECURITY/10` says "5 **failed** attempts".
That word changes the design: the guard checks the budget before the attempt and cannot
know the outcome, so the *controller* records the failure afterwards. Counting successes
would lock out a household sharing an address, and would let an attacker exhaust a
victim's budget by logging in correctly.

**Configurable without a deploy**, which is DoD item 2. Three layers: defaults in
`policies.ts`, a `RATE_LIMIT_OVERRIDES` env var, and a Redis hash `rl:config` re-read every
30 seconds. The last is the one that satisfies "without a deploy" — `HSET rl:config login
'{"limit":20}'` is in force within half a minute. **A malformed override is ignored and
logged, never applied**: a typo during a tuning change must not remove a control at the
moment somebody is distracted by traffic.

**`trust proxy` is a count, not `true`.** Express's `trust proxy: true` trusts the
*leftmost* `X-Forwarded-For` entry — which the client wrote. Anyone could then pick their
own rate-limit bucket by sending a header, and per-IP limiting would be decorative. A
count makes Express take the n-th entry from the right, which only a real proxy can set.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/shared/rate-limit/policies.ts` | **New** — `docs/SECURITY/10`'s table, plus exemptions and escalation |
| `backend/api/src/shared/rate-limit/rate-limiter.ts` | **New** — the Lua window, blocks, the Redis-down decision |
| `backend/api/src/shared/rate-limit/config.ts` | **New** — the three override layers |
| `backend/api/src/shared/rate-limit/rate-limit.guard.ts` | **New** — key derivation, headers, 429/503 |
| `backend/api/src/shared/rate-limit/rate-limit.module.ts` | **New** — its own Redis connection, and why |
| `backend/api/src/modules/auth/auth.controller.ts` | Four routes guarded; login failures recorded |
| `backend/api/src/main.ts` | `trust proxy` |
| `backend/api/src/config/env.schema.ts` | `RATE_LIMIT_OVERRIDES`, `TRUSTED_PROXY_HOPS` |
| `backend/api/test/integration/rate-limit.itest.ts` | **New** — 33 tests against a real Redis |
| `backend/api/test/auth-http.spec.ts` | 8 tests for the guard at HTTP level |

No migration.

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Fail closed on credential endpoints, open elsewhere | Unlimited credential attempts is a breach; refusing all traffic because the limiter is down is a self-inflicted outage | ADR-050 |
| `503` on fail-closed, not `429` | "Slow down" is false, and a backoff client would wait for the wrong thing | ADR-050 |
| A sliding window | A fixed one grants double the limit across a boundary | — |
| The Lua script returns `allowed` | The count at the limit is ambiguous | — |
| `reset-password` added to the table | It consumes the link `forgot-password` sends; limiting one and not the other protects nothing | — |
| Its own Redis connection, not the queue's | BullMQ requires `maxRetriesPerRequest: null`, which makes a command hang rather than fail — right for a job, wrong for a limiter that must reach a decision | — |
| A malformed override is ignored | A typo must not remove a limit | — |
| `TRUSTED_PROXY_HOPS` is a count | `trust proxy: true` lets a client choose its own bucket | — |

## Deviations from `docs/`

**One addition.** `reset-password` is not in `docs/SECURITY/10`'s table. It accepts a token
and a new password, which makes it a credential endpoint by any reading, and it consumes
the link that `forgot-password` sends — limiting the sender and not the redeemer protects
nothing. Added at forgot-password's numbers and flagged in `policies.ts` as an addition
rather than a transcription.

## Tests Added

41 (33 integration against a real Redis, 8 HTTP-level). API integration total 328 → 361;
unit 204 → 212.

| Group | Cases |
|---|---|
| The window | allows exactly the limit then refuses; frees a slot after the window; **a fixed-window burst does not get double the allowance**; **concurrent checks cannot both take the last slot**; reset time in the future |
| Keys | two addresses do not share a budget; two policies do not |
| Failures only | **a successful login does not consume the failure budget**; recorded failures do; **another account's failures do not lock this one out** |
| Escalation | **doubles each time**; capped at 24 h; a block refuses an otherwise-empty window; a block is per key; strikes accumulate |
| Configuration | **matches `docs/SECURITY/10`'s table row for row**; env override; **a Redis override applies with no restart**; Redis beats env; **five kinds of malformed override are ignored**; an unknown policy throws rather than defaulting to unlimited |
| **Redis down** | **login fails closed**; **general fails open**; **every credential policy is fail-closed and nothing else is**; `recordFailure` never throws; `block` reports 0 rather than pretending |
| Exemptions | **the payment webhook is never limited**; health checks; nothing else, including a crafted `/invitations/webhooks/x` |
| HTTP | the three headers **on a successful response**; 429 with the envelope and `Retry-After`; **a refused request never reaches the service**; **a Redis outage is 503 not 429**; a failed login is recorded and a successful one is not; forgot-password, register and reset-password all limited |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| The window cannot be doubled across a boundary | — | "a fixed-window burst does not get double the allowance". **Mutation**: replacing the sliding trim with a fixed bucket fails exactly that test |
| Two concurrent requests cannot both take the last slot | — | "concurrent checks cannot both take the last slot" — three simultaneous checks, one allowed |
| Login counts failures, not successes | `docs/SECURITY/10` | "a successful login does not consume the failure budget" and the HTTP pair |
| A Redis outage cannot disable credential limiting | ADR-050 | "login fails closed when Redis is down"; "every credential policy is fail-closed and nothing else is" asserts the split itself |
| `forgot-password` is limited | `P1-05` obligation | "forgot-password is limited (the obligation inherited from P1-05)" plus the policy-table test |
| The payment webhook is never throttled | `docs/SECURITY/02` boundary 5 | "the payment webhook is never rate limited", and "nothing else is exempt" checks a crafted path that merely contains `webhooks` |
| A tuning typo cannot remove a limit | — | Five malformed-override cases, each asserting the limit stays at 5 |
| A client cannot choose its own bucket | — | **Not covered by a test.** `TRUSTED_PROXY_HOPS` is a count rather than `true`, which is the control; asserting it would need a request through a real proxy chain. Named as a gap |

## Abuse Cases Covered

Every row of the spec's § 11 table has a named test, except "the same attacker rotating
IPs", which is `OQ-22` — a property of the key `docs/SECURITY/10` specifies, not a gap in
the implementation.

## DoD Verification

- [x] Every policy in `docs/SECURITY/10`'s table is implemented with its documented key and window. `"matches docs/SECURITY/10's table by default"` asserts all nine, row for row. Plus `reset-password` as a documented addition.
- [x] Limits are configurable without a deploy. `"a Redis override applies with no restart"`.
- [x] The webhook path is exempt from public rate limiting. Three tests.
- [x] The Redis-down behaviour is decided, recorded, and covered by a test that simulates the outage. ADR-050; the outage is simulated by pointing a limiter at a closed port.

**Inherited obligation from `P1-05` — met.** `forgot-password` is limited to 3 per hour per
(email, IP), with a test.

## What Did Not Work

**1. The limiter did not limit.** The first version made the decision in TypeScript from
the count the Lua script returned: `count > limit`. When the script declines to add,
the count stays **at** the limit, so that expression is never true and every request was
allowed. Six tests failed on the first run, including the boundary-burst and concurrency
cases. The script now returns `allowed` itself, because the count alone is genuinely
ambiguous at the limit — it means both "this one filled the last slot" and "this one was
turned away".

Worth noting how close this came to looking fine: the headers were correct, `remaining`
counted down, and a casual manual test would have shown a limiter working right up until
the moment it was supposed to refuse.

**2. 5432 and 6379 were both occupied on this machine.** The integration suites need a
real PostgreSQL and a real Redis and deliberately fail rather than skip. Run them with
`POSTGRES_PORT=55432` / `REDIS_PORT=56379` and the matching URLs exported — now written
down in `backend/api/test/README.md`.

## Follow-Ups and Open Questions

- **`OQ-22` — the (email, IP) login key is weak against a distributed attacker.** Rotating
  IPs against one account gives a fresh budget per IP. The obvious fix — a per-email
  limit — lets a stranger lock a victim out of their own account. Raised rather than
  decided; `P4-05`'s adaptive CAPTCHA is the mitigation that creates no lockout vector.
- **Five policies have no route yet**: `rsvp`, `guestbook`, `invitation-create`,
  `media-upload` and the two general ones. `P1-09` must apply `invitation-create`,
  `P1-17` `media-upload`, and Phase 2 the public pair. The general policies want a global
  guard rather than a per-route one, which is a chain-position change.
- **No metric export yet.** The card's step 7 asks for a metric per policy for
  `docs/DEVOPS/07`'s brute-force alert. The security event on a **block** is emitted;
  Prometheus counters arrive with the observability task in Phase 7.
- **`TRUSTED_PROXY_HOPS` needs setting to 2 in production** (Cloudflare → Caddy). It
  defaults to 1, which is right locally and wrong behind Cloudflare — with the wrong value
  the limiter buckets everyone behind Caddy's address.

## What to Watch

**The fail-closed decision will be questioned during an incident**, and that is the moment
it is hardest to reason about. ADR-050 states the trade and names the alternative that was
rejected — a per-instance in-process fallback, which multiplies the effective limit by the
instance count and is a silently weaker control rather than an honest outage.

**`rl:config` is mutable runtime state with no audit trail.** Anybody with Redis access can
raise a limit and nothing records it. That is the price of "without a deploy"; if it
matters, the admin panel (Phase 5) should own the write and audit it.
