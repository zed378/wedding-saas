# P1-23 — Frontend: schema-driven properties panel

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-23 |
| **Phase** | Phase 1 |
| **Surface** | web-app |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-23-properties-panel` |
| **Status** | Completed |
| **Spec** | Not required by the card; written into this record |

---

## What Changed

The properties panel: a loop over the active section's `required_fields` and
`optional_fields`, each path resolved through a registry to one of nine controls. Plus
`scripts/check-no-hardcoded-fields.mjs`, which fails the build if any component names a
section key or a canonical field path.

## Why

`docs/FRONTEND/03`, and `CLAUDE.md`'s first "what not to do": hard-coding section or field
logic per template "defeats the entire template system". The panel is the place that
temptation actually arises, because the shortest path to a working screen is always
`if (sectionKey === "hero")`.

## How

**Two registries, one vocabulary.** `@wi/schema`'s `INVITATION_FIELDS` is the path vocabulary
shared with the backend; `FIELD_REGISTRY` adds the form metadata the backend has no use for —
control type, Indonesian label, column width. `properties-panel.spec.tsx` asserts both
directions: every scalar path in the shared package has an entry here, and every key here is
a path the shared package recognises. Adding a field to `docs/PLAN/08` without a label fails
the frontend build.

**The panel is a loop with no switch on a section key.** Adding a field to a template's
`required_fields` changes the rendered form with no frontend change at all, and the test
demonstrates it by rendering twice with one string different in a fixture.

**`canonicalise` maps a concrete path to its registry entry.** A template says
`events.0.title`; the registry is keyed `events.*.title`. Indices and uuids both become `*`,
so one entry serves every element of a collection — and the first segment is never
wildcarded, because a numeric family name would be nonsense and would make every path look
like a collection.

**Validation mirrors the server and never replaces it.** Every rule here exists in the API
too, including the `^https?://` check `P1-12` added after measuring that Zod's `.url()`
accepts `javascript:alert(1)`. It does **not** sanitize — that is the server's job and a
frontend that did it would make the server's sanitiser look unnecessary. An invalid value is
still sent, because the client having the final say on a rule it only mirrors is how a
too-strict mirror silently blocks legitimate input.

**Empty is not invalid.** Whether a field may be empty is a completeness question settled by
`required_fields` at publish time (BR-4.2), not something to shout about while somebody is
filling a form in. Errors appear on first change, not on mount.

## Files and Components Touched

| Path | Change |
|---|---|
| `frontend/web-app/src/editor/fields/registry.ts` | **New** — `FIELD_REGISTRY`, `COLLECTION_PATHS`, `canonicalise` |
| `frontend/web-app/src/editor/fields/validate.ts` | **New** — the mirror of the server's rules |
| `frontend/web-app/src/editor/fields/FieldControl.tsx` | **New** — nine controls, no section knowledge |
| `frontend/web-app/src/editor/PropertiesPanel.tsx` | **New** |
| `frontend/web-app/src/editor/EditorScreen.tsx` | renders the real panel |
| `frontend/web-app/src/editor/transport.ts` | **`defaultGroupFor` moved here** from `autosave.ts` |
| `frontend/web-app/src/editor/autosave.ts` | `groupFor` is now required, and the manager holds no vocabulary |
| `frontend/web-app/src/editor/store.ts` | `optional_fields` on the section type |
| `frontend/web-app/src/app/workbench/stories.tsx` | demo tab ids renamed off the section keys |
| `scripts/check-no-hardcoded-fields.mjs` | **New** — wired into `verify.sh` and the pre-push hook |
| `frontend/web-app/test/properties-panel.spec.tsx` | **New** — 37 tests |

## Decisions Made

| Decision | Rationale |
|---|---|
| The guard reads the vocabularies from `@wi/schema`'s **source** | It runs before the build in `verify.sh`, so `dist/` may be stale. Node 24 strips types natively. A copy in the guard would drift from the thing it guards — green while wrong |
| A section key is flagged only inside a **string literal** | `gift` and `quote` are ordinary words that appear in comments, prop names and Indonesian prose |
| A field path is flagged **anywhere** | Nobody writes `couple.groom.nickname` by accident |
| `defaultGroupFor` moved to `transport.ts` | The guard found it in `autosave.ts`. The manager is about timing and queuing; the moment it also knew `couple.groom.*` is one endpoint it was a second home for the vocabulary. Moving it was the right answer rather than exempting a second file |
| The workbench demo ids were **renamed**, not exempted | A Tabs story does not need the product's vocabulary, and an exemption would be a hole in the guard for the sake of a fixture |
| `latitude` and `longitude` share one `map-picker` | A pair of number inputs would ask a couple to type coordinates |
| Collection paths are named individually with a reason | An inferred rule would silently exempt a real top-level field the day somebody added one |
| Photo and map controls are real but plain | `P1-24` builds the upload and the MapLibre picker. A control that rendered nothing would make the panel look finished while two field types silently did not work |

## Deviations from `docs/`

None.

## Tests Added

37. Web-app 148 → 185.

| Group | Cases |
|---|---|
| **From the template** | renders exactly what the section asked for; **adding a field to the fixture changes the form with no code change**; required before optional; required marked and optional not; an unknown path says so; a collection gets no text box; no axe violations |
| **Registry drift** | an entry for every scalar path `@wi/schema` knows; **no entry for a path it does not**; every collection accounted for by name with a reason over 20 characters; every field type is used; every select carries options |
| `canonicalise` | five mappings including a uuid index; a concrete path resolves; **the first segment is never wildcarded** |
| **Validation** | silence on empty; the column width; three date cases; four time cases; a select value outside the CHECK constraint; **latitude bounded at 90 and longitude at 180 from the same control**; **`javascript:` maps url refused**; an Instagram handle with `@`; **it does not sanitize** |
| The panel | writes to the store and queues the save; no error before typing; an error once touched; **an invalid value is still sent** |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| No per-template hard-coding | `CLAUDE.md`, `docs/PLAN/07` | `check-no-hardcoded-fields.mjs`. **Mutations**: a `section_key === "hero"` conditional in the panel is caught; a component naming `couple.groom.full_name` is caught |
| The `javascript:` URL check is mirrored | `P1-12` | `"refuses a javascript: maps url, the way the server does"` |
| Sanitisation stays on the server | `docs/SECURITY/08`, `P1-16` | `"does not sanitize, because the server does"` — an explicit test that the client leaves a script tag alone |
| A select cannot offer a value the database refuses | `docs/DATABASE/05` | `"every select carries its options"` plus the CHECK-constraint case |

## DoD Verification

- [x] Adding a field to a template's `required_fields` changes the rendered form with no
      frontend code change — demonstrated in a test using a modified fixture template.
- [x] No section key or field path is hard-coded in a component; the CI guard proves it. Two
      mutations confirm the guard catches both shapes.
- [x] Every registry field type has a component and a unit test. The dispatcher's switch is
      exhaustive over the union, and a test asserts every member is used by at least one
      field — so a type nothing renders cannot sit in the union unnoticed.
- [x] Client validation mirrors the server rules for each field type.

## What Did Not Work

**1. The guard found two real hits on its first run, and one was mine.** `defaultGroupFor` in
`autosave.ts` held `couple`, `events` and `bank_accounts` — a second home for the field
vocabulary in a file whose job is timing. Moved to `transport.ts`, which already held the
endpoint table, so exactly one file knows the mapping. The workbench's Tabs story used real
section keys as demo ids; renamed rather than exempted.

**2. A test asserted a state the control makes unreachable.** `"shows a validation error once
the field has been touched"` typed `99:99` into an `<input type="time">`, which simply refuses
to hold it — so the value stayed empty, validation correctly said nothing, and the test failed
for the right reason. Retargeted at `maps_url`, where an invalid value is both reachable and
the security-relevant one.

**3. An indicator test was racing.** `findByRole("status")` resolves against the polite region
already on screen, so asserting `aria-live="assertive"` straight after a click lost about half
the time. It now waits for the retry button — the state that only exists on failure.

## Follow-Ups and Open Questions

- **Collections have no editor.** A section asking for `events` or `gallery.photos` gets a
  sentence pointing at the media manager. `P1-24` builds the photo list; a general "add an
  event" list editor is nobody's card yet and the events endpoints exist (`P1-12`). Worth
  raising before Phase 2 closes.
- **`gallery.photos.*.order` and `gift.accounts.*.order` render as text inputs** with helper
  text saying they are set by dragging. That is honest and a little odd; once `P1-24` has the
  drag interaction they should probably not be fields at all.
- **The panel does not scroll to the section in the preview.** `docs/FRONTEND/06` § Section
  Navigation asks for it; there is no preview to scroll until `P2-05`.
- **The registry has no per-key type for theme or settings paths**, deliberately —
  `@wi/schema` excludes `settings.*` from the template vocabulary on purpose, and `P1-14`'s
  settings screen is where those live.

## What to Watch

**`ALLOWED` in `check-no-hardcoded-fields.mjs` is the hole, and it has two entries.** Each is
a file whose job *is* the mapping. A third entry added to make a build pass is how the guard
stops meaning anything — the tenant-scope guard has the same warning and it was asked to grow
one task after it was written.

**The registry's drift test only covers scalars.** A new *collection* path added to
`docs/PLAN/08` fails the "accounted for by name" test, which is right — but a new collection
that somebody adds to `COLLECTION_PATHS` with a short reason passes with 21 characters of
nothing. The length check is a prompt, not a proof.
