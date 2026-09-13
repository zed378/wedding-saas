# P2-14 — Phase 2 Test Suite and Acceptance

| | |
|---|---|
| **Task** | `P2-14` |
| **Date** | 2026-09-13 |
| **Branch** | `feat/P2-14-phase-2-acceptance` |
| **Status** | DONE — one DoD item met with a stated qualification (performance budgets, `OQ-26`) |
| **Spec** | Not required |

---

## What changed

The card closes the phase "with the renderer's guarantees proven rather than assumed". Proving
them meant, for the first time, driving the product end to end: a real API, Postgres, Redis and
production builds, in a real browser. That surfaced more than the card expected:

- **`P2-15` was opened from here** — the editor had never saved in a browser and could not edit
  events or gift accounts (its own record).
- **Switching back to a template did not restore the sections a switch hid**, contradicting
  `docs/API/04`. Fixed with `invitation_settings.section_memory` (ADR-069).
- **No card had built the editor's "Change Template" flow** (`docs/UI-UX/12`, `/05`); `P1-15`
  built only the endpoint. Built here, because the template-switch E2E needs it.
- **The hero with no cover photo drew white text on the light background.**
- **The API's generic English error messages reached the screen** ("The requested resource was
  not found.").
- **Drizzle's migration snapshots had been broken since `P1-09`**: `0005` and `0006` were copies
  of `0004`, so `drizzle-kit generate` refused to run.
- **A renderer test fixture had never carried gift data** (`gift_accounts` read as
  `bank_accounts`), found by the new combination test's negative control.

## Why

`docs/FRONTEND/10` § Integration Test and E2E, `docs/TESTING/03` § 2, `docs/PLAN/17`.

## How — by card step

1. **`enabled_sections` combinations.** `reference-template.spec.tsx` › "every enabled_sections
   combination of the reference template" renders all 256 subsets of its configurable sections
   and requires exactly the structural sections plus the subset, in order, with no disabled
   section's data (gift account number, quote text) in the markup. The API half,
   `test/public-payload-combinations.spec.ts`, runs the same 256 subsets through
   `toPublicInvitation` and requires each data area to be served exactly when a displayed section
   declares a path under it.
2. **Template-switch E2E.** `e2e/tests/template-switch.e2e.ts` against `e2e/fixtures/full-stack.ts`:
   an invitation on the reference template with a quote and a gift account (gift enabled, though
   the template ships it off), opened in the production editor; switch to a second template
   without gift through "Ganti template" — the confirmation names what stops showing and says
   the content is kept; the preview loses the gift section and keeps the quote; the API still
   holds the account; switch back; the gift section returns with its data.
   The editor flow: `ChangeTemplate.tsx`, `template-change.ts` (the server's rule applied
   before commit), `EditorScreen` reload on change, pending edits flushed first.
3. **Budgets.** Editor preview: `live-preview.spec.tsx` › "updates in under 300ms and makes no
   network call" (`P2-05`). Public page: `P2-13`'s browser suite and SSR budget, and the
   `public-invite-budget` CI job.
4. **Real scrapers.** Not done — needs a published invitation on staging, which needs `P3-09`.
5. **Disclosure suite as a set.** `pnpm --filter @wi/api test:disclosure` runs
   `public-payload-combinations.spec.ts`, `public-invitation.itest.ts`, `preview-link.itest.ts`
   and `public-rum.itest.ts` together: 3 + 62 tests, all passing.
6. **IDOR posture.** All four Phase 2 `:id` routes (`publish-check`, `preview-link`,
   `preview-links`, `preview-links/:tokenId`) were already in the sweep. Made mechanical:
   `test/idor-sweep-inventory.spec.ts` reads every controller's decorators and fails on any
   parameterised route that is neither a sweep case nor exempt with a named test (4 exemptions:
   the public invitation, the preview token, two catalogue routes).
7. **Phase summary.** `MEMORY/records/2026-09-13-PHASE-2-SUMMARY.md`.

Plus the fixes listed above: section memory (`0007_section_memory`, `recomputeSections`,
`readSectionMemory`, repository write); `.wi-hero-plain` in the renderer; Indonesian messages for
`NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `INTERNAL_ERROR`; the full-stack fixture
bumps the catalogue cache generation after writing templates and validates its template with
`assertValidTemplateVersion`.

## Files and Components Touched

- `frontend/web-app/src/editor/{ChangeTemplate.tsx,template-change.ts,EditorShell.tsx,EditorScreen.tsx}`, `src/lib/{invitations,error-messages}.ts`
- `frontend/web-app/test/{change-template.spec.tsx,error-messages.spec.ts}`
- `backend/api/migrations/0007_section_memory.{sql,down.sql}`, `migrations/meta/{0005,0006,0007}_snapshot.json`, `_journal.json`
- `backend/api/src/infra/db/schema/invitations.ts`, `modules/invitation/change-template.service.ts`, `shared/tenancy/invitation-repository.ts`
- `backend/api/test/{public-payload-combinations,idor-sweep-inventory}.spec.ts`, `test/integration/{change-template,idor-sweep}.itest.ts`, `package.json` (`test:disclosure`)
- `packages/template-renderer/src/sections/{HeroClassic.tsx,styles.ts,hero-contrast.spec.ts}`, `src/reference-template.spec.tsx`
- `e2e/fixtures/full-stack.ts`, `e2e/tests/template-switch.e2e.ts`
- `docs/API/04`, `docs/DATABASE/04`, `TASKS/BACKLOG.md` (`OQ-27`), `MEMORY/DECISIONS.md` (ADR-069)

## Decisions Made

- ADR-069 — section memory; snapshot chain repaired.
- The change-template confirmation is computed client-side with the server's rule, because the
  document asks for the list before the change and the API returns it after (`docs/API/04`
  amended to say so).
- A new card (`P2-15`) rather than folding a large gap into this one.

**Raised, not decided**: `OQ-27` — date display format and event timezone. The renderer prints
ISO dates and hard-codes `WIB` / `+07:00`, wrong for WITA and WIT weddings.

## Deviations from `docs/`

- `docs/API/04` § change-template: the confirmation's source (client-side, same rule) and how
  switching back restores sections.
- `docs/DATABASE/04`: `invitation_settings.section_memory`.

## Tests Added

| Test | Proves | Red first / mutation |
|---|---|---|
| `reference-template.spec.tsx` › "renders exactly the chosen sections for all 256 subsets" (+ negative control) | DOM absence for every combination | Renderer ignoring `enabled_sections` → fails. The control found the fixture carried no gift data |
| `public-payload-combinations.spec.ts` (3) | Payload absence for every combination | `shown()` always true → 2 fail |
| `change-template.itest.ts` › 4 new pure tests + "the round trip restores a section whose template default is off (ADR-069)" | Section memory: ON restored, OFF kept, chains across templates, defaults for unseen sections, stored value | Disabling restoration → 5 fail. One expectation of mine was wrong (the memory rightly held `closing: false`) and was corrected, not the code |
| `change-template.spec.tsx` (10, web-app) | Preview rule; dialog lists catalogue, marks current, names hidden sections, changes nothing before confirm, sends only `template_id`, reloads; pending edit saved before change; server refusal shown | Removing the flush → "saves a pending edit before asking for the change" fails |
| `hero-contrast.spec.ts` › no-photo hero (2) | Plain hero uses theme colours; reference theme clears 4.5:1 / 3:1 | Removing the date rule → fails |
| `error-messages.spec.ts` (5) | No English default reaches the screen for generic codes | — |
| `idor-sweep-inventory.spec.ts` (3) | Every parameterised route swept or exempt with a reason | Misspelling one sweep label → fails naming the route |
| `template-switch.e2e.ts` (full stack) | `docs/TESTING/03` § 2 end to end | Failed three ways before passing: the editor preview had no gift data (`P2-15`), switching back lost the section (ADR-069), and a stale catalogue cache offered a deleted template id |

## Security Verification

- **IDOR**: `idor-sweep.itest.ts` (every row pass in the integration run) plus
  `idor-sweep-inventory.spec.ts` › "has no parameterised route that is neither swept nor exempt".
- **Public disclosure**: `test:disclosure` set — named tests in `P2-07`, `P2-12`, `P2-13` records;
  new `public-payload-combinations.spec.ts`.
- **Section memory is never exposed**: it is not in `SettingsDto`, the owner detail, or the
  public DTO (the DTOs are assembled field by field); `public-invitation.itest.ts` ›
  "contains none of the forbidden keys" still passes. No test names `section_memory` in a
  forbidden list — **gap noted**, low risk since it holds only section keys.
- **Change-template** request body remains strict (`invitation-http.spec.ts` › "rejects a body
  carrying %s"); the new UI sends only `template_id` (`change-template.spec.tsx`).

## Abuse Cases Covered

- A route added later without an IDOR case → the inventory test fails.
- A client crafting `enabled_sections` through change-template → refused by the strict body.
- Not applicable otherwise: no new unauthenticated surface.

## Definition of Done Verification

- [x] **Disabled sections are provably absent from the rendered DOM and from the API payload.** — all 256 combinations on both sides, mutation-verified; plus the per-section integration tests against the database.
- [x] **The template-switch E2E passes.** — `template-switch.e2e.ts`, locally against the full stack. **Not in CI**: it needs Postgres and Redis services (`P0-17`).
- [~] **Both performance budgets pass in CI.** — Editor preview: yes, in the unit suite that `verify` runs. Public page: the 150KB JS budget and Fast 4G LCP pass in the suite; **Slow 4G LCP does not meet 2.5s** (`OQ-26`); and the `public-invite-budget` CI job has been written but **not observed running on GitHub**.
- [x] **The phase summary exists in `MEMORY/records/`.**

Card steps not done: **step 4, real scrapers** — blocked on `P3-09`.

## What Did Not Work

- **Unit tests as evidence of a working product.** Phase 1's summary records autosave as
  verified by `"editing 100 fields in sequence loses nothing"`; in a browser autosave threw on
  the first keystroke. That record is left as written (records are append-only); this one and
  the Phase 2 summary say so.
- **Reusing the integration database for the E2E** without invalidating the catalogue cache:
  the integration suite truncates `templates`, and a cached listing offered an id that no
  longer existed.
- **`drizzle-kit generate`** — refused by the broken snapshot chain; repaired rather than
  bypassed by hand-writing the migration without a snapshot.

## Follow-Ups and Open Questions

- `OQ-27` (dates/timezone), `OQ-26` (4G profile), `OQ-25` (fonts), `OQ-24`.
- Full-stack E2Es in CI (`P0-17`); Linux visual baselines.
- Real-scraper link preview check (`P3-09`); real-device interaction check (`P2-10`).
- Couple portrait upload control (`P2-15` follow-up).
- Staging: redeploy, run migration `0007`, reseed; set `Timing-Allow-Origin` on media.

## What to Watch

- **Template switches on real invitations**: `invitation.template_changed` log lines; a spike in
  support questions about sections disappearing would mean the memory rule is being misread.
- **The inventory guard failing in a future phase** is the point — do not add an exemption
  without the test it names.
