# P1-12 — Events sub-resource

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-12 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-12-events` |
| **Status** | Completed |
| **Spec** | Not required by the card |

---

## What Changed

Full CRUD over N events per invitation, with `:event_id` scoped by `:id` in the query,
`maps_url` generated from coordinates, and `display_order` maintained.

And, more importantly, **five repository-level tests that exist because a mutation revealed
the service tests were verifying nothing about either scoping layer.** See *What Did Not
Work* — that finding is the most valuable thing in this task.

## Why

`docs/API/04` § Events and `docs/BACKEND/03` § Example Structural Schema, which is the one
place in the documents that writes a request schema out in full. The card's first DoD item
is `docs/SECURITY/05` § 7's two-step rule, which is the sub-resource hole: owning the
parent is necessary and **not sufficient**.

## How

**Both conditions in one statement.** `findOwnedChild` checks the event's `invitation_id`
*and* the invitation's `owner_id` in a single query, and the writes carry the same pair.
Two separate reads would work and would be a trap — the second is the one somebody deletes
while simplifying.

**`maps_url` is recomputed from the coordinates the patch will produce**, not the ones it
had. A venue moves, the link keeps pointing at the old place, and the guest is simply sent
somewhere else — a silent failure with no error anywhere. An explicitly supplied link is
never overwritten: somebody who pasted a `maps.app.goo.gl` short link or a place-id URL has
something better than a generated pin.

**`display_order` appends.** A new event must not silently jump to the front of a list the
couple ordered on purpose.

**A hard delete.** `docs/DATABASE/05` gives `invitation_events` no `deleted_at`, so
removing an event removes it. The invitation's own soft delete is what preserves history —
and a soft-deleted invitation *hides* its events without deleting them, which has its own
test.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/invitation/events.service.ts` | **New** — including `buildMapsUrl` |
| `backend/api/src/shared/tenancy/invitation-repository.ts` | `createEvent`, `updateEvent`, `deleteEvent`, `nextEventOrder`, `findOwnedEvent(s)`, `InvitationEventRow` |
| `backend/api/src/modules/invitation/invitation.controller.ts` | Four endpoints, `eventBase` schema, `coordinate()` |
| `backend/api/src/shared/sanitizer/registry.ts` | `maps_url` exempted, with the measured reason |
| `backend/api/test/integration/events.itest.ts` | **New** — 27 tests |
| `backend/api/test/invitation-http.spec.ts` | 22 tests added |

No migration.

## Decisions Made

| Decision | Rationale |
|---|---|
| `maps_url` gets an **http/https scheme allowlist**, not sanitization | It becomes an `href`. `z.url()` alone accepts `javascript:` — measured, see below |
| A supplied `maps_url` is never overwritten | A user's own short link or place-id URL beats a generated pin |
| `maps_url` is regenerated only when coordinates change | Recomputing on every patch would silently discard a supplied link |
| `display_order` appends | A new event must not reorder a deliberate list |
| A hard delete | `docs/DATABASE/05` gives the table no `deleted_at` |
| Coordinates are coerced to numbers for the range check, then stored as strings | `"200" > "90"` is false as a string; the check has to be arithmetic, and `DECIMAL(9,6)` comes back as a string |

## Deviations from `docs/`

None. The schema follows `docs/BACKEND/03`'s example field for field, plus `maps_url` and
`display_order`, which `docs/DATABASE/05` defines as columns.

## Tests Added

49 (27 integration, 22 HTTP). API integration 495 → 522; unit 365 → 387.

| Group | Cases |
|---|---|
| **The two-step rule** | **an event id from another invitation is 404 though the path invitation is mine**, and its title is unchanged; delete likewise deletes nothing; **an event of MY other invitation is also 404**; another user cannot list or create |
| **Each layer alone** | `findOwnedChild` refuses a child of my other invitation **and still finds it on the right parent**; refuses another tenant's; `updateEvent`, `deleteEvent` and `createEvent` each write nothing for a scope that does not own the invitation |
| CRUD | create and list; **N events per invitation**; partial update; delete; a second delete is 404; an empty patch reads without writing |
| `maps_url` | **generated when coordinates are present and it was empty**; null without coordinates; **a caller's own link is not overwritten**; **regenerated when coordinates change**; untouched when they do not; `buildMapsUrl` needs both |
| `display_order` | appends rather than prepends; lists in display order; an explicit order is respected; the next order ignores another invitation's events |
| Cascade | a hard delete of the invitation deletes its events; **a soft delete hides them without deleting them** |
| HTTP | all four routes; two 404s for another user's invitation; **nine shape rejections** including both coordinate ranges and a 24:00 time; **five `maps_url` schemes rejected** and two accepted; four text fields sanitized; `invitation_id` and `id` in the body rejected; 401 without a token |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| A child id from another invitation is refused | `docs/SECURITY/05` § 7 | `"findOwnedChild refuses a child of MY OTHER invitation"`. **Mutation**: dropping `eq(table.invitationId, invitationId)` fails it. *The service-level test for the same rule passed under that mutation* — see below |
| Every write carries the owner predicate | `docs/SECURITY/05` § 3 | `"updateEvent / deleteEvent / createEvent writes nothing for a scope that does not own the invitation"`. **Mutation**: dropping the owner `EXISTS` from `updateEvent` fails its test |
| A cross-tenant read is refused | `docs/SECURITY/05` § 1 | `"findOwnedChild refuses another tenant's child"`, plus two `expectServiceIdorSafe` cases |
| `maps_url` cannot carry `javascript:` | `docs/SECURITY/08` | The schema requires `^https?://`. **Measured**: `z.string().url()` returns `true` for `javascript:alert(1)`, `JaVaScRiPt:alert(1)` and `data:text/html,...` — run, not assumed |
| Coordinates are range-checked | Card DoD 3 | `z.coerce.number().min(-90).max(90)`, and the coercion is what makes the comparison arithmetic rather than lexical |
| A soft-deleted invitation exposes nothing | — | `"a soft-deleted invitation hides its events without deleting them"` |

## Abuse Cases Covered

The two-step hole in both its forms (cross-tenant, and same-owner-wrong-parent), a
`javascript:` URL in `maps_url`, out-of-range coordinates, and cross-tenant writes on all
three mutating repository methods.

## DoD Verification

- [x] An event id belonging to another invitation returns 404 even when the path's invitation is owned by the caller. Two tests, and a repository-level test that the *mutation actually fails*.
- [x] `maps_url` is generated when coordinates are present and it was left empty. Plus: not overwritten when supplied, regenerated when coordinates change, untouched when they do not.
- [x] Out-of-range latitude or longitude is rejected. By `z.coerce.number().min().max()`; the coercion is load-bearing.
- [x] Deleting an invitation cascades its events. Asserted against a hard delete, which is what the constraint governs, with the soft-delete behaviour asserted separately.

## What Did Not Work

**Both mutations passed on the first attempt, and the reason generalises to every remaining
sub-resource task.**

Dropping `eq(table.invitationId, invitationId)` from `findOwnedChild` broke **no test**.
The cross-tenant case still 404d, because the join reaches the invitation through the
child's *own* `invitation_id` and the owner predicate then fails. The same-owner-wrong-parent
case also still 404d — but for the wrong reason: the read returned the row, and the
subsequent `UPDATE`'s `invitation_id` predicate matched nothing, so the service threw
`NotFoundError` anyway. **The write was covering for the read.**

Dropping the owner `EXISTS` from `updateEvent` broke no test either, for the mirror-image
reason: the read had already 404d, so the write's own predicate was never exercised.

So each layer's defence was masked by the other, and every service-level test passed while
**neither layer was actually verified**. Five tests now call the repository directly, where
there is nothing else to catch the mistake, and both mutations fail.

This is the sixth time in this project that a test verified less than its name suggested,
and the sixth time only a mutation found it. It is also the first time the cause was
*defence in depth* rather than a weak assertion — which is worth knowing, because layered
checks are supposed to be good and they make each other untestable through the front door.

**`check-tenant-scope` also refused the first version of the service**, which imported
`invitationEvents` so it could name the table for `findOwnedChild`. That is the generic
method's cost: it asks the caller to hold the table. Two named wrappers —
`findOwnedEvent` and `findOwnedEvents` — now keep it inside the tenancy layer, and
`InvitationEventRow` is exported so the DTO mapper does not need the import either. Third
time that guard has caught a task reaching past the layer, and third time the fix was
better than the thing it refused.

## Follow-Ups and Open Questions

- **Every sub-resource task from here (`P1-13`, `P1-14`, `P1-15`, and Phase 2's gallery)
  needs repository-level tests, not only service-level ones.** The masking described above
  is structural, not specific to events. Recorded on those cards.
- **`maps_url`'s scheme allowlist should be shared** if another URL field appears. There is
  one today.
- **No E2E over the HTTP endpoints yet.** All four routes are covered at the service level
  and at the controller boundary; `P1-25` is the phase suite that exercises them end to end.

## What to Watch

**Defence in depth makes each layer untestable from outside.** That is the lesson here and
it will recur: two correct checks in sequence mean deleting either one changes no
observable behaviour. The only way to know both work is to test them where they live. Any
future "simplification" that removes one will be invisible to a service-level suite.

**`coordinate()` converts a number back to a string** for a `DECIMAL(9,6)` column. Exact
for six decimal places, and it would stop being exact if the precision ever grew.
