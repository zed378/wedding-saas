# P0-21 — Reference template v1.0.0 and demo seed data

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-21 |
| **Phase** | Phase 0 |
| **Surface** | backend, web-app |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-21-reference-template` |
| **Status** | Completed |

---

## What Changed

The product has a template. **Elegant Rose v1.0.0**, ten sections in the `docs/UI-UX/14` order, and a demo invitation that fills every field it requires.

Both are seed data. `pnpm --filter @wi/api db:seed` installs them, idempotently.

## Why

`docs/PLAN/07` § Core Principles is the rule this task exists to prove: "Templates MUST NOT have their own application logic (no per-template backend code). Visual differences between templates = differences in component sets + theme variables + layout config — **all data, not code**."

A rule with no instance is a rule nobody has tested. `P0-20` built the schema; this is the first thing that has to fit through it, and it is the thing every Phase 2 rendering task will be written against.

## How

**The template is a JSON file, and the file format is the argument.** A template in a `.ts` file is a template that *could* import something. Nothing would stop it, the first one that did would look reasonable in review, and after that the rule is gone for every template that follows. `reference-template.json` cannot import anything.

**JSON has no comments, so `_`-prefixed keys are annotations.** The reasoning behind each section matters as much as its values — why gift defaults to off, why parents are optional, why `max_items` is 20 and not the package's 200 — and reasoning that lives in a separate file stops being read. `stripAnnotations` removes them before validation. The cost is named in `load.mts`: `sectionSchema` is `.strict()` precisely so a typo in a key is rejected rather than ignored, and this convention creates one shape of typo (`_section_key`) that is silently dropped instead. The leading underscore has to be deliberate, which is what makes that acceptable.

**The demo is a real invitation, not a fixture.** `docs/PLAN/07` § Demo Data and ADR-022 decided this: it lives in the same tables as any other invitation, so the catalogue demo and the admin preview render through the production renderer reading the production public API shape. The alternative was rejected there because it drifts — a demo rendered by a second code path stops resembling the product the moment either side changes, and `docs/UI-UX/11` needs it to set accurate expectations before a user commits to a template.

**Ownership is the marker, not a column.** There is no `is_demo` flag. The document says "owned by a system account", so `backend/api/src/shared/demo/demo-account.ts` holds the fixed ids and `P5`'s dashboard has one answer to import rather than a literal to copy. Adding a column would have meant a migration and a `docs/DATABASE/04` amendment to say something the specification already says another way.

**The system account cannot be logged into.** No password hash, no OAuth provider, and an address under `.invalid`, which RFC 2606 reserves. A seeded account with a known id and a usable credential is a back door that ships with the product; a notification job that reaches the address fails loudly rather than mailing a stranger.

**Storage keys are built by `@wi/storage`.** The demo's media rows carry the same keys `P1-16`'s upload pipeline will write to. Writing a path by hand here would have created the one place in the system where a storage key is invented, which is what `scripts/check-storage-paths.mjs` exists to prevent.

**The demo is deleted and rewritten rather than upserted row by row.** Its children have no natural key — two events, six photos, three guestbook entries — so a row-wise upsert would need a synthetic id for each to stay idempotent. `ON DELETE CASCADE` already does it, and the invitation keeps its fixed id so nothing referencing it breaks.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/infra/db/seed-data/reference-template.json` | **New** — the template, as data |
| `backend/api/src/infra/db/seed-data/demo-invitation.json` | **New** — the demo's content |
| `backend/api/src/infra/db/seed-data/load.mts` | **New** — one loader for both readers, and the annotation convention |
| `backend/api/src/infra/db/seed-data/seed-template.mts` | **New** — the two seeding functions, separate from `seed.mts` so tests can call them |
| `backend/api/src/shared/demo/demo-account.ts` | **New** — the fixed ids, and why they exist |
| `backend/api/src/infra/db/seed.mts` | Calls both; the "arrives with P0-21" placeholder is gone |
| `backend/api/test/reference-template.spec.ts` | **New** — 17 unit tests over the files |
| `backend/api/test/integration/reference-template.itest.ts` | **New** — 6 tests over the rows |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| The template is JSON, not TypeScript | A module could import something; a JSON file cannot | — |
| `_`-prefixed keys are annotations, stripped before validation | Reasoning has to live beside the value; the alternatives were a parser dependency or a sidecar that drifts | — |
| Ownership marks the demo, not an `is_demo` column | `docs/PLAN/07` picks ownership; a column would need a migration to restate it | — |
| The system account has no credential of any kind | A seeded account with a usable password is a back door that ships | — |
| Gift defaults to off | Asking for money is a choice a couple makes deliberately | — |
| Parents are optional, not required | A required parent name blocks publication for anyone whose parents have died | — |
| `max_items: 20`, not the package's 200 | `docs/PLAN/09` caps *storage* at 200; this caps what one grid *displays*, against a page budget | — |
| The demo is deleted and rewritten | Its child rows have no natural key; CASCADE already does the work | — |

## Deviations from `docs/`

None.

## Tests Added

23 — 17 unit and 6 integration. API totals after: 91 unit, 191 integration.

| Group | Cases |
|---|---|
| The template | validates against the `P0-20` schema; **every referenced path is canonical**, asserted directly rather than via the validator; the ten sections in the `docs/UI-UX/14` order; hero and event non-configurable and the other eight configurable; gift defaults off; only `colors.primary` customizable; **rsvp and guestbook require nothing**; published at 1.0.0 |
| The demo, from the files | **fills every required field of its own template**; would still be complete with *every* section enabled; leaves gift disabled with the data behind it (BR-4.1); **does not list hero or event in `enabled_sections`**, so the completeness tests cannot pass for the wrong reason; never indexed; has two events so wildcard completeness is genuinely exercised; keeps one guestbook entry pending under moderation |
| The annotation convention | strips `_` keys at every depth; the loaded files contain none |
| The seed, against PostgreSQL 18 | writes one template, one version, one invitation; **idempotent — a second run leaves identical counts across ten tables**; the system account has no password hash, no OAuth provider and a `.invalid` address; published at the known slug and not indexed; **media keys match what `@wi/storage` produces**; **the seeded demo is publishable against the seeded template**, assembled from the tables rather than from the JSON |

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| The seeded system account is not an authentication path | `docs/SECURITY/03` | `reference-template.itest.ts` → "owns the demo with a system account that cannot be logged into" — asserts `password_hash IS NULL` **and** `oauth_provider IS NULL`, the two credentials the login paths check |
| The demo cannot receive real mail | `docs/SECURITY/09` | Same test asserts the address ends in `.invalid` (RFC 2606, guaranteed never to resolve) |
| The demo is not indexed | `docs/UI-UX/11` | "publishes the demo at a known slug, not indexed" — `seo_indexable = false` read back from `invitation_settings` |
| Storage keys are not invented | `docs/ARCHITECTURE/05` | "stores gallery media under keys the upload pipeline would produce" — the pattern is asserted against a regex, and the seed builds them with `mediaKey()` from `@wi/storage`, which `scripts/check-storage-paths.mjs` enforces |
| The template definition is validated before the write | `docs/DATABASE/03` § Schema Validation | `seed-template.mts` calls `assertValidTemplateVersion`; `scripts/check-template-version-writes.mjs` now reports **2 writers, all validate first** |
| Seeding cannot run against production | `docs/DEVOPS/08` | Unchanged from `P0-06` — two guards in `seed.mts`, `NODE_ENV` and a non-local URL check |

## Abuse Cases Covered

- **Someone logs in as the demo owner and edits the catalogue's demo.** Impossible: neither authentication path has anything to verify against.
- **The demo appears in search results as a real wedding with a real-looking Bandung address.** `seo_indexable = false`, asserted.
- **The demo is counted as a customer.** Not prevented yet — see Follow-Ups. `isSystemAccount()` exists so `P5` has one answer, and nothing enforces its use.

## DoD Verification

- [x] The reference template exists as seed data, not as code — a JSON file that cannot import anything.
- [x] It validates against the `P0-20` schema in a test that reads the same bytes the seed reads.
- [x] Its `required_fields` reference only canonical paths, asserted directly.
- [x] End-to-end rendering is `P2-02`'s; its DoD already carries the assertion, and a handoff note was added to that card naming what is already proven and what is not.
- [x] Global DoD: `bash scripts/verify.sh` clean, 191 integration tests against PostgreSQL 18, record + index + changelog + board updated.
- [ ] No ADR — nothing here deviated from `docs/` or decided something it left open. The design choices are recorded in the table above and beside the values in the JSON.

## What Did Not Work

**1. `import.meta` in a `.ts` file, again.**

`load.ts` needed `import.meta.url` to resolve the JSON beside it, and `@wi/api` emits CommonJS, where that is a compile error — the same wall `P0-19.1` hit in `@wi/logging`. Renamed to `load.mts`, which is the convention the db CLI scripts already use for exactly this reason.

**2. A Node warning the repo had previously designed around.**

`seed.mts` imports `demo-account.ts`, and Node prints `MODULE_TYPELESS_PACKAGE_JSON` — it cannot tell whether the `.ts` file is CJS or ESM, sees `export`, and reparses. The `.mts` convention exists to avoid precisely this. It cannot apply here: `demo-account.ts` has to stay importable by the Nest app, which is CommonJS.

The alternatives were worse — duplicating the ids, or moving them into the seed data where the application could not read them. The warning is cosmetic and one line; two copies of a system account id is a real bug waiting.

**3. `resetTenantData` is not where it looks like it should be.**

It lives in `test/integration/helpers.ts`, not in `test/support/harness.ts` where `startHarness` is. Two test-support modules with overlapping jobs, which is the same duplication `P0-20` recorded for the connection helpers. Recorded again rather than fixed, because merging them touches nine suites.

**4. The gallery bytes do not exist and cannot yet.**

The demo has six media rows and no objects behind them, because uploading requires the `P1-16` pipeline. Anyone opening the demo page before then sees broken images. Written into `demo-invitation.json` beside the gallery and into the seed's comments, because the alternative is somebody spending an afternoon on a bug that is a scheduled dependency.

## Follow-Ups and Open Questions

- **Nothing excludes the demo from counts yet.** `isSystemAccount()` exists; `docs/PLAN/07` requires the demo to be "excluded from admin dashboard counts", and `P5` owns those queries. This is the single most likely thing to be forgotten in this task, because the failure is a number being one too high, which nobody audits.
- **The demo's images.** `P1-16` (upload pipeline) or a template asset. Until then the catalogue demo is a layout preview, not a picture of a wedding.
- **`P2-02` owes `@wi/schema` a component parity test** (ADR-037). Added to that card's DoD. Until it exists, the eleven component names the reference template uses are a contract nothing checks.
- **Two test-support modules.** `test/support/harness.ts` and `test/integration/helpers.ts` both connect and both reset. Third time this has been noted.
- **A second template is what will actually test the "templates are data" rule.** One template can be data by accident. `P7` is where a second one becomes a product need; until then the rule is enforced by the schema and by `docs/PLAN/07`, not by evidence.

## What to Watch

**The demo will be edited to make a test convenient.** Its completeness against the reference template is asserted twice, and both assertions depend on the content staying complete. A field emptied to exercise some other case turns both into weaker claims that still pass.

**`enabled_sections` in `demo-invitation.json` deliberately omits `hero` and `event`.** They are `configurable: false`, so the renderer shows them regardless. If someone "fixes" that list by adding them, the two completeness tests keep passing while no longer proving that non-configurable sections are checked — which is the exact bug `collectMissingRequiredFields` was written to avoid.

**The annotation convention is invisible until it bites.** A key accidentally prefixed with `_` is dropped silently, and `.strict()` — which exists to catch exactly that class of typo — will not see it.
