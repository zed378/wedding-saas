# Phase 2 — Template Rendering and Preview

**Goal**: one generic renderer that turns `template_versions.sections` plus invitation data into a rendered invitation — used identically by the editor's live preview, the catalog demo, and the public page — plus the public invitation surface itself, with the SEO metadata that makes a shared link look right in WhatsApp.

**Why this phase is separate from Phase 1**: `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` splits data entry from presentation deliberately. The editor in Phase 1 works without a live preview; the renderer arrives here and is retrofitted into the editor, which is only possible because `docs/FRONTEND/04` requires one renderer rather than two.

**The rule this phase exists to honour**: `CLAUDE.md`'s first non-negotiable — templates are data, not code. Everything here is written so that adding a template is a database row plus, at most, a new registered component; never a deploy of template-specific logic.

**Exit criteria**: a published invitation renders end to end at its subdomain from real data through the shared renderer; the editor preview updates in under 300ms from local state; a broken section degrades to a placeholder instead of a blank page; link previews in WhatsApp and Facebook show the couple's cover photo and names.

**Roadmap reference**: `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` § Phase 2 (Week 6-7).

---

## Task Summary

| ID | Task | Surface | Size | Depends on |
|---|---|---|---|---|
| P2-01 | Template catalog API | backend | M | P0-20, P1-06 |
| P2-02 | Generic renderer core | web-app, public-invite | L | P0-20, P0-21 |
| P2-03 | Section component library v1 | web-app, public-invite | L | P2-02 |
| P2-04 | Per-section error boundaries | web-app, public-invite | M | P2-03 |
| P2-05 | Live preview in the editor | web-app | M | P2-03, P1-22 |
| P2-06 | Publish-check endpoint and editor checklist | backend, web-app | M | P0-20, P1-14 |
| P2-07 | Public invitation API | backend | L | P1-14, P2-01 |
| P2-08 | Public invitation SSR app and host routing | public-invite | L | P2-07, P2-03, P0-23 |
| P2-09 | SEO metadata, robots and structured data | public-invite | M | P2-08 |
| P2-10 | Public page interactions | public-invite | M | P2-08 |
| P2-11 | Template catalog and detail UI, demo mode | web-app | L | P2-01, P2-03 |
| P2-12 | Share-preview links | backend, public-invite | M | P2-08 |
| P2-13 | Performance budget and Core Web Vitals baseline | public-invite | M | P2-10 |
| P2-14 | Phase 2 test suite and acceptance | all | M | all above |

---

## P2-01 — Template Catalog API

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-20, P1-06 |
| **Spec refs** | `docs/API/03-TEMPLATE-API.md`, `docs/PLAN/02` § BR-3.3, `docs/ARCHITECTURE/06` § What Is Cached |
| **Spec required** | No |
| **Surface** | backend |

**Goal** — Catalog list, detail and specific-version reads, exposing only what the catalog is allowed to show.

**Steps**
1. Implement the three read endpoints in `docs/API/03` with the filters listed there: category, search, premium flag, pagination.
2. Return only templates with a `published` version. BR-3.3 keeps deprecated versions renderable for invitations already locked to them, while removing them from the catalog for new invitations — two different questions with two different answers.
3. Implement `GET /templates/:slug/versions/:version` for demo and preview, which may serve a deprecated version by explicit request.
4. Return the full `sections`, `theme` and `customizable_theme_keys` in the detail response, per the example in `docs/API/03` — the editor's dynamic form is built from exactly this payload.
5. Cache template definitions in Redis, invalidated when an admin publishes a version (`docs/ARCHITECTURE/06`). The catalog is read-heavy and changes rarely; do this now rather than after a load test says so.
6. Include the section capability list the template detail UI displays (`docs/UI-UX/11`).

**Definition of Done**
- [ ] A draft or deprecated version never appears in the catalog list.
- [ ] The detail response matches `docs/API/03`'s example shape exactly.
- [ ] The version endpoint can serve a deprecated version by explicit request.
- [ ] Cache invalidation on version publish is covered by a test.

---

## P2-02 — Generic Renderer Core

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-20, P0-21 |
| **Spec refs** | `docs/FRONTEND/04-TEMPLATE-RENDERING.md`, `docs/PLAN/07-TEMPLATE-SYSTEM.md`, `docs/PLAN/08-INVITATION-DATA-MODEL.md` |
| **Spec required** | Yes — core architecture |
| **Surface** | web-app, public-invite |

**Goal** — `<TemplateRenderer templateVersion invitationData mode />` in `packages/template-renderer`, implementing the five-step render flow, shared by all three consumers.

**Steps**
1. Implement the render flow from `docs/FRONTEND/04` exactly: iterate sections in order; skip a section absent from `enabled_sections` unless `configurable: false`; resolve the component name through the registry; extract the data subset by dot-notation; render with `data`, `theme` and `layoutVariant`.
2. Build the component registry as a name-to-component map. `docs/PLAN/07` § Backward Compatibility requires a breaking redesign to be a **new** component name (`GalleryGridV2`), never an edit to the existing one, because older template versions name the old component explicitly. Add a CI check that a component name present in any stored template version still exists in the registry — this is the automated form of R5's mitigation in `docs/PLAN/18`.
3. Apply theme as CSS custom properties at the renderer root, merging `templateVersion.theme` with the invitation's `theme_override`, per `docs/FRONTEND/04` § Theme Application.
4. Implement the three modes from `docs/FRONTEND/04` § Mode Differences: `live` reads local editor state with submissions disabled, `public` reads API data with submissions and the view counter active, `demo` uses dummy data with inert handlers.
5. Keep the renderer free of any network calls — data arrives as props. That is what lets the same component tree run under SSR and inside the editor.
6. Never branch on a template id or slug anywhere in the renderer. A grep-based CI check enforces it.

**Definition of Done**
- [ ] The renderer is imported by both `apps/web-app` and `apps/public-invite` from one package.
- [ ] A template version naming an unregistered component fails CI.
- [ ] No template identifier appears in a conditional anywhere in the package.
- [ ] Rendering the reference template with demo data produces every enabled section, in order, in a test.
- [ ] Disabled sections are absent from the DOM, not merely hidden with CSS — a hidden section is still a data leak in the page source.

---

## P2-03 — Section Component Library v1

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P2-02 |
| **Spec refs** | `docs/UI-UX/14-PUBLIC-INVITATION-UX.md`, `docs/PLAN/07` § Section System, `docs/UI-UX/17-ACCESSIBILITY.md` |
| **Spec required** | No |
| **Surface** | web-app, public-invite |

**Goal** — The ten section components the reference template names, theme-driven and layout-variant aware.

**Steps**
1. Build: Hero (cover gate), Quote, Couple, Event with countdown, Gallery (grid and carousel variants), Maps, Gift, RSVP, Guestbook, Closing — the default order in `docs/UI-UX/14`.
2. Drive every visual property from theme tokens; a component must look different under a different theme with no code change, since that is how `docs/PLAN/07` says templates differ from one another.
3. Implement `layout_variant` handling where the schema offers options, for example gallery grid versus carousel.
3b. Build the Maps section per ADR-014: **no map SDK on the public page**. A lazily-loaded static map image plus an "Open in Google Maps" deep link built from the stored coordinates. An embedded map SDK is one of the heaviest things a page can load, against a 150KB budget on a mid-range phone, and it bills per load on the one surface with unbounded traffic.
4. Hide sub-elements gracefully when optional fields are empty (`docs/PLAN/07` § Required vs Optional) — an absent caption leaves no empty box behind.
5. Meet the accessibility floor from `docs/UI-UX/17` even under decorative design: contrast over photo backgrounds via overlay, keyboard-operable controls, real alt text, `prefers-reduced-motion` honoured for scroll reveals.
6. Leave RSVP and Guestbook as presentational shells here; their submission wiring is Phase 4.
7. Add a visual regression snapshot per component, per `docs/FRONTEND/10` § Visual Regression — these components are shared across every template, so an unintended change has wide blast radius.

**Definition of Done**
- [ ] All ten components render from theme tokens with no hard-coded colour or font.
- [ ] Empty optional fields leave no visual artifact.
- [ ] Each component passes an automated accessibility check, including contrast over an image background.
- [ ] `prefers-reduced-motion` disables non-essential animation.
- [ ] Visual snapshots exist for each component in both layout variants where applicable.

---

## P2-04 — Per-Section Error Boundaries

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P2-03 |
| **Spec refs** | `docs/FRONTEND/08-ERROR-BOUNDARIES.md`, `docs/PLAN/18` R5 |
| **Spec required** | No |
| **Surface** | web-app, public-invite |

**Goal** — One broken section never takes down an invitation that hundreds of guests are opening.

**Steps**
1. Wrap each rendered section in its own boundary inside the renderer, per `docs/FRONTEND/04` § Per-Section Error Boundary.
2. Implement the three levels from `docs/FRONTEND/08`: app root, route, and section.
3. Fall back a failed section to a minimal placeholder or nothing, while every other section keeps rendering. `docs/FRONTEND/08` is explicit that event details and RSVP must survive another section's failure — they are the functional core of the page.
4. Protect the editor case too: a preview render failure must leave the properties panel and the user's unsaved data intact.
5. Report boundary catches to error tracking with `invitation_id` and `section_key` — and without bank account numbers or guest data (`docs/FRONTEND/08` § Logging, `docs/SECURITY/09`).
6. Test by deliberately corrupting one section's data and asserting the rest of the page still renders and RSVP still works.

**Definition of Done**
- [ ] A section that throws does not blank the page; the corruption test proves it.
- [ ] A preview crash in the editor leaves the form and local state usable.
- [ ] Error reports carry section context and no sensitive fields.

---

## P2-05 — Live Preview in the Editor

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P2-03, P1-22 |
| **Spec refs** | `docs/FRONTEND/06-EDITOR-ARCHITECTURE.md`, `docs/UI-UX/12-EDITOR-UX.md`, `docs/PLAN/17` § Non-Functional Performance |
| **Spec required** | No |
| **Surface** | web-app |

**Goal** — The preview renders from local editor state and updates in under 300ms, independent of the autosave request.

**Steps**
1. Mount `TemplateRenderer` in `live` mode against the editor store from `P1-22`.
2. Read from local state, never from a refetch. `docs/FRONTEND/06` § Why Not Fetch-on-Every-Keystroke is the reason the 300ms criterion in `docs/PLAN/17` is achievable at all.
3. Render in the same document rather than an iframe, per `docs/FRONTEND/06` § Performance — simpler state sync; iframe isolation is reconsidered only if CSS bleed becomes a real problem.
4. Implement the device toggle (375px mobile frame, scaled desktop) from `docs/UI-UX/12`.
5. Implement section-click-to-scroll: selecting a section in the sidebar scrolls the preview to it via a per-section ref.
6. Add the preview skip-link from `docs/UI-UX/17` § Areas of Special Attention, so a keyboard user is not trapped tabbing through the whole preview to reach the properties panel.
7. Measure the update latency in a test and assert the budget rather than eyeballing it.

**Definition of Done**
- [ ] A keystroke reaches the preview in under 300ms with no network request, asserted by a test.
- [ ] Device toggle and scroll-to-section work.
- [ ] The preview is skippable by keyboard.
- [ ] Preview and public page render through the same component code — a diff test asserts the same DOM for the same data.

---

## P2-06 — Publish-Check Endpoint and Editor Checklist

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-20, P1-14 |
| **Spec refs** | `docs/API/04` § Publish, `docs/BACKEND/03` § Validating Completeness, `docs/PLAN/02` § BR-4.2, `docs/UI-UX/12` § Publish CTA |
| **Spec required** | Yes — business rule |
| **Surface** | backend, web-app |

**Goal** — `GET /invitations/:id/publish-check` returns the missing required fields, and the editor shows the user exactly what is left before they can publish.

**Steps**
1. Implement the resolver from `docs/BACKEND/03` § Validating Completeness: for each **enabled** section, check each `required_fields` path against the invitation data using the shared dot-notation resolver from `P0-20`. A disabled section's required fields do not block publishing — that is why the enablement check comes first.
2. Return the missing paths as `details[]`, in the shape `POST /publish` will use for its 422, so the UI has one rendering path for both.
3. Map each field path to a human label and a section, so the checklist can say "the bride's nickname in the Couple section", not `couple.bride.nickname`.
4. In the editor, mark incomplete sections in the sidebar (`docs/UI-UX/10` § SectionListItem) and keep the Publish button visible but disabled with an explanatory tooltip — `docs/UI-UX/12` § Publish CTA requires the button to be visible-and-explained rather than hidden.
5. Evaluate the checklist client-side for immediacy while treating the server as authoritative (`docs/FRONTEND/03` § Validation).

**Definition of Done**
- [ ] A required field inside a disabled section does not block publishing; a test covers exactly this.
- [ ] The endpoint's `details[]` shape matches the publish endpoint's 422 body.
- [ ] The editor shows per-section incompleteness and never hides the Publish button.
- [ ] Field paths never reach the user interface untranslated.

---

## P2-07 — Public Invitation API

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-14, P2-01 |
| **Spec refs** | `docs/API/08-PUBLIC-INVITATION-API.md`, `docs/SECURITY/02-TRUST-BOUNDARIES.md`, `docs/PLAN/02` § BR-4.1, `docs/ARCHITECTURE/06` § Caching |
| **Spec required** | Yes — public surface |
| **Surface** | backend |

**Goal** — `GET /public/i/:slug` returns exactly what a published invitation is allowed to expose, and nothing else.

**Steps**
1. Implement the endpoint per `docs/API/08`, returning template sections and theme plus the invitation's public data.
2. Query with `status = 'published' AND deleted_at IS NULL` in SQL. `docs/SECURITY/01` names leaking an unpublished invitation as the information-disclosure risk on this surface, and the filter belongs in the query, not in a later branch.
3. Return a uniform 404 for not-found, unpublished, expired and soft-deleted. `docs/API/08` requires the API not to distinguish these — the "invitation has ended" nuance is a UI concern driven by publicly safe status only.
4. Respect `enabled_sections` when building the payload: omit a section's data entirely when the owner disabled it. `docs/API/08` calls out `bank_accounts` specifically — data existing in the database is not consent to publish it (BR-4.1).
5. Whitelist output fields explicitly. Owner id, internal name, package, order and payment information, and guest contact data never appear on this surface.
6. Keep the response deterministic per `invitation_id + template_version_id` with no per-visitor variation, so it is cacheable (`docs/API/08` § Caching). Guest-name personalization is handled client-side.
7. Apply public rate limiting from `P1-07`.

**Definition of Done**
- [ ] A draft, unpublished, expired or deleted slug returns an identical 404.
- [ ] Disabled sections' data is absent from the payload, proven per section by tests, with a dedicated one for `bank_accounts`.
- [ ] The response contains no owner or commercial fields; a test asserts against an explicit forbidden-key list.
- [ ] Two requests for the same invitation produce byte-identical responses.

**Abuse cases to test**
| Abuse case | Source | Expectation |
|---|---|---|
| Fetching an unpublished invitation by guessed slug | `docs/SECURITY/01` | 404, no data |
| Timing difference reveals whether a slug ever existed | `docs/SECURITY/10` § Preventing Enumeration | Indistinguishable responses |
| Gift section disabled but bank accounts still returned | `docs/PLAN/02` § BR-4.1 | Omitted from payload |

---

## P2-08 — Public Invitation SSR App and Host Routing

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P2-07, P2-03, P0-23 |
| **Spec refs** | `docs/FRONTEND/07-PUBLIC-INVITATION.md`, `docs/BACKEND/06-PUBLISHING.md` § Slug Resolution, `docs/DEVOPS/03-REVERSE-PROXY.md` |
| **Spec required** | Yes — public surface |
| **Surface** | public-invite |

**Goal** — The invitation renders server-side at `{slug}.maindomain.com`, resolved from the `Host` header.

**Steps**
1. Implement host-based resolution per `docs/BACKEND/06`: extract the subdomain from `Host`, or look up a custom domain in Phase 7, then fetch by slug.
2. Fetch server-side during rendering, so the main content and meta tags exist in the initial HTML. `docs/FRONTEND/07` explains why: sharing bots scrape `og:*` without executing JavaScript, so a client-side fetch produces a broken WhatsApp preview.
3. Render through the shared renderer in `public` mode.
4. Implement the dedicated not-found page from `docs/UI-UX/14` § Special States — friendly, non-technical, matching the product's tone rather than a framework default.
5. Handle the reverse proxy's slug header from `docs/DEVOPS/03` while still validating the slug server-side; a proxy header is an input, not a fact.
6. Letterbox the page on desktop per `docs/UI-UX/15`: a mobile-width view centred on a large screen.
7. Keep the initial JavaScript payload within the `docs/FRONTEND/09` budget by code-splitting so only the active template's section components ship.

**Definition of Done**
- [ ] The initial HTML contains the invitation's content and meta tags, verified with JavaScript disabled.
- [ ] An unknown slug renders the friendly not-found page, not a framework error.
- [ ] Only the active template's components are in the bundle, verified by bundle analysis.
- [ ] Desktop letterboxing matches `docs/UI-UX/15`.

---

## P2-09 — SEO Metadata, Robots and Structured Data

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P2-08 |
| **Spec refs** | `docs/PLAN/15-SEO.md`, `docs/FRONTEND/07` § SEO Meta Generation, `docs/SECURITY/09-PRIVACY-DATA-PROTECTION.md` |
| **Spec required** | Yes — privacy |
| **Surface** | public-invite |

**Goal** — Correct link previews when an invitation is shared, and privacy-preserving defaults for search engines.

**Steps**
1. Generate per-invitation `title`, `og:title`, `og:description`, `og:image`, `og:type`, and `twitter:card`, per `docs/PLAN/15`.
2. Source `og:image` from the gallery photo with `is_cover = true`, falling back to the template thumbnail (`docs/FRONTEND/07`). Use an absolute URL at a size the sharing platforms accept.
3. Set the canonical URL to the active subdomain or custom domain.
4. Drive `robots` from `invitation_settings.seo_indexable`, **defaulting to `noindex`**. `docs/PLAN/15` and `docs/SECURITY/09` both make this the privacy default: guest names and RSVP messages should not land in a search index because nobody thought about it.
5. Add optional schema.org `Event` structured data carrying no sensitive fields — never bank accounts, never guest data.
6. Verify with the real scrapers, not just a unit test: WhatsApp, Facebook and Telegram link previews on a staging invitation.

**Definition of Done**
- [ ] A shared link shows the cover photo and couple names in WhatsApp, Facebook and Telegram.
- [ ] `noindex` is present unless the owner explicitly enabled indexing; a test asserts the default.
- [ ] Structured data contains no bank account or guest information.
- [ ] The fallback image path works for an invitation with no cover photo.

---

## P2-10 — Public Page Interactions

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P2-08 |
| **Spec refs** | `docs/UI-UX/14-PUBLIC-INVITATION-UX.md` § Key Interactions, `docs/FRONTEND/07` § Personalization, `docs/ARCHITECTURE/06` § Cache Segmentation |
| **Spec required** | No |
| **Surface** | public-invite |

**Goal** — Countdown, guest-name personalization, copy-to-clipboard, share, and the cover gate — implemented so the page stays cacheable.

**Steps**
1. Implement the countdown to the nearest future event, client-side, in the invitation's timezone (Asia/Jakarta by default, per `docs/PLAN/04` § F9).
2. Implement `?to=Name` personalization client-side after hydration. `docs/ARCHITECTURE/06` § Cache Segmentation is the reason: a server-rendered guest name would create one cache entry per guest and destroy the hit ratio the whole architecture depends on. Sanitize and length-cap the parameter before rendering it — it is attacker-controlled text in a URL people forward.
3. Implement copy-account-number with the brief "Copied!" feedback from `docs/UI-UX/16`.
4. Implement share to WhatsApp with pre-filled text, and copy-link.
5. Implement the cover gate: an "Open Invitation" action that reveals the page and satisfies the browser gesture requirement for background music autoplay (`docs/UI-UX/14`).
6. Add the floating mute/unmute control when the music section is active, defaulting to muted where autoplay policy requires it — Safari on iOS specifically (`docs/TESTING/06`).
7. Keep every interaction keyboard-accessible.

**Definition of Done**
- [ ] The countdown targets the nearest future event and survives a passed event.
- [ ] Personalization never affects the server response or the cache key.
- [ ] A `?to=` value containing markup renders as text, never as HTML.
- [ ] Copy, share and the cover gate work on iOS Safari and Android Chrome.

---

## P2-11 — Template Catalog and Detail UI, Demo Mode

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P2-01, P2-03 |
| **Spec refs** | `docs/UI-UX/11-TEMPLATE-UX.md`, `docs/PLAN/04` § F1, `docs/PLAN/15` § Marketing Pages |
| **Spec required** | No |
| **Surface** | web-app |

**Goal** — The catalog, the detail page, and a live demo rendered by the production renderer rather than a mock.

**Steps**
1. Build the catalog grid with filters, search and sort per `docs/UI-UX/11`, responsive from two columns on mobile to four on desktop.
2. Build the detail page: hero, category tags, premium badge, a per-section screenshot carousel, the supported-section list, and a sticky "Use This Template" button on mobile.
3. Implement "View Live Demo" through the real renderer in `demo` mode with the seeded demo data from `P0-21`. `docs/UI-UX/11` is explicit that a separately mocked static demo misleads users about what they will get.
4. Implement the logged-out path: remember the template choice, send the user to register or log in, and resume the flow afterwards.
5. Make the marketing surfaces indexable and fast, per `docs/PLAN/15` § Marketing Pages — sitemap, meta tags, server rendering. Note the deliberate asymmetry: catalog pages are for search engines; invitation pages are not.

**Definition of Done**
- [ ] Filters, search and sort work against the API and are reflected in the URL.
- [ ] The demo renders through the shared renderer with no separate mock page.
- [ ] A logged-out user's template choice survives authentication.
- [ ] Catalog and detail pages are indexable and carry a sitemap entry.

---

## P2-12 — Share-Preview Links

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P2-08 |
| **Spec refs** | `docs/API/04` § Preview, `docs/PLAN/04` § F6, `docs/PLAN/01` FR-4.3 |
| **Spec required** | Yes — public surface |
| **Surface** | backend, public-invite |

**Goal** — A time-limited link that lets a partner or organizer see an unpublished invitation, watermarked, without making it public.

**Steps**
1. Implement against `invitation_preview_tokens` (`docs/DATABASE/04` § Share-Preview Tokens) and the public resolve route `GET /public/preview/:token` (`docs/API/08`), both added by ADR-020 and ADR-021. `docs/API/04` also gains list and revoke endpoints; the token itself is returned once, at creation, and stored only as a hash.
2. Generate a high-entropy token stored hashed, with the 7-day expiry from `docs/PLAN/04` § F6. The token is the only thing standing between an unpublished invitation and the internet, so treat it like a credential.
3. Serve the preview through the same renderer with the prominent "PREVIEW — NOT YET PUBLISHED" watermark required by FR-4.3.
4. Force `noindex` on preview responses regardless of the invitation's setting.
5. Disable submissions in preview mode — a preview must not create real RSVP or guestbook rows.
6. Let the owner revoke a preview link, and expire tokens automatically.
7. Rate limit the resolve route, and make an invalid or expired token indistinguishable from a nonexistent one.

**Definition of Done**
- [ ] Preview tokens are hashed at rest, expire in 7 days, and are revocable.
- [ ] A preview page is always `noindex` and always watermarked.
- [ ] RSVP and guestbook submissions from a preview create no rows.
- [ ] An expired token and an invented token produce identical responses.

---

## P2-13 — Performance Budget and Core Web Vitals Baseline

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P2-10 |
| **Spec refs** | `docs/FRONTEND/09-PERFORMANCE.md`, `docs/PLAN/17` § Non-Functional Performance, `docs/UI-UX/18` § Public Page |
| **Spec required** | No |
| **Surface** | public-invite |

**Goal** — The public page meets LCP under 2.5s on simulated 4G before Phase 3 adds caching on top, so the number reflects the page rather than the cache.

**Steps**
1. Apply the techniques in `docs/FRONTEND/09`: WebP with responsive `srcset` from the pre-generated variants, eager loading for the cover as the LCP element, lazy loading below the fold, font subsetting and preloading with `font-display: swap`, critical CSS inline.
2. Reserve image and section dimensions to keep CLS under 0.1.
3. Enforce the initial JavaScript budget of about 150KB gzip through aggressive code splitting.
4. Measure in CI on every public-invite change and fail the build when the budget is exceeded — a budget that is only checked manually is a budget that drifts.
5. Set up real user monitoring for production Core Web Vitals, per `docs/FRONTEND/09` § Monitoring, since lab numbers do not describe a guest on a mid-range Android phone on a crowded network.

**Definition of Done**
- [ ] LCP under 2.5s and CLS under 0.1 on a simulated 4G run against a representative invitation.
- [ ] The bundle budget is enforced in CI.
- [ ] RUM is wired and reporting.
- [ ] Cover photo is the LCP element and loads eagerly; everything else is lazy.

---

## P2-14 — Phase 2 Test Suite and Acceptance

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | all Phase 2 tasks |
| **Spec refs** | `docs/FRONTEND/10-TESTING.md`, `docs/TESTING/03-E2E-TESTING.md`, `docs/PLAN/17-ACCEPTANCE-CRITERIA.md` |
| **Spec required** | No |
| **Surface** | all |

**Goal** — Close the phase with the renderer's guarantees proven rather than assumed.

**Steps**
1. Test the renderer across `enabled_sections` combinations, asserting disabled sections are absent from the DOM (`docs/FRONTEND/10` § Integration Test).
2. Run the template-switch E2E from `docs/TESTING/03` § 2 now that rendering exists: data survives, unsupported sections hide, switching back restores them.
3. Verify the editor preview latency budget and the public page LCP budget.
4. Verify link previews with the real scrapers.
5. Run the public API disclosure suite from `P2-07` as a set, not as scattered assertions.
6. Confirm the IDOR posture of every new `:id` endpoint added this phase.
7. Write the phase summary record.

**Definition of Done**
- [ ] Disabled sections are provably absent from the rendered DOM and from the API payload.
- [ ] The template-switch E2E passes.
- [ ] Both performance budgets pass in CI.
- [ ] The phase summary exists in `MEMORY/records/`.
