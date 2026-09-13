# Phase 2 — Completion Summary

| | |
|---|---|
| **Phase** | Phase 2 — Template Rendering and Preview |
| **Started** | 2026-09-12 |
| **Completed** | 2026-09-13 |
| **Tasks completed** | 15 / 15 (14 planned, plus `P2-15` added during acceptance) |
| **Release tag** | none — nothing is released until Phase 6 (`docs/PLAN/16`) |

---

## What Shipped

**An invitation can now be seen.** One generic renderer draws every template from data: ten
section components styled entirely from the template's theme, each behind its own error boundary.
The same renderer runs in three places — the editor's live preview, the public invitation, and the
catalogue's demo — so what a couple edits is what their guests will see.

**The public invitation** is server-rendered at `invitation.vizunicum.my.id/{slug}`: the whole
invitation, its link-preview metadata and structured data are in the first HTML a WhatsApp scraper
reads. It is `noindex` unless the couple says otherwise, serves only data a displayed section
declares, greets a named guest from `?to=` without that name reaching the server's cache, has a
cover gate, copy and share controls, reports real-user Core Web Vitals, and loads its cover photo
first at a size that fits the screen.

**Before publishing**, a couple can see which required fields are missing, send a seven-day
watermarked preview link that cannot be indexed and can be revoked, and change template without
losing anything — switching back restores exactly what they had chosen.

**The catalogue** is public and indexable, with filters in the URL and a live demo of each
template.

**The editor works against the real API.** That sentence should not need saying; it does, because
until `P2-15` it did not (see What Was Harder Than Expected).

**What is not here**: nothing can be published or paid for (Phase 3), there is no RSVP or guestbook
submission (Phase 4), no admin (Phase 5).

## Acceptance Criteria Verification

From `docs/PLAN/17-ACCEPTANCE-CRITERIA.md` — the criteria Phase 2 owns, and the Phase 1 criteria
that were waiting on it.

| Criterion | Evidence | Verified |
|---|---|---|
| **Public page LCP < 2.5s on 4G** | `public-performance.e2e.ts` › "Fast 4G: LCP under 2500ms…" (0.78–1.01s); Slow 4G measured 2.9–3.3s (Playwright) and 2.78–2.83s (Lighthouse), held to a 4s ceiling | **On Fast 4G yes; on Slow 4G no — `OQ-26`** |
| **Editor preview reflects a change in under 300ms** | `live-preview.spec.tsx` › "updates in under 300ms and makes no network call" | **Yes (jsdom)** — not measured in a browser |
| **Switch templates without losing data; fields disappear and reappear** | `template-switch.e2e.ts` in a real browser against the real stack; `change-template.itest.ts` including "the round trip restores a section whose template default is off (ADR-069)" | **Yes** — and **Phase 1's "Yes" was incomplete**: its round trip only covered sections that were on by default |
| **Autosave with no data loss** (Phase 1 criterion) | Phase 1 verified it in unit tests. **In a browser it never worked** until `P2-15` (unbound `setTimeout`). Now: `editor-collections.e2e.ts` shows edits stored and surviving a reload; `editor-autosave.spec.ts` › "schedules its debounce without calling the timer unbound" | **Yes, since `P2-15`** — the 100-edit criterion itself is still proven only in unit/integration tests, not in a browser |
| **Free-text input does not result in stored XSS** — the rendering half | `TemplateRenderer.spec.tsx` › "renders markup in a name as text, never as HTML"; `check-renderer-is-generic` forbids `innerHTML` in the renderer; JSON-LD escaping in `json-ld.ts` (`P2-09`) | **Yes** |
| **WCAG 2.1 AA on the public page** | axe per section component (`sections.spec.tsx`, jsdom); pixel contrast over a white cover 5.97–6.90:1 (`public-performance.e2e.ts`); no-photo hero contrast (`hero-contrast.spec.ts`) | **Partly** — no full-page axe audit of the public invitation in a browser yet |
| **IDOR, 0 critical findings** (new endpoints) | `idor-sweep.itest.ts` (all rows pass) + `idor-sweep-inventory.spec.ts` (every parameterised route swept or exempt) | **Yes** |
| **A disabled section's data never reaches a guest** (`docs/API/08`, BR-4.1) | 256 combinations in the DOM (`reference-template.spec.tsx`) and the payload (`public-payload-combinations.spec.ts`); `test:disclosure` set | **Yes** |
| Publishing in under 5s; checkout; payment | — | Phase 3 |
| RSVP & guestbook | — | Phase 4 |

## Security Verification

| Category | Method | Result |
|---|---|---|
| Multi-tenancy / IDOR (`docs/SECURITY/05`) | The `P1-25` sweep extended with every Phase 2 owner route (4), and a completeness guard over controller decorators | **0 findings.** The guard is mutation-verified |
| Public disclosure (`docs/API/08`) | Identical 404s for every non-public state; forbidden-key scan; exact top-level keys; per-section omission against Postgres; all 256 section combinations; preview tokens identical when dead | **0 findings** |
| Credentials (`P2-12` preview tokens) | 256-bit, SHA-256 at rest, expiry compared in SQL, revocation, `no-store`, `noindex`, no referrer | **0 findings** |
| Payment (`docs/SECURITY/07`) | — | Not applicable until Phase 3 |
| Real-user monitoring (`P2-13`) | Strict body, no URL accepted, same-origin forward, forwarded address unchanged | **0 findings.** Staging hop count not yet verified |
| Rate limiting of the public page | Found in `P2-13`: every guest shared one bucket. Fixed by forwarding `X-Forwarded-For` | **Fixed**; watch 429s from the public page's address |

## Performance Results

| Surface | Target | Measured | Conditions | Met |
|---|---|---|---|---|
| Public page initial JS | < 150KB gzip | ~140KB | production build, `test:ssr` | **Yes** |
| Public page LCP | < 2.5s | 0.78–1.01s Fast 4G; 2.9–3.3s Slow 4G | Pixel 7 emulation, 4x CPU, reference template, representative photos | **Fast 4G yes; Slow 4G no (`OQ-26`)** |
| Public page CLS | < 0.1 | 0.0000 | same | **Yes** |
| Editor preview | < 300ms | under the bound in jsdom | `live-preview.spec.tsx` | **Yes (jsdom)** |

## Deviations from `docs/`

| Deviation | ADR | Document amended |
|---|---|---|
| Catalogue is anonymous; detail gains fields | ADR-059 | `docs/API/03` |
| Invitation detail carries its template identity | ADR-060 | `docs/API/04` |
| A published invitation may change template after a re-check | ADR-061 | `docs/API/04`; closes `OQ-23` |
| Section data decided by declared field paths | ADR-062 | `docs/API/08` |
| **The public payload is in the canonical shape** | ADR-063 | `docs/API/08` |
| `seo_indexable` read as exactly true; thumbnail in payload | ADR-064 | `docs/API/08` |
| Template detail names its demo by ownership | ADR-065 | `docs/API/03` |
| A preview is the public payload with four fields forced | ADR-066 | `docs/API/04`, `docs/API/08` |
| Image bytes chosen for the budget; RUM; forwarded address | ADR-067 | `docs/API/08`, `docs/FRONTEND/09` |
| **The editor works in the canonical shape** | ADR-068 | `docs/API/04` |
| **Template switches remember section choices**; snapshot chain repaired | ADR-069 | `docs/API/04`, `docs/DATABASE/04` |

## Deferred Out of This Phase

**Per-template code splitting.** Turbopack merges the section library into one chunk; ~7.8KB gzip,
pinned under 10KB. Revisit when a second template family exists.

**Real-scraper link previews** (`P2-09`, `P2-14` step 4). Needs a published staging invitation —
`P3-09`.

**Real-device interaction check** (`P2-10`). iOS Safari and Android Chrome on physical devices.

**Couple portrait upload** in the editor (`P2-15`). The field is still a text placeholder.

**Full-stack E2Es and visual baselines in CI.** They run locally; CI needs database services
(`P0-17`) and Linux baselines.

**Open questions**: `OQ-24` (template-change confirmation on a live invitation), `OQ-25` (fonts),
`OQ-26` (which 4G), `OQ-27` (date format and event timezone).

## What Was Harder Than Expected

**Every layer passed its own tests and the product did not work.** The pattern repeated all phase:

- `P2-07` served the owner API's shape; the renderer read canonical paths; pages rendered empty
  sections (ADR-063).
- The reference template's hero declared `gallery.photos.*.media_id`; the cover photo had never
  appeared on a public page (`P2-13`).
- The editor store held the API's shape while panel, registry and preview used the canonical one;
  events could not be edited and the preview drew no dates (`P2-15`).
- **Autosave had never run in a browser.** Chrome refuses `setTimeout` called with a foreign
  `this`; Node does not; 300 web-app tests passed (`P2-15`).
- `P2-05`'s parity test compared one fixture with itself; `P1-15`'s round trip used only
  default-on sections; a renderer fixture read a key the demo file does not have.

What found them was the same each time: a test that fed a component what its real neighbour
produces — the real payload, the real template, the real API, a real browser. `P2-14`'s full-stack
fixture should be the first tool reached for, not the last.

**Performance on Slow 4G** is bounded by the framework's own JavaScript. Bytes were the whole story
from 5.2s to ~3s; the rest is ~120KB of React and the App Router.

## What Was Easier Than Expected

The template-as-data rule held. Nothing in this phase needed template-specific code: the guards
(`check-renderer-is-generic`, `check-no-hardcoded-fields`) never had to be relaxed, and every fix —
including the collection editor — was expressible through the registry.

## Risks Identified

| Risk | Change | Note |
|---|---|---|
| Green unit suites over broken integrations | **New** | Mitigated by the full-stack fixture; not yet in CI |
| Event timezone assumed WIB | **New** | `OQ-27`; countdown and labels wrong outside western Indonesia |
| Slow-network LCP over target | **New** | `OQ-26` |
| Staging runs code without Phase 2's migration and fixes | **New** | Redeploy, migrate `0007`, reseed before any demo |
| R14 single-host | Unchanged | — |

## Readiness for the Next Phase

**Phase 2 exit: met**, with `OQ-26` qualifying the LCP criterion.

What Phase 3 should know:

- `P3-09` publish must reuse `PublishCheckService`, invalidate the public page (the fetch is
  `no-store` today), and warm it; the CDN must strip query strings from the cache key and send
  `Timing-Allow-Origin` on media.
- `P3-01`/`P3-06` must add `requireVerifiedEmail` where the card says.
- Anything that writes `template_versions` must call `assertValidTemplateVersion`; anything
  that invalidates the catalogue must bump `cache:gen:tpl` (`TemplateService.invalidate()`).
- Run `e2e/fixtures/full-stack.ts` flows for every user-facing Phase 3 flow — checkout in a real
  browser against the real API is where Phase 3's version of this phase's surprises will be.
- `idor-sweep-inventory.spec.ts` will fail on the first new `:id` route until it is in the sweep.
  That is intended.
