# P1-07 — Feature Spec: Rate Limiting

| | |
|---|---|
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-07 |
| **Date** | 2026-09-12 |
| **Author** | Claude Code session |
| **Status** | Draft |

---

## 1. Goal

Every policy in `docs/SECURITY/10`'s table, enforced, tunable without a deploy, and with a
decided — not accidental — answer to "what happens when Redis is down".

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/SECURITY/10` | Rate Limiting | The nine policies: limit, window and key for each |
| `docs/SECURITY/10` | — | "configurable (not hard-coded) for easy tuning" |
| `docs/SECURITY/10` | Monitoring & Auto-block | Escalating temporary blocks for repeat violators |
| `docs/API/00` | Rate Limiting | `X-RateLimit-Limit`, `-Remaining`, `-Reset` |
| `docs/SECURITY/02` | boundary 5 | The payment webhook is exempt |
| `docs/ARCHITECTURE/06` | — | Cache, rate limiting and jobs share one Redis |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| — | Login counts **failed** attempts only, not successful ones | `consumeOnFailure` policies; the service records the failure |
| — | A repeat violator is blocked for escalating periods | `RateLimiter.block` |
| — | A provider retry storm on the webhook is legitimate traffic | The exempt path list |

## 4. API Contract

Not an endpoint. On every limited response:

```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 2
X-RateLimit-Reset: 1789200000      (unix seconds, when the window frees a slot)
```

On refusal, `429` with `TOO_MANY_ATTEMPTS` in the standard envelope, plus `Retry-After`.

## 5. Data Model Impact

None in PostgreSQL. In Redis:

| Key | Type | Why |
|---|---|---|
| `rl:{policy}:{key}` | sorted set of timestamps | The sliding window itself |
| `rl:block:{policy}:{key}` | string with TTL | An active temporary block |
| `rl:strikes:{policy}:{key}` | counter with TTL | How many blocks this key has earned, for escalation |
| `rl:config` | hash | Runtime overrides — see § 7 |

**A sliding window, not a fixed one.** A fixed window lets an attacker spend the whole
allowance in the last second of one window and the whole allowance in the first second of
the next — double the limit across two seconds, which for `5 failed logins / 15 minutes`
means 10.

## 6. Authorization

Not applicable. The limiter runs **before** authentication in the chain (position 6, per
`app.module.ts`), so an unauthenticated flood is cheap to absorb. Policies keyed by
`user_id` necessarily run after; those are applied per-route rather than globally.

## 7. Validation and Sanitization

**Configurability.** `docs/SECURITY/10` requires the limits not be hard-coded, and the DoD
requires tuning "without a deploy". Three layers, cheapest last:

1. Defaults in `policies.ts`, matching the document's table exactly.
2. `RATE_LIMIT_OVERRIDES`, a JSON env var — takes a restart.
3. A Redis hash `rl:config`, re-read every 30 seconds. **This is the one that satisfies
   the DoD**: `HSET rl:config login '{"limit":20}'` takes effect within half a minute with
   no restart and no deploy.

An override that does not parse is ignored and logged, never applied — a typo in a tuning
change must not remove a limit.

## 8. State Transitions

`strikes: n -> n+1` on each block. Block duration is `min(2^(n-1) x 15 min, 24 h)`.

## 9. Side Effects

| Effect | When | Why there |
|---|---|---|
| A metric per policy, per outcome | Every check | `docs/DEVOPS/07` alerts on brute-force patterns; a limiter with no metric is a limiter nobody watches |
| A security event | On a block, not on every refusal | One 429 is a fat-fingered password. A block is a pattern |

## 10. Failure Modes — the Redis decision

**This is step 5 and the DoD's fourth item, and it is the interesting part.**

| Policy group | Redis down | Why |
|---|---|---|
| `login`, `register`, `forgot-password`, `reset-password` | **FAIL CLOSED** — `503` | Unlimited credential attempts against a live database is a credential-stuffing window. A login outage is an outage; an unlimited login endpoint is a breach |
| Everything else | **FAIL OPEN** — allow, log loudly | Throttling exists to protect capacity. Refusing every authenticated request because the *limiter* is down converts a degraded dependency into a total outage, and the traffic it was protecting against is hypothetical while the outage is real |

The card recommends exactly this split. Recorded as an ADR because it is a real trade and
somebody will want to revisit it during an incident.

**Fail-closed returns `503`, not `429`.** A `429` tells the client "slow down", which is
false and makes a client with backoff wait pointlessly. A `503` says the service cannot
answer, which is true.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Credential stuffing on one account | `docs/SECURITY/10` | 5 failures per 15 min per (email, IP) | "login allows five failures then refuses" |
| The same attacker rotating IPs | — | The email half of the key still counts. **Partially mitigated** — see § 14 |
| Burst across a window boundary | — | A sliding window, so 10-in-2-seconds is impossible | "a fixed-window burst does not get double the allowance" |
| A successful login consuming the budget | `docs/SECURITY/10` | Only failures count | "a successful login does not consume the failure budget" |
| Mass registration | `docs/SECURITY/10` | 5 per hour per IP | "register is limited per IP" |
| Enumerating via forgot-password | `docs/SECURITY/10` | 3 per hour per (email, IP) | "forgot-password allows three per hour" |
| Repeat violator returning after each window | `docs/SECURITY/10` Monitoring | Escalating block | "a repeat violator is blocked for longer each time" |
| Redis outage used to disable login limiting | — | Fail closed | "login fails closed when Redis is down" |
| Provider webhook retry storm throttled into failure | `docs/SECURITY/02` boundary 5 | Exempt | "the payment webhook is never rate limited" |

## 12. Test Plan

Integration, against a **real Redis** — a mocked limiter would test the mock's arithmetic.
Plus the outage cases, which are produced by pointing the limiter at a closed connection.

| Layer | Cases |
|---|---|
| The window | allow up to the limit; refuse past it; recover after it passes; the boundary-burst case |
| Keys | two emails do not share a budget; two IPs do not; the same (email, IP) does |
| Headers | limit, remaining, reset present and correct; `Retry-After` on a 429 |
| Config | a Redis override applies without a restart; a malformed one is ignored |
| Escalation | strikes accumulate; duration doubles; capped |
| Outage | login fails closed, general fails open |
| Exemption | the webhook path |
| Mutation | make the window fixed instead of sliding and confirm the boundary test fails |

## 13. Observability

`rate_limit.hit` per policy and outcome, and `auth.login_failed` already carries the
hashed email from `P1-03` — together those are what `docs/DEVOPS/07`'s brute-force alert
needs.

## 14. Open Questions

- **The (email, IP) key is weaker than it looks against a distributed attacker.** Rotating
  IPs against one email gives a fresh budget per IP, because the key includes the IP. The
  document specifies this key, so it is what is implemented; a per-email-only limit would
  stop distributed stuffing and would also let an attacker lock a victim out of their own
  account by failing five logins. Noted, not resolved — raised as `OQ-22`.
- **`X-RateLimit-*` is not a standard**, it is a convention, and `docs/API/00` names it
  explicitly. Implemented as written rather than as RFC 9331's `RateLimit-*`.
