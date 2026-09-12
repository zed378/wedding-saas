# P1-08 — User profile, preferences, account deletion

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-08 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-08-profile-deletion` |
| **Status** | Completed |
| **Spec** | Written into this record — see *Decisions Made*. The card is `Spec required`; the design is small enough that a separate spec would have restated the API document |

---

## What Changed

The six endpoints in `docs/API/02`, all on `/users/me`: read and update the profile, change
the password, read and update notification preferences, request account deletion.

And **ADR-051**, which answers `OQ-11`: deleting an account does not take its published
invitations down.

## Why

`docs/API/02`, and `docs/SECURITY/09` § Data Subject Rights for the deletion half. The card
is explicit that the invitation question is "a decision, not an implementation detail".

## How

**There is no route with a parameter and no method with a user id.** `docs/API/02`
§ Object-Level Authorization asks for IDOR prevention "by design". Every path is
`/users/me`; every `UserService` method takes a `TenantScope` derived from the
authenticated row and nothing else. The attack has no parameter to travel in — not
"is rejected", but has nowhere to go.

**Mass assignment is blocked twice, and the two fail differently.** The Zod schemas are
`.strict()`, so a request carrying `role` is **rejected** rather than stripped — the
attempt becomes visible instead of a silent no-op. Below that, `updateProfile` takes a
named parameter type and builds its patch field by field, so a future edit cannot spread a
validated object into `.set()`.

**A password change spares the current session and revokes the others.** The revocation is
in the same transaction as the password write, for `P1-05`'s reason: a crash between them
leaves a new password and the attacker's session both working. The *current* session
survives, which is the difference from a reset — the user is here and authenticated, and
logging them out of the tab they are typing in costs usability and buys nothing.

**An OAuth-only account is sent to the reset flow.** It has no old password to confirm, and
proving control of the address is the only proof it can offer.

**Deletion, per ADR-051**: soft delete, every session revoked immediately, confirmation
email, and published invitations keep serving until their own expiry. The account dies at
once; the invitation outlives the login rather than the other way round.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/user/user.service.ts` | **New** |
| `backend/api/src/modules/user/user.controller.ts` | **New** — six endpoints, `.strict()` schemas |
| `backend/api/src/modules/user/user.module.ts` | **New** |
| `backend/api/src/app.module.ts` | `UserModule` |
| `backend/api/src/shared/tenancy/invitation-repository.ts` | `countOwnedByStatus` — see *What Did Not Work* |
| `backend/api/test/integration/user-profile.itest.ts` | **New** — 40 tests |
| `backend/api/test/user-http.spec.ts` | **New** — 36 tests |

No migration.

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Published invitations survive account deletion | Breaking a live invitation harms guests to remove data the requester published on purpose | ADR-051 (answers `OQ-11`) |
| The account is unusable immediately | Someone deleting because they fear compromise needs that now | ADR-051 |
| The email is not scrambled on soft delete | ADR-031's partial index already frees it; readable is what lets support answer "did I delete this?" | ADR-051 |
| `.strict()` rather than Zod's default strip | Stripping accepts a mass-assignment attempt silently; rejecting makes it visible | — |
| A password change spares the current session | The user is here; a reset is the flow for when they are not | — |
| An empty phone stores `NULL` | "No phone" should not be a value that sorts and compares like one | — |
| Missing preferences return defaults, not 404 | A missing preferences row is not a missing user | — |
| `NO_PASSWORD_SET` (422) for an OAuth-only account | The honest answer, and it names the flow that will work | — |

## Deviations from `docs/`

None in behaviour. **One specification gap**, recorded rather than deviated from: both
`docs/API/02` § Validation and the card's step 3 say `phone` is "validated in
BACKEND/03-VALIDATION.md", and `docs/BACKEND/03` **contains no phone rule**. The regex
implemented — `+62`, `62` or a leading `0`, then `8`, then 8 to 12 more digits — is written
at its definition as being this task's choice rather than a transcription, and ten cases
pin the behaviour.

## Tests Added

76 (40 integration, 36 HTTP). API integration 361 → 401; unit 212 → 248.

| Group | Cases |
|---|---|
| Reading | the documented fields; **never the password hash**; a soft-deleted account is gone |
| Updating | both fields; **an empty phone clears the column**; an empty patch changes nothing; only the caller's own row |
| **Mass assignment** | **eight forbidden fields, each asserting six columns unchanged** *and* that the legitimate field still went through — so it cannot pass by doing nothing; **cannot promote itself to admin**; **cannot mark its own email verified** (which would bypass `P1-02`'s publish gate) |
| Password | requires the current one; sets the new one; **revokes other sessions**; **spares the session that made the change**; policy enforced; **a failed change revokes nothing**; the owner is told; an OAuth-only account gets `NO_PASSWORD_SET` |
| Preferences | read; **marketing defaults to false**; one field at a time; defaults when the row is missing; the row is created; one user's are not another's |
| **Deletion** | soft delete; **every session ends immediately**; cannot log in after; confirmation sent; **published invitations keep serving and are counted**; drafts are not counted; a second request 404s; **the email is freed for a new account**; no other account touched |
| HTTP — no identifier | **two parameterised routes do not exist**; a `user_id` in the body is rejected |
| HTTP — auth | all six routes are 401 without a token |
| HTTP — schemas | five forbidden fields each rejected with the field named; only whitelisted fields reach the service; **ten phone cases**; four `full_name` length cases |
| HTTP — the rest | the cookie is handed down so the current session is spared; the delete response names the invitation behaviour |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| No endpoint accepts a user identifier | `docs/API/02` § Object-Level Authorization | `"GET /api/v1/users/:id does not exist"` (two routes, 404 because no such route) and `"a user_id in the body does not survive parsing"` |
| Mass assignment cannot escalate privilege | `docs/BACKEND/03` § Field Whitelisting | Eight parameterised service tests and five HTTP tests. **Mutation**: making `updateProfile` spread its argument fails 5 tests, including `"cannot promote itself to admin"` |
| A password change revokes other sessions | Card DoD 4 | `"revokes other sessions"`, and `"spares the session that made the change"` proves it is not simply revoking everything |
| A failed password change is inert | — | `"a failed change revokes nothing"` |
| Deletion ends every session at once | `docs/SECURITY/09` | `"ends every session immediately"`, `"the account cannot log in afterwards"` |
| One user cannot affect another | `docs/SECURITY/05` | `"only ever updates the caller's own row"`, `"one user's preferences are not another's"`, `"touches no other account"` |
| The profile never leaks the hash | — | `"never includes the password hash"` |

## Abuse Cases Covered

The mass-assignment set from the card's DoD, plus the two that matter most called out by
name (`role`, `email_verified`). Cross-tenant access is covered structurally and asserted
at three points.

## DoD Verification

- [x] No user endpoint accepts a user identifier from the client. Structural — no route has a parameter and no service method has the argument — and asserted at HTTP.
- [x] The mass-assignment test passes for all four forbidden fields. Eight, not four: `role`, `email`, `email_verified`, `status`, `password_hash`, `oauth_provider`, `oauth_subject_id`, `deleted_at`.
- [x] Account deletion soft-deletes, sends confirmation, and has documented behaviour for existing invitations. ADR-051, and the API response states the behaviour to the user.
- [x] Changing a password revokes other sessions. Plus the positive half: the current one survives.

## What Did Not Work

**No test failed on the first run**, which is worth recording as an oddity rather than a
triumph — the mutation was therefore the only evidence the mass-assignment tests were
doing anything, and it fails 5 of them.

**A build guard caught a real regression in the highest-priority rule.** The deletion
count started as a direct `select().from(invitations)` in `UserService`, and
`scripts/check-tenant-scope.mjs` refused the commit: importing a tenant-owned table
outside `shared/tenancy/` puts back exactly the hole that layer exists to close. The count
moved to `InvitationRepository.countOwnedByStatus`, where the owner predicate lives in the
one file that is supposed to be read carefully. This is the guard from `P0-11` doing the
job it was built for, on the first task that tried to go around it.

**The spec gap on `phone` is real and easy to miss.** `docs/API/02` points at
`docs/BACKEND/03`, which points nowhere. Left as a gap in the document with the choice
recorded here, rather than editing `docs/BACKEND/03` to contain a rule this task invented.

## Follow-Ups and Open Questions

- **`full_name` is not sanitized yet.** `P1-16` owns the sanitization pipeline and its
  registry already names "user full name". The window is real but closed before it can be
  exploited: nothing renders `full_name` on a public page until Phase 2's renderer, and
  `P1-16` lands first in this phase.
- **`P1-07`'s general policies are not applied to these routes.** They want a global guard
  rather than a per-route one — a chain-position change, noted on `P1-07`.
- **The hard delete does not exist.** BR-9's retention sweep is a cron job in Phase 4;
  until it lands, "deleted" means soft-deleted forever. That is the correct interim state
  and not a gap in this task.
- **`ON DELETE RESTRICT` is never exercised**, because nothing hard-deletes a user. When
  the BR-9 sweep is written it must delete invitations first or the constraint will stop
  it — which is the constraint working.

## What to Watch

**ADR-051 will look wrong to somebody.** "I deleted my account and my page is still up" is
a support ticket waiting to happen, and the answer is in the deletion response itself. If
counsel takes a different view, `"published invitations keep serving, and are counted"` is
the test to invert and `UserService.requestDeletion` the only place to change.

**`.strict()` will break a client before it breaks an attacker.** A frontend that sends
back a whole profile object on PATCH gets a 400. That is the intended behaviour and it
will be reported as a bug; `P1-20` should send only changed fields.
