# P1-10 — Invitation list, detail, update, soft delete

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-10 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-10-invitation-crud` |
| **Status** | Completed |
| **Spec** | Written into this record. The card's six steps are the specification |

---

## What Changed

`GET /invitations`, `GET /invitations/:id`, `PATCH /invitations/:id` and
`DELETE /invitations/:id`. Explicit response DTOs, the owner filter in SQL, and the first
real use of `P1-06`'s `expectIdorSafe`.

## Why

`docs/API/04`, and `docs/SECURITY/05` — the project's number one security concern. These
are the first four endpoints that take an `:id` from a URL, which is what every other
`:id` endpoint in Phases 1 to 5 will look like.

## How

**The owner filter is in the SQL, and there is nowhere else it could be.** Every read goes
through `InvitationRepository`, whose methods take a branded `TenantScope`.
`docs/SECURITY/05` § 5 names response-level filtering as the wrong implementation by name:
it works until a `.filter()` is dropped in a refactor, and then it leaks every tenant at
once through an endpoint that still looks correct.

**`total` is a separate count with the same predicate.** Not `rows.length`, because the
rows are a page — and a total computed without the owner filter would both leak the
platform's size and make pagination lie.

**Explicit DTOs, not the row.** `docs/SECURITY/08` § Mass Data Exposure. Returning the row
works today and becomes a leak the moment somebody adds a column, because nothing in the
code would have to change for it to start being served. A projection inverts that: a new
column is served only when somebody decides to serve it.

**The update input type has one property.** `status`, `owner_id`, `published_at`,
`expiry_date` and `template_version_id` are not parameters anywhere in the chain — the Zod
schema is `.strict()`, the service builds its argument field by field, and the repository's
`changes` type has one key. `status` in particular moves only through
`InvitationStatusService`, which `scripts/check-status-writes.mjs` enforces.

**Soft delete releases the slug**, because the unique index is partial over live rows
(ADR-033) and `docs/DATABASE/04` § Notes says "a slug can be reused after the old
invitation is truly deleted". The API response says so, since that is the part a user is
most likely to be surprised by in either direction.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/invitation/invitation.service.ts` | **New** |
| `backend/api/src/modules/invitation/invitation.dto.ts` | **New** — the explicit projections |
| `backend/api/src/modules/invitation/invitation.controller.ts` | Four endpoints added |
| `backend/api/src/shared/tenancy/invitation-repository.ts` | `countOwned`, `updateOwned`, `softDeleteOwned`, `loadAggregate`, `findOwnedSingleton` |
| `backend/api/test/integration/invitation-crud.itest.ts` | **New** — 29 tests |
| `backend/api/test/invitation-http.spec.ts` | 18 tests added |

No migration.

## Decisions Made

| Decision | Rationale |
|---|---|
| `total` is its own count | `rows.length` is a page; an unscoped count would leak the platform's size |
| The aggregate is six parallel scoped reads | Each goes through `findOwnedChildren`, which validates child **and** parent owner in one statement |
| `findOwnedSingleton` is separate | `invitation_settings` and `invitation_quote` are keyed by `invitation_id` and have no child id to validate |
| `PATCH` returns the full detail | A client that just renamed something needs the same object it was rendering; a second request to get it is a race |
| `DELETE` is 200 with a body, not 204 | The body says the slug is released |
| Settings fall back to defaults rather than `null` | `P1-09` always creates the row; the fallback is for rows that predate it, and a client should not have to handle a missing settings object |

## Deviations from `docs/`

None.

## Tests Added

47 (29 integration, 18 HTTP). API integration 447 → 476; unit 268 → 286.

| Group | Cases |
|---|---|
| **IDOR** | detail through `expectIdorSafe`; **update leaves the row unchanged**; **delete leaves `deleted_at` null**; **list never contains another tenant's invitation**; the total counts only mine |
| List | empty for a new account; paginates with a whole-set total; **filters by status in SQL**; omits soft-deleted; **the summary shape has exactly ten keys** |
| Detail | **the seventeen documented keys**; nested entities embedded; a soft-deleted invitation is 404 to its own owner; an unknown id is 404 |
| Update | changes `internal_name`; returns the full detail; **status cannot be changed**; **four more non-writable fields**, each also asserting the legitimate field went through; a soft-deleted invitation cannot be updated |
| Soft delete | **the row survives with `deleted_at` set**; the transition is recorded; **the slug is freed**; a second delete is 404; other invitations are untouched |
| No `SELECT *` | `deleted_at` never appears in a response; a 404 error carries nothing |
| HTTP | four routes 401 without a token; **three routes 404 for another user's invitation with no data**; a paginated envelope; an unknown status filter is 400; the full aggregate; **six non-writable fields rejected**; only `internal_name` reaches the service; DELETE names the slug release |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| The list filters by owner in SQL | `docs/SECURITY/05` § 5 | `"list: a second user's invitations never appear"`. **Mutation**: removing `eq(invitations.ownerId, scope)` from `findOwnedList` fails it |
| All four endpoints 404 for another user | `docs/SECURITY/04` § Note | `expectIdorSafe` for detail; explicit service tests for update and delete that also assert **nothing changed**; three HTTP tests asserting 404 with no `data` |
| Status cannot be changed through PATCH | Card DoD 3 | `"status cannot be changed through it"`. **Mutation**: making both the service and the repository spread their argument fails 5 tests |
| No `SELECT *` reaches a response | `docs/SECURITY/08` | Two key-set assertions (ten keys for the summary, seventeen for the detail) and a `deleted_at` absence check |
| A soft-deleted invitation is unreachable | — | 404 to its own owner, absent from the list, and not updatable |

## Abuse Cases Covered

Cross-tenant read, write and delete, all three asserting both the 404 and that no data
moved. Mass assignment on PATCH, six fields at HTTP and five at the service.

## DoD Verification

- [x] The list query filters by owner in SQL; a test with two seeded users proves no leakage. `createTwoTenants`, and the mutation that removes the predicate.
- [x] All four endpoints return 404 for another user's invitation. Service and HTTP, and the service tests additionally assert the target row was untouched.
- [x] Status cannot be changed through `PATCH`; a test sends `status: "published"` and asserts nothing happened. Both the status and `published_at` are asserted unchanged.
- [x] The detail response matches `docs/API/04`'s shape, including nested entities. The key set is asserted exactly, so a field added or dropped fails.
- [x] A soft-deleted invitation disappears from the list but its row survives with `deleted_at` set. Plus: its slug is freed, and it is 404 to its own owner.

## What Did Not Work

**1. A mutation aimed at the wrong layer passed, and that was informative.** Making
`InvitationRepository.updateOwned` spread its argument changed nothing, because the
*service* builds `{ internalName }` explicitly before calling it. The whitelist is at the
service; the repository's narrow type is the second layer. Mutating both at once fails 5
tests, which is the honest statement of where the defence lives.

**2. `changed_at` does not exist.** The status-history table's timestamp is `created_at`.
A test asserting the most recent transition was querying a column that is not there, and
failed loudly — which is the right failure, but worth noting because the column name is
the sort of thing the next sub-resource task will get wrong too.

## Follow-Ups and Open Questions

- **`POST /invitations/:id/change-template` and `/upgrade-template-version` are not
  here.** `docs/API/04` lists them beside these four; they are BR-3.2 and BR-4.1 and
  belong with the template tasks in Phase 2. Not on this card's steps.
- **The aggregate is six queries.** Fine at one invitation per request; if the dashboard
  ever loads several details at once it becomes N×6. A join or a `json_agg` would fix it
  and would also make the owner predicate harder to read, which is why it is not done yet.
- **`P1-11` onwards add the sub-resources**, and each must use `findOwnedChild` — the
  version that validates the child's parent **and** the parent's owner in one statement
  (`docs/SECURITY/05` §§ 6 and 7).

## What to Watch

**The `total` count is a second query with a duplicated predicate.** It has to agree with
`findOwnedList` or pagination lies. They are adjacent in the file for that reason;
extracting a shared helper with a boolean would make them easier to diverge, not harder.

**`expectIdorSafe` passes `(invitationId, scope)` and the service takes `(scope, id)`.**
Getting that backwards produces a test that passes for the wrong reason — which is exactly
what the helper's positive half catches, since it also asserts the owner can still read
their own invitation. Worth knowing before writing the next twelve of these.
