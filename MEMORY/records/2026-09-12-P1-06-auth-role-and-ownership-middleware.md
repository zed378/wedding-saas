# P1-06 — Auth, role and ownership middleware

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-06 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-06-auth-middleware` |
| **Status** | Completed |
| **Spec** | [`MEMORY/specs/P1-06-auth-role-and-ownership-middleware.md`](../specs/P1-06-auth-role-and-ownership-middleware.md) |

---

## What Changed

`backend/api/src/shared/auth-middleware/` — the three names `docs/SECURITY/04` mandates,
plus the request-context plumbing. And `backend/api/test/support/idor.ts`, the reusable
assertion that makes the mandatory IDOR test for every future `:id` endpoint cost one line.

`P0-11` had already built the query layer this sits on. What was missing was the two
request-level guards, the ownership helper the documented name refers to, and the test
helper.

## Why

`docs/SECURITY/05` is the project's number one security concern with zero tolerance for
regressions, and `docs/SECURITY/04` § Mandatory Testing makes an IDOR test a
definition-of-done item for **every** `:id` endpoint. There are dozens of those coming in
Phases 1 to 5. The value of this task is almost entirely in what it makes cheap: a
mandatory test that is tedious to write is a mandatory test somebody eventually writes
badly.

## How

**`requireOwnership` is not a guard, and that is the whole design decision.**
`docs/SECURITY/04` lists all three names together under "Mandatory Middleware". Its own
Implementation Principle 2 then says ownership is checked in the service *"so no code path
can accidentally bypass it when the service is called from elsewhere (e.g., from a
job/worker)"*. A Nest guard runs on an HTTP request and on nothing else. Making this one a
guard would have satisfied the heading and broken the principle — invisibly, because the
endpoint would still be safe and the worker calling the same service would not be. It
keeps the mandated name and takes the shape the principle requires.

**It takes a loader, not a resource** — `requireOwnership(resourceLoader)` is the
document's own signature, and it is what makes Principle 3 possible. A function receiving
a resource would mean the row had already been fetched unscoped, and the comparison would
be happening in application code, which Principle 3 names as the wrong answer. Because the
loader already carries `WHERE owner_id = :scope`, this function **never sees a row it has
to judge** — it only turns `null` into a 404, so it cannot judge one wrongly.

**The current user lives under a symbol, not `req.user`.** `req.user` is a name half the
Express ecosystem writes to; a passport strategy or a logging middleware setting it would
silently become an authentication source. A symbol nothing else holds cannot be set by
accident.

**`requireRole` is documented, at its own definition, as never sufficient alone.** It
passes for *every* logged-in user when called with `"user"` — which is to say it passes
for the attacker as readily as for the owner. The comment says so where somebody reaching
for it will read it.

**The IDOR helper asserts the positive case too.** `expectIdorSafe` checks that Mallory
cannot reach Alice's invitation **and that Alice can**. Without the second half, a service
that returned `null` to everybody would pass every IDOR test ever written.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/shared/auth-middleware/guards.ts` | **New** — `requireAuth()`, `requireRole()`, `requireAdmin()` |
| `backend/api/src/shared/auth-middleware/require-ownership.ts` | **New** — `requireOwnership()`, `requireOwned()` |
| `backend/api/src/shared/auth-middleware/current-user.ts` | **New** — symbol-keyed context, `@CurrentUserParam()` |
| `backend/api/src/shared/auth-middleware/index.ts` | **New** — the barrel |
| `backend/api/test/support/idor.ts` | **New** — the reusable assertion |
| `backend/api/test/README.md` | **New** — DoD item 4 |
| `backend/api/test/integration/authz.itest.ts` | **New** — 23 tests |
| `backend/api/src/app.module.ts` | Chain comment: position 7 now names the real module |

No migration. No change to `P0-11`.

## Decisions Made

| Decision | Rationale |
|---|---|
| `requireOwnership` is a service-layer function, not a guard | A guard only runs on HTTP; Principle 2 exists because services are also called from jobs |
| It takes a loader rather than a resource | The document's own signature, and what makes the query-level filter possible |
| The current user is symbol-keyed | `req.user` is a shared namespace and therefore an injection point |
| `requireRole` throws on an empty role list | A guard that permits everything while reading as protection is worse than no guard |
| `authz.idor_attempt` includes the resource id | It is not the caller's data, and without it enumeration is indistinguishable from a stale bookmark |
| No security event when the owner's own lookup misses | Otherwise every mistyped URL is an event and the stream that matters drowns |

## Deviations from `docs/`

**One, and it is a shape rather than a behaviour.** `docs/SECURITY/04` groups
`requireOwnership` with two middlewares; it is implemented as a service-layer function.
The document's own Implementation Principle 2 requires this, so the deviation is from the
heading, not from the requirement. No document change: `docs/SECURITY/04` already contains
both statements, and the principle is the load-bearing one.

## Tests Added

23 integration. API integration total 305 → 328.

| Group | Cases |
|---|---|
| `requireOwnership` | the owner gets the row; **a non-owner gets 404 and no data**; **"absent" and "not yours" are byte-identical**; a soft-deleted invitation is gone to its owner too; `authz.idor_attempt` emitted with context; **no event for the owner's own miss**; `requireOwned` proves ownership without shipping the row |
| No implicit scope | `tenantScope("")`, `"all"` and `undefined` all throw; **an invitation id is a valid UUID and still finds nothing**, which is the brand doing work a regex cannot |
| Role is not ownership | **`requireRole` alone does not protect a resource** — Mallory has the `user` role and still cannot read Alice's row; an `admin` role does not silently widen `findOwned` |
| `requireAuth` | **the role comes from the database, not a token claiming `super_admin`**; a suspended user is not authenticated |
| Admin bypass | reaches another tenant's invitation; **writes an audit row every time** (3 reads, 3 rows); **writes one even when nothing was found**; records the reason; refuses an empty or whitespace reason |
| **The helper itself** | passes a safe service; **FAILS a service that leaks**; **FAILS a service that refuses everybody**; **FAILS a service answering 403 instead of 404**; catches a leak hidden in a 404 body |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| A non-owner cannot reach another tenant's resource | `docs/SECURITY/05` § 1 | "a non-owner gets 404 and no data". **Mutation**: removing `eq(invitations.ownerId, scope)` from `findOwned` fails **7 tests**, including `expectIdorSafe` itself |
| 404, never 403 | `docs/SECURITY/04` § Note | "'absent' and 'not yours' are the same response" asserts status, code **and** message. There is no forbidden-for-someone-elses-resource error class in the codebase to throw (ADR-018) |
| Ownership is enforced below HTTP | `docs/SECURITY/04` § 2 | Every test in this file calls the repository and `requireOwnership` directly. No `app.getHttpServer()` appears in the suite |
| A job cannot call a service unscoped | `docs/SECURITY/04` § 2 | "a job with no user context cannot construct one from nothing" — `TenantScope` is branded and `tenantScope()` validates |
| A role check is not an ownership check | `docs/SECURITY/04` § 1 | "requireRole alone does not protect a resource" |
| The token's role claim is ignored | `docs/SECURITY/01` | "requireRole reads the database role, not the token's" |
| Every admin bypass is audited | `docs/SECURITY/05` § Special Case | "writes an audit row every time", "…even when nothing was found", "records the reason" |
| **The IDOR helper can fail** | — | Three tests whose passing depends on an assertion failing: a leaking service, a service that refuses everybody, and one answering 403 |

## Abuse Cases Covered

Every row of the card's table and of the spec's § 11 has a named test.

## DoD Verification

- [x] The three middlewares exist with the names in `docs/SECURITY/04`. `requireAuth`, `requireRole`, `requireOwnership`, exported from `shared/auth-middleware`.
- [x] Ownership is enforced in the service layer, and a test calling the service directly (not through HTTP) still fails for a non-owner. The entire suite calls services directly; `"a non-owner gets 404 and no data"` is the case.
- [x] Non-owner access returns 404 with no resource data. Asserted, and `expectHttpIdorSafe` checks the body separately from the status because a 404 carrying the resource is a leak with a misleading status code.
- [x] The reusable IDOR test helper exists and is documented in the testing README. `test/support/idor.ts`; `backend/api/test/README.md` is new and documents it with the table of what it refuses to accept.
- [x] Admin bypass writes an audit row every time. Three tests, including the found-nothing case.

## What Did Not Work

**1. The first "leaky service" fixture threw instead of leaking.** The test that proves
the helper can fail used `harness.db.execute` with a raw string cast to `never`; it raised
rather than returning a row, so the helper caught a thrown error with no `status` and
failed on the *403* assertion instead of the *leak* assertion. It looked like a pass at a
glance — the test was red for the wrong reason. Replaced with a genuine unscoped
`pool.query`, which is the bug the subsystem exists to prevent, written out.

**2. Nothing calls any of this yet.** `P1-09` is the first `:id` endpoint. That makes the
helper's self-tests the only thing currently proving the helper works, which is why there
are three of them rather than a comment saying it was checked.

## Follow-Ups and Open Questions

- **`P1-09` onward must use `expectIdorSafe`.** `scripts/check-id-endpoint-tests.mjs`
  already fails the build for a new `:id` route without an IDOR test; this is what that
  test should be.
- **`requireAuth()` has no route using it yet.** Its behaviour is covered through
  `SessionService`, which it delegates to entirely. The first controller to use it should
  add an HTTP-level test that a missing header is 401.
- **No caching in `SessionService`.** If `P1-09`'s latency argues for one, the cache must
  be invalidated by the admin suspend path (`P6-04`), and `"a suspended user is not
  authenticated"` is the test that would catch forgetting.

## What to Watch

**`requireRole` looks like security.** A route with `requireRole("user")` and an `:id`
parameter and no `requireOwnership` is an IDOR, and it reads as protected in review. The
comment at the function's definition says so, and the build guard catches the missing
test — but the guard checks for a *test*, not for the call.

**`authz.idor_attempt` volume.** A handful is normal — stale bookmarks, shared links. A
burst from one actor with sequential ids is enumeration, and it is the cheapest signal
available for an attack that otherwise produces only 404s.
