# P1-15 — Change template without data loss

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-15 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-15-change-template` |
| **Status** | Completed |
| **Spec** | `MEMORY/specs/P1-15-change-template.md` (written before implementation) |

---

## What Changed

`POST /invitations/:id/change-template` — swap the presentation layer and touch no
invitation content. `template_id` and `template_version_id` move to the target's newest
published version; `enabled_sections` is recomputed by `section_key` equality;
`theme_override` keys the new template does not permit are dropped. The response names what
will stop being displayed, so `docs/UI-UX/05`'s confirmation modal can say it first.

## Why

BR-4.1, and `docs/PLAN/17` line 8, which makes "users can switch templates without losing
data, tested with a scenario where fields disappear and reappear" an acceptance criterion for
the whole product rather than a card DoD.

The feature is almost entirely an absence: the value is in what the code path does **not**
do. That is the hardest kind of guarantee to keep, because an absence cannot be read off a
diff. A `DELETE FROM invitation_gallery` added here in two years would look like tidying up
after a section that "is not used any more".

## How

**Nothing is deleted, proven three ways.** A row-count and row-for-row comparison across all
seven child tables; the A → B → A round trip asserting the original snapshot returns
unchanged, gallery photo ids included; and a source-level test that reads
`change-template.service.ts` and the body of `InvitationRepository.changeTemplate` and fails
on the word `delete`. The third is the one that keeps working when somebody adds a cleanup
they think is harmless.

**Section recompute: "the old template did not have it", not "it was not enabled".** The
card's formula is intersection plus the new template's `enabled_by_default` sections that
were not previously known. *Previously known* means defined by the old template. A section
the old template offered and the user deliberately switched off must stay off; only a section
that is genuinely new to this user arrives in its template's default state. The two readings
differ on exactly the case a user notices — turn the gallery off, change template, find it
back on the page.

**A non-configurable section of the new template is forced on.** `P1-14` refuses to let
anyone disable one, so a recomputed selection omitting a structural section would be a state
the API cannot produce and cannot repair: every later settings save would 422 with
`SECTION_NOT_CONFIGURABLE` on a value the server itself wrote. It also renders an invitation
with no hero, which is a blank page.

**Theme overrides are dropped and section data is not** — ADR-054. The line is who owns the
namespace: `gallery` photos are the couple's and a template only decides whether to show
them; `colors.accent` means whatever this template says it means, and carried into a template
that does not offer the key it is a value with no referent.

**One transaction, audit row included.** A committed `template_version_id` with a stale
`enabled_sections` is an invitation rendering against a definition that does not describe it.
`AuditLogService.record` takes a `Transaction` and cannot open its own, so the trail cannot
commit without the change it describes.

**No status change, so no status-history row.** A template change is not a lifecycle event.
The trail goes to `audit_logs`; `invitation_status_history.to_status` is `NOT NULL` and
inventing a status to fill it would corrupt the one table whose job is answering "how did
this invitation get here".

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/invitation/change-template.service.ts` | **New** — the service, plus `recomputeSections` and `dropThemeKeys` |
| `backend/api/src/shared/tenancy/invitation-repository.ts` | `changeTemplate` — two writes and the audit row in one transaction, owner predicate in the `WHERE` |
| `backend/api/src/modules/invitation/settings.service.ts` | `parseSections` widened to carry `enabledByDefault`; `ParsedSection` exported |
| `backend/api/src/modules/invitation/invitation-create.service.ts` | `defaultSections` now delegates to `parseSections`; its private `TemplateSection` interface removed |
| `backend/api/src/modules/invitation/invitation.controller.ts` | `POST :id/change-template`, `changeTemplateSchema` |
| `backend/api/src/modules/invitation/invitation.module.ts` | provider and export |
| `docs/API/04-INVITATION-API.md` | **Amended** — the response shape, which the document did not specify |
| `MEMORY/specs/P1-15-change-template.md` | **New** |
| `backend/api/test/integration/change-template.itest.ts` | **New** — 27 tests |
| `backend/api/test/invitation-http.spec.ts` | 12 tests added |
| `backend/api/test/integration/settings.itest.ts` | `parseSections` expectation updated for the new field |
| `TASKS/BACKLOG.md` | OQ-23 raised; a note that PG-16 has no owning card |

No migration.

## Decisions Made

| Decision | Rationale |
|---|---|
| **Theme overrides are dropped, section data is kept** (ADR-054) | Who owns the key namespace. Card step 4 asks for the drop; BR-4.1 forbids the deletion. Both are right about different things |
| Arrivals are keyed on the old template's **section list**, not the old **selection** | "The user turned it off" must survive a template change |
| A non-configurable section of the new template is forced on | Otherwise the server writes a selection `P1-14` will reject on the next save |
| `TEMPLATE_UNCHANGED` rather than a silent success | Re-resolving the version would make this a covert `upgrade-template-version`, which `docs/API/04` line 16 deliberately keeps separate |
| An unknown `template_id` is 404, not 422 | Matches `P1-09`, and keeps the endpoint from answering "does this template exist?" |
| Rate limited on `general-authenticated` | `docs/SECURITY/10` already declares the baseline. Inventing a number would put a limit in code the table does not know about |
| `parseSections` is the single reader of `sections` | Three independent readers of one `jsonb` column would disagree about a default eventually, and it would surface as a section on for a new invitation and off after a template change |
| A published invitation may change template | No rule forbids it; refusing would be inventing one. Logged at `warn`, raised as OQ-23 |

## Deviations from `docs/`

**`docs/API/04` amended** — the endpoint was specified by request only, with no response body.
Card steps 4 and 5 require the response to name the hidden sections and dropped theme keys,
so the shape is now in the document rather than invented in code and left undocumented.

Nothing else. `docs/PLAN/07`'s matching rule, `docs/UI-UX/05`'s modal contents and
`docs/DATABASE/10`'s audit policy are implemented as written.

## Tests Added

39 (27 integration, 12 HTTP). API unit 442 → 454; integration 602 → 629.

| Group | Cases |
|---|---|
| The change | version moves; the newest **published** version is locked even when a draft is newer; a draft-only template is refused; unknown template 404; changing to the current template refused |
| **Nothing is deleted** | every content row survives a change that hides two sections; **the A → B → A round trip restores the full selection and every row unchanged**; **the code path contains no delete statement** |
| The recompute | carries what both define and adds what is new; **a section the user turned off stays off**; **a non-configurable section is forced on**; the result is always valid under the new template; it is stored, not only returned |
| Theme keys | dropped keys named and removed; nothing dropped when the new template permits the same keys |
| The trail | one audit row with both states and the hidden keys in `reason`; **no audit row when the change is refused** |
| IDOR | service refuses a foreign scope and the victim's template does not move; **the repository refuses one too, tested directly**; a soft-deleted invitation is 404 |
| Pure functions | `recomputeSections` order, hidden list, malformed `jsonb` on either side, no duplicates; `dropThemeKeys` exact key matching, nested rebuild, drop-everything |
| HTTP | the response shape; **five body-smuggling rejections**; three shape rejections; 404; 401; 429 |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| Cross-tenant template change | `docs/SECURITY/05` § 1 | `"a foreign scope cannot change my template, and mine does not move"` (service) and `"the repository refuses a foreign scope even when the service is bypassed"`. **Mutation**: removing the `owner_id` predicate from `changeTemplate` fails the second test — and **only** the second |
| A lifecycle or computed field smuggled through the body | `docs/SECURITY/05` § 3 | Five HTTP rejections: `template_version_id`, `enabled_sections`, `theme_override`, `status`, `owner_id` |
| A draft template version reached deliberately | BR-3.3 | `"a template whose only version is a draft is refused"`, plus `"locks the newest published version, not a draft one"` |
| The stored selection cannot become unrepairable | `P1-14` | `"a non-configurable section of the new template is forced on"`. **Mutation**: emptying `structural` fails it |
| The user's own choice is not overwritten | card step 2 | `"a section the user turned off stays off when the new template also has it"`. **Mutation**: keying arrivals on the previous *selection* instead of the previous *template* fails it |
| No data is destroyed | BR-4.1 | Three tests. **Mutation**: a `delete(invitationGallery)` added to `changeTemplate` fails all three |
| The trail cannot come apart from the change | `docs/DATABASE/10` | `"writes no audit row when the change is refused"`, and the audit callback in the repository IDOR test throws if it ever runs on a refused write |

## Abuse Cases Covered

Changing another tenant's template; pinning an invitation to a draft version; smuggling
`enabled_sections` to enable a section the template does not define; smuggling `status` or
`owner_id`; enumerating template ids through the error; churning template changes (rate
limited); leaving a ghost section key in `enabled_sections` that later breaks the settings
screen.

## DoD Verification

- [x] No delete statement runs anywhere in this code path. Asserted by row counts, by a
      round-trip snapshot comparison, and by reading the source.
- [x] The round-trip test (template A → B → A) restores full rendering with no data loss.
      `enabled_sections` returns to `["hero", "gallery", "gift"]` and every child row is
      byte-identical, ids included.
- [x] The response names the sections that will stop displaying. `hidden_sections`.
- [x] Theme overrides invalid under the new template are dropped, not silently kept and
      ignored. `dropped_theme_keys`, and ADR-054 says why that is not a contradiction of
      BR-4.1.

## What Did Not Work

**1. The service-level IDOR test did not catch the missing owner filter.** Removing
`eq(invitations.ownerId, scope)` from `changeTemplate` failed exactly one test — the
repository-level one — because `requireOwnership` in the service had already refused the
request before the repository was reached. This is `P1-12`'s lesson confirmed for the fourth
time: **defence in depth makes each layer untestable from outside**. The repository test was
written because of that warning, not because of this mutation, and it is the only thing
standing between a future caller that skips the load and a cross-tenant write.

**2. The test fixtures invented component and section names, and `P0-20`'s validator caught
every one.** `GiftList`, `HeroModern`, `StoryTimeline`, `CountdownRing`, `MusicPlayer`,
and the section keys `story`, `countdown` and `music` are all things a real template cannot
contain: `SECTION_KEYS` is a ten-value enum and `COMPONENT_REGISTRY` binds each component to
exactly one section. The factory validates, so the fixtures could not be written wrong
quietly. Worth stating plainly: a test suite full of plausible-looking template fixtures that
no validator would accept would have been testing a shape the product cannot produce.

**3. The validator also refused `configurable: false` with `enabled_by_default: false`**, on
the grounds that a non-configurable section is always rendered so the flag can never take
effect. The force-on test was rewritten to reach the same state legitimately — template A
marks `gallery` configurable, so the user *can* turn it off there, and the target template
makes the same key structural.

**4. Widening `parseSections` broke a `P1-14` test that asserted its exact return shape.**
Expected, and the right kind of break: the test is an equality assertion on a parser's output,
which is what makes it useful. Updated, with a new case asserting the `enabledByDefault`
default rather than only accommodating the new field.

## Follow-Ups and Open Questions

- **OQ-23 — may a `published` invitation change template, and must the publish check re-run?**
  Implemented as allowed and logged at `warn`; three candidate answers are written down.
  Needs settling before `P2-06` builds the publish check, because option one makes this
  endpoint depend on it.
- **PG-16 has no owning task card.** `upgrade-template-version` is a promise BR-3.2 makes to
  users and nothing currently keeps. The mechanism is nearly identical to this endpoint's, so
  the temptation to fold it in was real — and folding it in would have hidden the planning
  gap. `P2-01` is the closest fit. Noted in `BACKLOG.md` beside PG-16.
- **Cache invalidation is missing, deliberately.** There is no public page cache in Phase 1.
  When `P2-07` adds one, changing a template must invalidate the invitation's key — otherwise
  the guests keep seeing the old design and the owner sees the new one.
- **`enabled_sections` ordering now follows the new template's section order.** Nothing
  depends on it yet; `P2-02`'s renderer should read the template's order rather than trusting
  this array's, and if it does, this ordering is a convenience rather than a contract.

## What to Watch

**The three no-delete assertions protect each other.** The source-level check catches a
delete that a test fixture happens not to cover; the row-count check catches a delete issued
from somewhere the source check does not read; the round trip catches data that is present
but no longer reachable. Removing any one of them because "the others cover it" removes the
case the others do not.

**`recomputeSections` reads two template definitions and trusts neither.** Both come from
`jsonb`. If `parseSections` is ever tightened to throw on a malformed row rather than skip
it, a template change on an old invitation starts failing with an error nobody will connect
to a definition written two years earlier. The test named `"tolerates a malformed sections
column on either side"` is what stands there.

**The `warn` line `invitation.template_changed_while_published` is the only visibility into
OQ-23.** If it starts appearing regularly in production, the question has stopped being
hypothetical and the publish check needs an answer before `P2-06`.
