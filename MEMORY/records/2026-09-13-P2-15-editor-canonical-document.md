# P2-15 — Editor Document in Canonical Shape; Event and Gift Lists

| | |
|---|---|
| **Task** | `P2-15` (added 2026-09-13 during `P2-14`) |
| **Date** | 2026-09-13 |
| **Branch** | `feat/P2-15-editor-canonical-document` |
| **Status** | DONE |
| **Spec** | Not required — every contract existed; this card makes the editor honour them |

---

## What changed

The editor now works against the real API. Before this card, in a running browser:

1. **Autosave saved nothing, for any field, since `P1-22`.** `AutosaveManager` called
   `this.#options.setTimeout(...)`, running the browser's `setTimeout` with the options object
   as `this`. Chrome throws `Illegal invocation`; Node and jsdom do not. Every unit test passed;
   the first keystroke in a real editor threw and the status sat at "Perubahan belum tersimpan".
2. **Event and gift fields were always empty and edits went nowhere.** The store held the owner
   detail in `docs/API/04`'s shape (`event_date`, `bank_accounts`), while the panel bound
   controls to the literal registry patterns (`events.*.title`) — a path no data has.
3. **The live preview showed no event dates, gift accounts or photos** for any real invitation,
   because the renderer reads canonical paths (`events[].date`, `gift.accounts`,
   `gallery.photos[].url`). `P2-05`'s "parity" test rendered one canonical fixture twice.
4. **Section toggles showed the template's defaults, not the couple's choices** — and toggling
   one sent the defaults plus that one change, silently overwriting the rest.
5. **Times did not round-trip**: accepted as `HH:MM`, served as Postgres's `HH:MM:SS`, so a
   time read from the API was refused when written back, and public pages showed `08:00:00`.

Now: the store holds `docs/PLAN/08`'s canonical document; collection rows are addressed by id;
the panel edits events and gift accounts row by row with add and delete; the preview draws
dates, times, accounts, the cover and the gallery; section toggles start from the stored
selection; times are `HH:MM` everywhere; the section list shows names ("Acara") instead of keys.

## Why

`P2-14`'s template-switch E2E was the first test to drive the editor against the real API, and
it stopped at "the gift section is empty". Events are required to publish, so without this no
couple could complete an invitation through the product.

## How

Found by probing the running application (`e2e/fixtures/full-stack.ts`: migrated Postgres,
Redis, the built API on :3000, the production web-app on :3100), then fixed layer by layer with
a unit test per layer and a full-stack E2E over the whole:

- **API** — `shared/time/clock-time.ts` (`toClockTime`) at the three places an event time
  leaves the API: `events.service.ts`, the owner detail DTO, the public DTO. Gallery list gains
  `medium_url`.
- **Store** — `setAtPath`/`getAtPath` resolve an id segment inside an array (index as fallback;
  unknown id changes nothing). `applyServerValue` writes server-confirmed values without marking
  them dirty.
- **Transport** (`transport.ts`, now both directions of the boundary) — `toEditorDocument`,
  `eventFromApi`, `accountFromApi`, `galleryPhotoFromApi`; `COLLECTIONS` (create/row paths,
  canonical→API renames, API-required fields, defaults); `defaultGroupFor` groups
  `events.<id>` and `gift.accounts.<id>`; `endpointFor` refuses a non-uuid row id rather than
  PATCHing `/events/0`; couple `photo` → `photo_media_id`.
- **Autosave** — timers wrapped so they are never called with a foreign `this`.
- **Panel** — `PropertiesPanel` gathers a collection's patterns into `CollectionEditor`
  (`fields/CollectionEditor.tsx`), which renders each row by id, deletes after flushing pending
  edits, and creates a row in one POST from a form of the API's required fields plus the
  template's. Manager-owned collection fields (`gallery.photos.*.caption`) no longer render a
  dead control. `registry.ts` gains `COLLECTION_ITEM_LABELS`, `collectionPathOf`,
  `collectionFieldNames`.
- **Screen** — `EditorScreen` joins gallery URLs, builds the document, and applies
  `withInvitationSections`. `GalleryManager` writes its list back into the document so the
  preview follows uploads, removals and reorders.
- **Section list** — `sectionLabel` for names; the "Tampilkan" checkboxes gain the section name
  for screen readers.

## Files and Components Touched

- `backend/api/src/shared/time/clock-time.ts` (new), `modules/invitation/{events.service,gallery.service,invitation.dto}.ts`, `modules/publishing/public-invitation.dto.ts`
- `backend/api/test/clock-time.spec.ts` (new), `test/integration/{events,public-invitation}.itest.ts`
- `frontend/web-app/src/editor/{store,transport,autosave,PropertiesPanel,SectionListPanel,EditorScreen}.ts(x)`, `media/GalleryManager.tsx`, `fields/registry.ts`, `fields/CollectionEditor.tsx` (new)
- `frontend/web-app/test/editor-document.spec.tsx` (new), `test/editor-autosave.spec.ts`, `test/properties-panel.spec.tsx`
- `e2e/fixtures/full-stack.ts` (new), `e2e/tests/editor-collections.e2e.ts` (new)
- `docs/API/04`, `TASKS/PHASE-2-…md` (new card), `TASKS/PROGRESS.md`, `MEMORY/DECISIONS.md` (ADR-068)

## Decisions Made

ADR-068: canonical document in the store; both translation directions in `transport.ts` (no new
guard exemption); rows by id; one-POST creation; gallery URLs joined; `HH:MM` everywhere;
portrait upload not built here.

Also: **a new task card was added mid-phase** rather than folding this into `P2-14` silently.
`P2-14` stays open on its branch (change-template UI committed) until this merges.

## Deviations from `docs/`

- `docs/API/04` said the events POST body field is `date`; the implementation has always
  accepted `event_date`. The document was corrected to the code, with a note that `date` is the
  canonical name used by the editor and the public payload.
- `docs/API/04` amended: times served as `HH:MM`; gallery list `medium_url`.

## Tests Added

| Test | Proves | Red first? |
|---|---|---|
| `editor-autosave.spec.ts` › "schedules its debounce without calling the timer unbound" | Autosave works under the browser's `this` rule for `setTimeout` | **Yes** — failed with the original code |
| `editor-document.spec.tsx` › "resolves every scalar path the field registry knows, for a full invitation" | Drift guard: the document answers every registry path | Mutation (rename `date`) fails it |
| … › "orders rows by display_order", "carries the names the renderer reads", "keeps what it does not reshape" | Adapter shape | Mutation fails "carries the names" |
| … › "uses the stored enabled_sections over the template's defaults" + fallback | Toggle source | — |
| … › rows by id (2) | Store id resolution; unknown id no-op | Mutation disabling id lookup fails 6 tests |
| … › transport (8): grouping; event PATCH to `/events/<uuid>` with `event_date`; gift to `/bank-accounts/<uuid>`; index refused with no request; required fields per collection | Outbound mapping | Mutation removing `date→event_date` fails |
| … › panel (5): shows existing values per row; edit saves to row by id; add POSTs renamed body and lists it; no POST until required fields; delete then remove | Collection editing | — |
| … › "renders identical markup from the editor document and the public payload" | Real parity — asserts the markup contains the account number, the date and the medium cover URL, then equality | Adapter mutation fails it |
| `clock-time.spec.ts` (6) | `HH:MM:SS` → `HH:MM`, nulls, unknown input untouched | — |
| `events.itest.ts` › "serves times as HH:MM, the shape it accepts, so a read can be written back" | Round trip through the real DB | The pre-fix API was observed serving `08:00:00` in the E2E probe |
| `public-invitation.itest.ts` › "serves event times as HH:MM, not Postgres's HH:MM:SS" | Public payload | same |
| `properties-panel.spec.tsx` › "does not render a text box for a collection" | **Changed**: now expects the "Tambah acara" button instead of "belum dapat diubah" | — |
| `e2e/tests/editor-collections.e2e.ts` (full stack) | Stored event shown in panel (incl. `08:00`) and preview; gift toggle reflects stored selection; title edit PATCHes that event (200) and updates preview; gift account added from the panel appears in panel and preview; database holds both; values survive a reload; no failure message | Failed before the autosave, adapter and toggle fixes (three separate runs, three separate defects) |

## Security Verification

- **No new endpoint, no new `:id` route.** Existing sub-resources are used exactly as before;
  their ownership tests (`events.itest.ts` two-step rule, `idor-sweep.itest.ts`) are unchanged
  and pass in the integration run.
- **The client cannot address a row by guesswork**: `editor-document.spec.tsx` › "refuses a row
  addressed by index instead of PATCHing /events/0" — no request leaves.
- **Free text**: unchanged path — every write still goes through the same API validation and
  sanitizer; the new create form sends the same fields the existing endpoints already accept.

## Abuse Cases Covered

- A stale queued save for a deleted row → `flush` before delete; row paths by id.
- A crafted path with an index or `*` → transport refuses, no request.
- Not applicable beyond that: the card is client correctness over existing, already-tested
  endpoints.

## Definition of Done Verification

- [x] Editing an event's field or a gift account in the running editor saves to the right row, and the value survives a reload — `editor-collections.e2e.ts` (event edit; gift account created from the panel; DB read; reload).
- [x] A couple can add and remove events and gift accounts — add proven in the E2E; add/delete in `editor-document.spec.tsx` › panel tests. **Delete is not in the full-stack E2E**, only the unit test.
- [x] The live preview shows event dates, times and gift accounts for a real invitation — E2E asserts `2027-05-15`, the edited title and the account number in the preview.
- [x] Times round-trip — `events.itest.ts` round-trip test; E2E reads `08:00` in the panel and the DB.
- [x] Every canonical scalar path the registry knows resolves in the document built from a full owner detail — drift-guard test.

## What Did Not Work

- **Believing the unit suites.** 300 web-app tests passed over an editor that could not save.
  Each layer was tested against the shape its author imagined, never against what the adjacent
  layer produced; the timer bug needed a real browser's `this` rule.
- **The first E2E run after the adapter fix** still timed out: the adapter was right and
  autosave was dead underneath it. Page errors were only visible once `pageerror` was logged.

- **The first full-stack fixture wrote its second template with a raw `INSERT`.**
  `check-template-version-writes` refused it in `pnpm verify`, and once the fixture called
  `assertValidTemplateVersion` the validator refused the definition itself: the seed file's
  `_why` annotation keys, which the real seed loader strips. The earlier E2E runs had used a
  template the application could never have stored.
- **`password.spec.ts` › "does comparable work for an unknown user as for a wrong password"**
  failed once inside the first `pnpm verify` (an 8s argon2 timing comparison under load from the
  parallel build); it passed alone and in the re-run. Recorded as an observed flake, not fixed.

## Follow-Ups and Open Questions

- **Couple portrait upload** — the `photo` control is still `P1-23`'s text placeholder; typing
  in it PATCHes `photo_media_id` with whatever was typed. Needs the media manager's single-photo
  mode.
- **Full-stack E2E in CI** — requires Postgres/Redis services in the workflow; `P0-17` owns CI.
- **Event/account reordering** from the panel (the API supports `display_order`).
- **Date/time display formatting** on the public page (raw ISO) — `P2-14`.

## What to Watch

- **Autosave failures in RUM/logs** once real users edit: the editor had never saved in a
  browser before this card, so the first real traffic is also the first real load on the
  sub-resource PATCH endpoints.
- **409/404 on row PATCHes** after deletions from another tab — last-write-wins is advisory.
