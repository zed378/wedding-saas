# P0-13 — Response envelope, error mapping, health endpoints

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-13 |
| **Phase** | Phase 0 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-13-envelope-errors-health` |
| **Status** | Completed |

---

## What Changed

One envelope, one error mapper, one pagination helper, and a readiness endpoint separate from liveness. Plus the shared test helper every later endpoint test is meant to use, and the security headers `docs/SECURITY/08` names. 27 unit tests and 5 integration tests.

## Why

Two things this task prevents, both of which are cheap now and expensive later.

**Every endpoint inventing its own response shape.** Two shapes means every client needs two code paths, and the second is always the one nobody tested.

**An error leaking the implementation.** `docs/SECURITY/08` forbids a stack trace, SQL, a server path or a library version reaching a client. That requirement is almost never broken by carelessness — it is broken by a framework helpfully forwarding an exception message that happened to contain a failing query.

## How

**The mapper works from an allowlist, not a denylist.** Only two categories get their message forwarded: our own `AppError` subclasses, whose messages were written for a client, and Nest's `HttpException`, from which only the *status* is taken and the message replaced. Everything else — a pg error, a `TypeError`, a thrown string — produces a fixed message and nothing from the original.

That distinction is the difference between a filter that is careful and one that is safe. A Postgres error message contains the failing SQL and the constraint name. A Node error contains a file path. Neither author was thinking about the API contract, and no amount of care at the call site fixes that; only refusing to forward unrecognised errors does.

**There is deliberately no `ForbiddenError` for someone else's resource.** ADR-018 says that case is a 404. The cleanest way to keep that rule is to make the wrong answer inexpressible: `ForbiddenError` accepts only `FORBIDDEN` and `EMAIL_NOT_VERIFIED`, the two cases where no resource identity is revealed. A class that cannot express the third case cannot be misused to produce it.

**"No such route" and "not yours" return byte-identical bodies.** A test asserts it. If the two read differently, the difference is the enumeration oracle ADR-018 removed, arriving through a helpful error message instead of a status code.

**Pagination rejects rather than clamps.** Silently turning `per_page=1000` into 100 means a client paginating through results gets a different page size than it asked for and quietly skips records — the bug surfaces as missing data much later, in someone else's code.

**Liveness and readiness answer different questions.** `/health` touches nothing: a liveness probe that checks the database restarts every healthy replica during a database blip and turns one outage into two. `/readyz` does check, because a pod that cannot reach PostgreSQL should leave the load balancer rather than serve errors.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/http/envelope.ts` | The two shapes, verbatim from `docs/API/00` |
| `backend/api/src/http/errors.ts` | Domain errors; no forbidden-for-a-resource case exists |
| `backend/api/src/http/exception.filter.ts` | The mapper; allowlist-based |
| `backend/api/src/http/pagination.ts` | `page`/`per_page`, defaults, decimal-digit parsing |
| `backend/api/src/http/health.controller.ts` | `/health` and `/readyz` |
| `backend/api/src/main.ts` | HSTS, CSP baseline, referrer policy, frameguard DENY |
| `backend/api/src/app.module.ts` | Filter registered as `APP_FILTER` |
| `backend/api/test/support/envelope-assertions.ts` | The shared helper the DoD asks for |
| `backend/api/test/http-contract.spec.ts` | 27 tests |
| `backend/api/test/integration/health.itest.ts` | 5 tests against a real database |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| The mapper forwards only recognised error types | A pg message carries SQL; a Node message carries a path | — |
| No `ForbiddenError` for another user's resource | ADR-018 kept by the type system rather than by discipline | ADR-018 |
| Framework exception messages replaced, not forwarded | `NotFoundException("no invitation 7f3a9c21")` is an oracle | — |
| Pagination rejects out-of-range `per_page` | Clamping makes a client skip records silently | — |
| Decimal digits only for `page`/`per_page` | `Number("1e3")` is 1000; several spellings of one value is a bypass shape | — |
| Health responses are raw JSON, not the envelope | A load balancer is not an API client; it matches on status | — |
| Readiness names *which* dependency, never *why* | An operator needs the first; an unauthenticated prober would take the second | — |
| HSTS without `preload` | Preload submission is close to irreversible and the domain is not settled | — |

## Deviations from `docs/`

None. `docs/API/00` already carried the 403-versus-404 section — ADR-018 amended it during the earlier specification pass — so DoD item 4 was satisfied before this task started. Verified rather than assumed.

## Tests Added

27 unit, 5 integration; 95 and 150 across their suites.

| Group | Cases |
|---|---|
| Envelope helpers | `meta` and `details` omitted rather than set to undefined |
| Pagination | defaults; offset computed; **rejects rather than clamps**; rejects `0`, `-1`, `1.5`, `abc`, `1e3`, `0x10`, `+1`, `" 1 "`, and a value past `MAX_SAFE_INTEGER`; names the offending field |
| Contract | success shape; `meta` shape; all seven status mappings; validation details |
| **Leakage** | a pg foreign-key error → generic 500 with no table, code or "foreign key"; a `TypeError` → no stack or path; **a thrown string containing a connection URL → no password, no host**; a framework 404's message replaced; **unknown route and "not yours" byte-identical** |
| 403 vs 404 | `ForbiddenError` accepts only the two safe codes |
| Health | liveness returns exactly `{status:"ok"}`; readiness 200 with the database up; **503 with it down**; names the dependency but not the reason; **liveness still 200 while readiness is 503** |

The shared helper asserts leakage on *every* error it checks, so every endpoint test written in Phases 1 to 5 gets that check for free on whatever error it happened to produce.

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| No stack trace, SQL, path or library name in an error body | `docs/SECURITY/08` § Error Handling | Eight forbidden patterns asserted by the shared helper on every error test, plus three tests throwing errors that realistically leak |
| A resource that is not yours is indistinguishable from one that does not exist | ADR-018, `docs/SECURITY/05` § 4 | Byte-identical bodies asserted |
| 403 cannot be used for a resource | ADR-018 | The class cannot express it |
| Readiness discloses no infrastructure | `docs/DEVOPS/05` | `expectNoInternalLeak` plus explicit checks for `ECONNREFUSED` and the port |
| Security headers present | `docs/SECURITY/08` § Security Headers | `nosniff`, `X-Frame-Options: DENY`, HSTS, CSP baseline, `Referrer-Policy` configured in `main.ts` |
| CORS is an explicit allowlist | `docs/SECURITY/08` | Already the case from `P0-04`; unchanged |

**Not verified here**: that the headers arrive on a real response. They are helmet configuration in `main.ts`, which the test harness does not boot. `P0-23` should assert them against the deployed origin — a header set in code and stripped by a proxy is a common and silent failure.

## Definition of Done Verification

- [x] Every response matches `docs/API/00`, asserted by a **shared helper** meant for all later endpoint tests
- [x] A thrown internal error produces a generic 500 with no stack, path or SQL — proven with three realistic error shapes
- [x] Readiness fails when Postgres is down and the body discloses nothing — proven against a real unreachable port
- [x] The 403-versus-404 decision is ADR-018 and `docs/API/00` already carries it

## What Did Not Work

**The readiness check worked and its log said nothing.** With PostgreSQL unreachable, `/readyz` correctly returned 503 — and logged `error: ""`. `pg` throws an **`AggregateError` with an empty `message`**, putting the useful part in `.code` (`ECONNREFUSED`) and `.errors[]`. My handler read `error.message`, which is the obvious thing and is empty here.

Nothing failed. The endpoint was correct, the test would have passed, and an operator at 3am would have had a 503 with no reason and correct-looking code to re-read. Found only because I ran it against a real unreachable port instead of a mock. The fix walks `code`, `message` and `errors[]`; the response body is unchanged.

**A test asserted `1e3` was rejected, and it was not.** `Number("1e3")` is 1000 — a valid integer ≥ 1, so my test was wrong rather than the code. Rather than delete the case I took the stricter reading: `page` and `per_page` now require plain decimal digits. Accepting several spellings of one value is the shape of a validation bypass, even where there is only one parser in the path today.

**The probe script could not resolve `@nestjs/core` from `/tmp`.** Node resolves from the importing file's directory, so a script in the temp directory sees none of the project's dependencies. Moved into the package and deleted afterwards.

## Follow-Ups and Open Questions

- **Readiness checks PostgreSQL only.** `docs/DEVOPS/05` names Redis too; there is no Redis client until `P0-15`. The `check()` helper takes a list, so adding it is one line.
- **The compose healthcheck still uses `/health`.** Correct for a container restart policy, wrong as a traffic signal. `P0-23` should point the load balancer at `/readyz`, and the `P0-05` record already flags this.
- **Nothing asserts the security headers on a real response.** They are configured; that is not the same as delivered.
- **`P1-*` should use `expectSuccess`/`expectError`.** They exist and are used here; nothing forces a future test to reach for them.

## What to Watch

**The mapper's allowlist is the security property, and it looks like an inconvenience.** The first time someone gets a generic 500 while debugging, the natural fix is to forward `exception.message` "just for internal errors". That single line puts SQL and file paths back into client responses, and it will read as an improvement in a diff.

**`expectNoInternalLeak` matches patterns, so it will produce a false positive eventually.** A legitimate error message containing the word `postgres`, or a four-digit number that looks like a port, will fail a test that is not actually leaking. The fix then is to narrow the pattern — not to delete the assertion, which is what will be tempting at the time.

**Liveness and readiness will be confused by someone.** They differ by four characters in a URL and by everything in consequence. Pointing a liveness probe at `/readyz` restarts healthy pods during a database blip; pointing a load balancer at `/health` sends traffic to pods that cannot serve it. Both are one-line configuration mistakes in a file this repository does not own yet.
