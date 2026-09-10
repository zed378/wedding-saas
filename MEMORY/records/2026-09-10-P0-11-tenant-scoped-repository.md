# P0-11 — Tenant-scoped repository layer

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-11 |
| **Phase** | Phase 0 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-11-tenant-scoped-repository` |
| **Spec** | [`MEMORY/specs/P0-11-tenant-scoped-repository.md`](../specs/P0-11-tenant-scoped-repository.md) |
| **Status** | Completed |

---

## What Changed

A data-access layer in which fetching a tenant-owned row without an owner filter is **absent from the exported surface** — not discouraged, not caught in review. Plus the database connection the application had not needed until now, a branded `TenantScope` type, a build guard, and 27 isolation tests run against two seeded users.

## Why

`docs/SECURITY/05` is the project's stated number-one security priority with zero tolerance for regressions, and every `:id` endpoint in Phases 1 through 5 sits on this layer. The task card puts it plainly: adding it after the endpoints exist means auditing all of them instead of never writing one wrong.

## How

**Ownership is a query predicate, and the two failure cases are indistinguishable.** `findOwned(id, scope)` issues `WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`. A row owned by someone else, a soft-deleted row, and a row that never existed all return `null`. The service above therefore *cannot* return a 403 that confirms a resource exists (ADR-018) — not because it is careful, but because it never learns the difference.

**The scope is a branded type.** `TenantScope` can only be built by `tenantScope(userId)`, which validates a UUID. A plain `string` will not type-check where a scope is required, so passing a slug, an invitation id, or a variable from the wrong line is a compile error rather than a query against the wrong tenant.

**Child access is one query with both conditions.** `docs/SECURITY/05` § 7 asks for two validations — `child.invitation_id === :id` **and** `invitation.owner_id === current_user.id`. Doing them as two round trips leaves an intermediate state in which someone has done the first and moved on. `findOwnedChild` joins and applies both at once.

The attack this closes is concrete: `PATCH /invitations/{mine}/bank-accounts/{someone-elses}`. The parent is genuinely mine and the child id is genuinely valid; only the second condition stops the write.

**The admin bypass writes its own audit row, inside the read's transaction.** `docs/SECURITY/05` § Special Case requires every use to be logged. Leaving that to the caller means the first time someone forgets, a tenant-isolation bypass happens with no record. Here there is no way to obtain the data without leaving the trail — and if the audit insert fails, the whole thing rolls back and the caller gets an error rather than the invitation. `docs/SECURITY/00` requires failing closed on anything security-relevant.

**The child tables are an explicit union, not a structural type.** My first attempt used `interface InvitationChildTable extends PgTable { id, invitationId }`. Drizzle's generics rejected it, and the fix is better than the original: an enumerated union of the eight child tables. A structural type would also have accepted `users` or `orders` if their columns happened to match, and "which tables can be addressed as a child of an invitation" deserves one written answer.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/infra/db/client.ts` | The application's Drizzle connection, as the **unprivileged** role |
| `backend/api/src/shared/tenancy/tenant-scope.ts` | Branded `TenantScope`, `AdminBypass`, their constructors |
| `backend/api/src/shared/tenancy/invitation-repository.ts` | The layer |
| `backend/api/src/shared/tenancy/tenancy.module.ts` | Global module |
| `backend/api/src/app.module.ts` | Wires both |
| `scripts/check-tenant-scope.mjs` | Build guard |
| `scripts/verify.sh`, `.githooks/pre-push`, `package.json` | Guard wired in, blocking |
| `backend/api/test/integration/tenancy.itest.ts` | 27 tests |
| `backend/api/test/integration/helpers.ts` | `resetTenantData`, `applicationPool` |
| The other four integration suites | Now share one reset |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| `TenantScope` is a branded type | A bare `string` accepts a slug or an id from the wrong variable | — |
| Non-owner and non-existent both return `null` | The service cannot leak existence through a status code (ADR-018) | — |
| Child lookup is one query, both conditions | Two round trips invite skipping the second (`docs/SECURITY/05` § 7) | — |
| The admin path writes its own audit row, in-transaction | Caller-written audits are the ones that get forgotten | — |
| Admin path fails closed on audit failure | `docs/SECURITY/00`; an unauditable bypass is worse than a failed request | — |
| Child tables are an enumerated union | A structural type would accept unrelated tables | — |
| The guard refuses the category, not the instance | "This direct query is fine" is judged once and then copied | — |
| Soft-deleted rows **are** returned on the admin path | Support routinely needs the invitation a user says vanished | — |

## Deviations from `docs/`

None. `docs/SECURITY/04` § 4 asks for `adminFindInvitation`; the name here is `adminFindInvitationBypassingOwnership`, which is longer for the reason the document gives — the bypass must be "clear in the code", and a reviewer scanning a diff should not have to think about which line is the safe one.

## Tests Added

27 in `tenancy.itest.ts`; 145 across five suites. **Every test seeds two users.** A single-user fixture proves nothing about isolation — every query returns that user's rows whether or not the filter exists.

| Group | Cases |
|---|---|
| `tenantScope` | rejects `""`, `"not-a-uuid"`, whitespace, a short number; accepts a real id |
| IDOR (§ 1) | owner reads own; **non-owner gets null**; non-existent gets null; soft-deleted gets null; `ownsInvitation` agrees both ways |
| List filtering (§ 5) | only the caller's rows with two users seeded; soft-deleted excluded; status filter keeps the owner filter; **empty status list returns nothing, not everything**; page size capped |
| Sub-resources (§ 6, 7) | own child found; **child of another invitation → null**; **another's parent with a matching child → null**; child under the wrong parent of the same owner → null; `findOwnedChildren` scoped |
| Admin (§ Special Case) | row returned **and** audit row written; audit written even when nothing found; **cannot be called without a reason**; **fails closed when the audit write fails**; ordinary reads write nothing |

**Mutation-checked, four times** — this is the layer where that matters most:

| Mutation | Result |
|---|---|
| Removed `eq(invitations.ownerId, scope)` from `findOwned` | `returns null when the invitation belongs to someone else` failed |
| Removed `eq(table.invitationId, invitationId)` from `findOwnedChild` | `refuses a child whose parent id does not match` failed |
| Removed `eq(invitations.ownerId, scope)` from `findOwnedChild` | `returns null when the parent is not owned` failed |
| Removed the audit insert from the admin path | 3 tests failed |

Each mutation is a plausible refactor, and each failed exactly the test claiming to cover it.

**The guard was tested both ways**: a clean tree passes (25 files checked), and a probe controller importing `invitations` directly fails with an explanation naming the four repository methods.

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| IDOR on a parent returns nothing | `docs/SECURITY/05` § 1, 2 | `returns null when the invitation belongs to someone else`, mutation-checked |
| Existence is not leaked by a status difference | ADR-018, `docs/SECURITY/05` § 4 | Non-owner and non-existent both `null`, asserted separately |
| List endpoints filter in SQL | `docs/SECURITY/05` § 5 | Two users seeded; mutation would show as extra rows |
| Cross-tenant sub-resource is closed | `docs/SECURITY/05` § 6, 7 | Three tests from three angles, two mutation-checked |
| Every admin bypass is audited | `docs/SECURITY/05` § Special Case | Audit row asserted; mutation removing it fails 3 tests |
| An unauditable bypass cannot return data | `docs/SECURITY/00` | `fails closed when the audit row cannot be written` |
| Direct table access cannot reach production | `docs/SECURITY/05` | `scripts/check-tenant-scope.mjs`, blocking in `pre-push` and `verify.sh` |

**Not verified, and not claimed**: that endpoints will actually use this layer. There are no endpoints. The guard makes bypassing it fail the build, which is the strongest thing available before Phase 1 exists.

## Definition of Done Verification

- [x] No exported function fetches a tenant-owned row without a scope or an explicit `admin` name
- [x] Non-owner access returns `null` at the repository layer
- [x] The cross-tenant sub-resource case is covered — three tests
- [x] The guard is in place and fails on a deliberately introduced violation
- [x] `adminFind*` writes an audit row; asserted, and mutation-checked

## What Did Not Work

**Adding this suite broke twenty tests in another one, and the cause was three tasks old.** The templates suite — written before `invitations` existed — cleared its tables in an order that could not work once another suite left invitations behind: `invitations` RESTRICTs `template_versions`. Twenty failures, none of them in the code under test.

I had noted "suites share one database" as a follow-up in `P0-08`, `P0-09` and `P0-10` without acting on it. This is what that costs. Fixed properly with a single `resetTenantData()` using `TRUNCATE users, templates, media RESTART IDENTITY CASCADE` — naming the three roots and letting PostgreSQL work out the dependents, so the ordering question disappears rather than being re-solved per suite. `packages` and `addons` are deliberately excluded: nothing cascades upward into them and the seed must survive.

**Deleting a `const URL` silently rebound to the global `URL` class.** While migrating the users suite onto the shared helpers I removed its local `URL` constant. One test still referenced `URL.replace(...)`, and instead of failing to compile it resolved to the DOM/Node `URL` constructor — a runtime `TypeError` in one test rather than an error at build time. TypeScript cannot help here: the global genuinely exists. Replaced with `applicationPool()`, which is what that test wanted anyway.

**The structural child-table type did not survive Drizzle's generics.** `interface InvitationChildTable extends PgTable { id: PgColumn; invitationId: PgColumn }` produced an unreadable conditional-type error from `.from()`. The union that replaced it is better on its own merits, so this counts as the type system pushing toward the right design rather than away from it.

## Follow-Ups and Open Questions

- **`P0-19` should replace `resetTenantData` with real isolation** — a transaction per test, or a database per suite. Truncation is correct but it is why `fileParallelism: false` is still required.
- **The guard checks imports, not queries.** A module could receive a table as a parameter and query it unscoped without importing anything. That is a much less likely accident than an import, and catching it would need type-aware analysis. Worth revisiting if it ever happens.
- **`findOwnedChild` covers eight child tables.** `invitation_settings`, `invitation_quote` and `invitation_custom_domains` are keyed by `invitation_id` and need a dedicated method; `invitation_view_counts` has a composite key. Add them in the phase that first needs them, in this file.
- **`OQ-17` is still open** — the repository does not reconcile `template_id` against `template_version_id`.
- **Row-Level Security is still not used.** `docs/SECURITY/05` specifies application-level isolation, and `P0-06` left the application role unable to bypass RLS should it ever be added. The groundwork exists; the second mechanism does not.

## What to Watch

**The guard is the load-bearing part, not the repository.** The repository is correct today and will stay correct; the risk is a handler that never calls it. `scripts/check-tenant-scope.mjs` blocks that on push and in `verify.sh` — but with CI deferred (ADR-028), `--no-verify` skips it and a fresh clone has no hooks until `pnpm install`. That is the weakest link in the project's number-one security control, and it is a consequence of `P0-17` being deferred rather than of anything in this task.

**`ALLOWED` in the guard is a list that will be asked to grow.** Every entry is a module permitted to query tenant tables directly. Adding one is the cheapest possible way to reintroduce the hole, and it will look like a small config change.

**The admin path returns soft-deleted invitations.** That is deliberate — support needs exactly the row a user says has vanished — but it means the admin path is the one place where a deleted invitation is still reachable. Any future feature built on it should not assume `deleted_at IS NULL`.
