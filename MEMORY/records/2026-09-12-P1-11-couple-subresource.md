# P1-11 — Couple sub-resource

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-11 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-11-couple-subresource` |
| **Status** | Completed |
| **Spec** | Not required by the card |

---

## What Changed

`PATCH /invitations/:id/couple/{groom,bride}` — partial updates over the seven fields
`docs/PLAN/08` § Person defines, with `photo_media_id` validated as a **second tenancy
boundary**.

## Why

`docs/API/04` § Couple/Person. The interesting requirement is the card's step 2, which is
also `docs/SECURITY/05` § 6: the route's own `:id` is checked, so the caller demonstrably
owns the invitation — and can still pass the media id of somebody else's photo, which would
then render on their public page.

## How

**An `UPDATE`, never an upsert.** `P1-09` creates both people rows empty with the
invitation, so there is nothing to insert. That is not a convenience: an upsert would race
between two tabs and could produce a second `groom` row, and `toInvitationDetail` resolves
duplicates by picking whichever came back first — so the page would silently show one of
two values.

**Three conditions on the photo, each rejecting a different real mistake.** It must exist
(a typo, or a stale id from a deleted upload); it must belong to **this** invitation (the
cross-tenant reference); and it must be `ready` (a file still in the pipeline has not been
through `docs/SECURITY/06`'s magic-byte, EXIF and malware stages, so referencing one would
put an unvalidated file on a public page the moment it finished processing).

**Scoped by invitation, not by owner.** Narrower, and correct: a photo belonging to a
*different invitation of the same user* is still the wrong photo. There is a test for that
case specifically.

**All three rejections give the same message.** Telling them apart would let a caller probe
which media ids exist, which is the enumeration the 404 rule closes everywhere else. The
test compares the serialised errors, not just the status.

**The role is in the path, not the body.** Two routes, as `docs/API/04` writes them, so the
role cannot be tampered with independently of the resource being addressed. An unknown role
is a **404** rather than a 400 — `/couple/spouse` is not a route that exists, and a
validation error would imply it might.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/invitation/couple.service.ts` | **New** |
| `backend/api/src/shared/tenancy/invitation-repository.ts` | `updatePerson`, `mediaBelongsToInvitation` |
| `backend/api/src/modules/invitation/invitation.controller.ts` | The endpoint, and `personSchema` |
| `backend/api/src/modules/invitation/invitation.module.ts` | Provider |
| `backend/api/test/integration/couple.itest.ts` | **New** — 19 tests |
| `backend/api/test/invitation-http.spec.ts` | 16 tests added |

No migration.

## Decisions Made

| Decision | Rationale |
|---|---|
| `UPDATE`, never upsert | A duplicate `groom` row would be resolved silently by whichever query returned first |
| The photo check is scoped by invitation, not owner | A photo from another invitation of the same user is still the wrong photo |
| `status = 'ready'` is part of the check | An unvalidated file would go public the moment processing finished |
| One message for all three rejections | Distinguishing them is a media-id enumeration oracle |
| An unknown role is 404 | `/couple/spouse` is not a route; a 400 would imply it might be |
| The empty patch reads through the same scoped path | Keeps "what can this caller see" in one place |
| `updatePerson` uses a correlated `EXISTS` for ownership | Drizzle cannot join in an `UPDATE`; the predicate is still in the same statement, so there is no check-then-write window |

## Deviations from `docs/`

None.

## Tests Added

35 (19 integration, 16 HTTP). API integration 476 → 495; unit 365 → 381.

| Group | Cases |
|---|---|
| Updating | updates the existing row; **three concurrent updates leave one row**; touches only the named half; partial; **an empty patch reads without writing**; `null` clears; **`role` cannot be changed through the body** |
| **Photo tenancy** | accepts one belonging to this invitation; **rejects one from another invitation**; **rejects one from another invitation of the same user**; rejects `processing` and `failed`; rejects a missing id; **the same message for every reason**; `null` clears |
| IDOR | another user cannot update the groom or the bride, **and the row is unchanged**; a soft-deleted invitation is 404; an unknown invitation is 404 |
| HTTP | both roles; **four unknown roles are 404, not 400**; another user's invitation is 404 with no data; 401 without a token; **five name fields sanitized**; three forbidden body fields rejected; three shape rejections; `null` accepted |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| A photo from another invitation cannot be referenced | `docs/SECURITY/05` § 6 | `"rejects a photo from ANOTHER invitation"`. **Mutation**: removing `eq(media.invitationId, invitationId)` fails 3 tests |
| A photo from another invitation of the same owner is also refused | — | `"rejects a photo from another invitation of the SAME user"` |
| An unvalidated file cannot be referenced | `docs/SECURITY/06` | `"rejects a photo whose status is processing / failed"`. **Mutation**: removing `eq(media.status, "ready")` fails both |
| The rejection is not a media-id oracle | `docs/SECURITY/04` § Note | `"gives the same message for every rejection reason"` compares the serialised errors |
| A non-owner cannot update either person | `docs/SECURITY/05` § 1 | Two `expectServiceIdorSafe` cases, each also asserting the row is untouched |
| No duplicate person row is possible | Card DoD 1 | `"creates no duplicate person row"` — three concurrent updates, one row |
| Script payloads do not survive storage | Card DoD 3 | `"sanitizes every name field"` — five fields, five payload shapes, asserting exactly what reached the service |

## Abuse Cases Covered

The cross-tenant media reference in both its forms, an unvalidated file, IDOR on both
roles, `role` smuggled in the body, and stored XSS on all five name fields.

## DoD Verification

- [x] Both endpoints update the existing row; no duplicate person row can be created. Three concurrent updates leave exactly one row.
- [x] A `photo_media_id` from another invitation is rejected, with a test. Two tests — a different tenant's, and a different invitation of the same user's — plus the mutation that makes them fail.
- [x] Script payloads in names do not survive storage. `P1-16`'s pipeline, asserted at the HTTP boundary over all five name fields.
- [x] IDOR tests pass for both endpoints. And assert the target row is unchanged, not only that the call was refused.

## What Did Not Work

**1. I invented a media status that does not exist.** A test asserted `quarantined` was
rejected; `media_status_check` permits `processing`, `ready` and `failed` only, and the
insert failed on the constraint. That is the schema doing its job — `docs/SECURITY/06`'s
malware stage marks a file `failed`, and there is no quarantine state. The test now covers
the two that exist.

**2. `storageKey` is `storage_path`.** A fixture used the wrong column name and eight tests
failed on a `NOT NULL` violation. Loud, and worth noting for the next sub-resource task.

## Follow-Ups and Open Questions

- **`mediaBelongsToInvitation` will be needed by `P1-12`'s gallery too**, and by anything
  else that takes a media reference. It lives in the repository for that reason.
- **Nothing populates `media` yet.** `P1-17`–`P1-19` build the upload pipeline; until then
  the only way a photo reference can be valid is a hand-inserted row. The check is
  therefore currently proven only against fixtures, which is the honest state.
- **`P1-16` sanitizes at the controller**, so the service receives clean values. A future
  caller of `CoupleService.update` from a job would bypass that — there is no such caller,
  and if one appears it must sanitize itself or the registry moves into the service.

## What to Watch

**The photo check is the pattern for every reference field from here on.** Gallery
(`P1-12`), the cover image, and anything in Phase 2 that names a media id all have the same
hole. `docs/SECURITY/05` § 6 exists because checking the path parameter feels like enough.

**`updatePerson`'s ownership predicate is a correlated subquery rather than a join**, because
Drizzle cannot join in an `UPDATE`. It is the same condition in the same statement, but it
reads differently from every other method in that file — a reader skimming for
`eq(invitations.ownerId, scope)` will not find it.
