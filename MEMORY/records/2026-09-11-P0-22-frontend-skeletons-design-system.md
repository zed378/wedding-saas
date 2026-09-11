# P0-22 — Frontend skeletons and the design system package

| | |
|---|---|
| **Date** | 2026-09-11 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-22 |
| **Phase** | Phase 0 |
| **Surface** | web-app, public-invite, admin, packages |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-22-frontend-skeletons-design-system` |
| **Status** | Completed |

---

## What Changed

Three applications that build and serve a page, and one token-driven component library they share.

- **`packages/ui`** — the design tokens from `docs/UI-UX/06`–`09` as a Tailwind v4 `@theme` block, plus the thirteen core components with every state `docs/UI-UX/06` § Usage Rules lists.
- **`packages/api-client`** — the centralised interceptor from `docs/FRONTEND/08` and an access-token store with no persistent branch to configure.
- **`frontend/web-app`** (Next 16), **`frontend/public-invite`** (Next 16, server-rendered), **`admin/`** (Vite 8).
- **The workbench** at `/workbench`, audited by axe in a real browser, per component.
- **Two build guards**: no token in browser storage, no hard-coded colour, size or spacing.

## Why

The card's goal is one sentence and it is the whole justification: "so no Phase 1 screen invents a button". Every screen in Phases 1–5 is built on this. A design system arriving after the screens is a design system nobody adopts.

The accessibility floor is the part that had to be built in rather than added later. `docs/UI-UX/17` asks for visible focus, label association, a 44px touch target and contrast-checked pairs; all four are properties of a component, and a component that lacks them is copied into thirty screens before anyone audits one.

## How

**The tokens are CSS, not a config object** (ADR-039). Tailwind v4's `@theme` emits both the custom properties and the utility classes from one declaration, so `bg-primary-600`, `var(--color-primary-600)` and the value in the file cannot disagree. A semantic layer (`--color-surface`, `--color-text-muted`, `--color-border-strong`) sits on top and is what components reference — which is the structure `docs/UI-UX/08` § Dark Mode asks to be left possible.

**`public-invite` deliberately does not import those tokens.** `docs/UI-UX/07` and `08` both open by saying they describe application chrome; an invitation's colours come from `template_versions.theme`. Importing them there would give every wedding the dashboard's indigo, which is the thing `docs/PLAN/07` exists to prevent.

**The platform element, wherever there is one.** `<dialog>` for Modal, because it traps focus, makes the page inert, handles Escape and renders in the top layer — four things a `<div role="dialog">` has to reimplement and usually gets wrong. A native `<select>`, because a custom listbox is the most commonly broken widget on the web and the searchable variant is a filter *above* a select rather than a bespoke popup. A real `<input type="file">` under the Dropzone, which is what gives it keyboard operation and the phone camera for free.

**Colour is never the only signal.** `docs/UI-UX/08` says so outright. `InvitationStatusBadge` has no prop to hide its label. The Stepper writes "(selesai)" / "(langkah saat ini)" / "(belum dimulai)" into the accessibility tree. Toast prefixes its variant in words.

**Errors interrupt; everything else waits.** Toast keeps two live regions, both present from first render — a region created at the moment its content arrives is frequently not announced. Errors are `assertive` and do not auto-dismiss; `docs/FRONTEND/08` routes 5xx there, and a message that vanishes after four seconds is one a user can miss entirely.

**One refresh for many 401s.** `ApiClient` shares an in-flight refresh promise. With a rotating refresh token (`docs/SECURITY/03`), six concurrent 401s would otherwise run six refreshes, five of them presenting a token the first already consumed — which the server must treat as theft and which revokes the whole family. The user is logged out for loading their own dashboard.

**The token store is a closure variable.** No `persist` option, no `storage` parameter defaulting to `sessionStorage`, nothing to configure wrongly. The DoD asks for "no code path that writes an access token to persistent storage", and absence is easiest to guarantee when there is nothing there.

## Files and Components Touched

| Path | Change |
|---|---|
| `packages/ui/src/tokens.css` | **New** — every colour, type step, spacing, radius and shadow, plus the `touch-target` and `focus-ring` utilities |
| `packages/ui/src/components/*` | **New** — 13 components + `Field`, `Spinner`, `button-class`, `InteractiveCard` |
| `packages/ui/src/testing/{setup,axe}.ts` | **New** — the `<dialog>` polyfill and the per-component axe helper |
| `packages/api-client/src/{client,token-store,errors}.ts` | **New** — interceptor, in-memory store, error taxonomy |
| `frontend/web-app/` | **New** — Next 16 shell, skip link, `lang="id"`, security headers, `/workbench` |
| `frontend/public-invite/` | **New** — Next 16, `/[slug]` server-rendered, no `@wi/ui` |
| `admin/` | **New** — Vite 8 SPA, `noindex`, same design system |
| `e2e/tests/workbench.e2e.ts` | **New** — 11 browser tests including the contrast negative control |
| `scripts/check-token-storage.mjs` | **New guard**, blocking |
| `scripts/check-design-tokens.mjs` | **New guard**, blocking — DoD item 2 |
| `e2e/playwright.config.ts` | Scope note corrected — it claimed E2E had no real page to audit |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Tokens in CSS via Tailwind v4 `@theme` | One declaration produces both the utility and the variable | ADR-039 |
| `@wi/ui` is ESM | CommonJS puts `"use strict"` in front of `"use client"`, and Next then never sees it | ADR-040 |
| Only interactive components are client components | Marking the rest would bundle them for nothing | ADR-040 |
| The workbench is an app route, not Storybook | It audits what actually ships, in the app's own build | ADR-041 |
| `public-invite` gets no chrome tokens | An invitation's palette is per-template data | — |
| Native `<dialog>` and `<select>` | Four correct behaviours and a platform picker, for free | — |
| Disabled states use explicit colours, never `opacity` | A blend is a colour nobody chose and no test can check — see below | — |

## Deviations from `docs/`

None. `docs/FRONTEND/00` § Project Structure still shows `apps/`; the repository uses `backend/`, `frontend/`, `admin/` by ADR-027, which is a recorded deviation from `P0-25` rather than a new one.

## Tests Added

**454 unit** across the workspace (was 322), **18 E2E** (was 7). Integration unchanged at 191.

| Group | Cases |
|---|---|
| `@wi/ui` — forms (24) | label association, visually-hidden labels, `aria-describedby` for helper **and** error together, `aria-invalid`, required announced without reading "asterisk", distinct ids per instance, disabled behaviour, the searchable filter and its announced count, the file input being real and `sr-only` rather than `display:none`, progress clamped |
| `@wi/ui` — controls (26) | loading swallows the click **but stays focusable**, `type="button"` by default, dialog named and described, closes through the caller, form modal ignores a backdrop click, tab arrows/Home/End/wrap/skip-disabled, roving tabindex, stepper states in words |
| `@wi/ui` — display (24) | **every status the database CHECK allows has a presentation**, each tone matches `docs/UI-UX/08`, a label always renders, an unknown status degrades rather than throws, table structure and `aria-sort`, keyboard sorting, skeleton hidden from AT, avatar alt text, surrogate-pair initials |
| `@wi/ui` — toast (8) | errors assertive and persistent, everything else polite and auto-dismissed, both regions present from first render, variant named in words |
| `@wi/ui` — tokens (49) | the contrast maths against WCAG reference values, the five documented palette values, the 4px base, the radius scale, the 44px floor, `prefers-reduced-motion`, and **35 text pairs at 4.5:1 plus 6 non-text pairs at 3:1** |
| `@wi/api-client` (31) | envelope unwrapping, pagination meta, request id, 204, non-envelope treated as a server problem, **5xx message replaced with a generic one**, offline vs abort, **one refresh for six concurrent 401s**, session end on refresh failure, no loop when the fresh token is also rejected, anonymous requests skip refresh, `credentials: "include"`, query building, idempotency key |
| `@wi/api-client` — storage (2) | **no storage API in any executable line of the package**, plus an inline mutation proving that check can fail |
| `e2e/workbench` (11) | a story per component, whole-page axe, **per-story axe including colour contrast**, **a deliberately unreadable element proving `color-contrast` is live**, focus containment, page inertness, Escape, skip link, `lang`, delivered security headers |

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| The access token never reaches persistent storage | `docs/FRONTEND/02` § Auth Token Storage | `token-store.spec.ts` → "names no storage API in any executable line of the package", reading the package's own source with comments stripped. Plus `scripts/check-token-storage.mjs` over all 132 files, blocking. **Mutation**: adding `localStorage.setItem("access_token", …)` to `packages/ui/src/mutant.ts` fails the guard, exit 1, naming the file |
| A rotating refresh token is not burned by concurrency | `docs/SECURITY/03` | `client.spec.ts` → "runs exactly one refresh for many concurrent 401s" — six parallel requests, `refresh` called once |
| A 5xx never renders the server's message | `docs/FRONTEND/08` | "replaces the server's 5xx message with a generic one" — asserts a connection string in the server's message does not reach the thrown error |
| The refresh cookie can actually travel | `docs/FRONTEND/02` | "includes credentials so the HTTP-only refresh cookie travels" — without it the refresh flow fails as a 401 loop rather than as an obvious bug |
| Contrast reaches WCAG AA | `docs/UI-UX/08` § Contrast & Accessibility | Two independent checks: `tokens.spec.ts` computes 41 pairs from the token values, and the browser axe pass measures rendered pixels. **The second caught a failure the first could not** — see below |
| The contrast rule is actually running | — | `workbench.e2e.ts` → "colour contrast is actually being checked, not silently skipped": injects an unreadable element and asserts axe reports it. axe returns zero violations both for a perfect page and for a rule that never ran |
| Every component is keyboard operable and labelled | `docs/UI-UX/17` | An axe assertion in every component test, plus the per-story browser pass |
| No hard-coded design value | `docs/UI-UX/06`, DoD item 2 | `scripts/check-design-tokens.mjs`, blocking. **Mutation**: a component with `bg-[#4f46e5] text-[13px] style={{padding:"7px"}}` fails it |
| The admin panel is a separate trust boundary | `docs/SECURITY/02` | Structural: a separate Vite application with its own entry, its own session (P5-01 gives it the hostname), `noindex` in its HTML |
| Security headers are delivered, not merely configured | `docs/SECURITY/08` | `workbench.e2e.ts` → "delivers the security headers it configures", read off a real response |

## Abuse Cases Covered

- **A developer persists the token to avoid a refresh round trip.** Blocked by the guard before push. It looks like a performance improvement in review, which is why a mechanism and not a checklist.
- **A stolen user session reaches an admin screen.** Structurally impossible: different application, different origin, different session (`docs/SECURITY/02`). `P5-01` completes it with the hostname.
- **An error toast the user misses.** Errors do not auto-dismiss.
- **A modal that looks blocking but is not.** The page behind is genuinely inert, asserted in a browser.

## DoD Verification

- [x] **Three apps build and serve a page.** `web-app` prerenders `/` and `/workbench`; `public-invite` server-renders `/[slug]` on demand, which is what `docs/FRONTEND/07` requires; `admin` builds a 228 kB bundle.
- [x] **No colour, font size or spacing value is hard-coded; a lint rule enforces token use.** `scripts/check-design-tokens.mjs`, blocking in `verify.sh` and on push, mutation-verified. It is a script rather than an ESLint rule because `P0-17` has not wired ESLint (ADR-028); moving it later is a small edit, and it blocks today.
- [x] **Every core component has all states and passes an automated accessibility check.** All thirteen, in jsdom per component and in a real browser per story.
- [x] **The API client has no code path that writes an access token to persistent storage.** Proven by reading its own source, and by a guard over the rest of the repository.
- [x] **The status badge map exists in exactly one place.** `Badge.tsx`, with a test that every status the database CHECK allows has an entry — taken from `docs/DATABASE/04` by hand, not generated from the map.
- [x] `bash scripts/verify.sh` clean; 454 unit, 191 integration, 18 E2E.
- [ ] **Storybook was not used.** The card allows "or equivalent"; the equivalent and its trade-offs are ADR-041.

## What Did Not Work

**1. The browser found a contrast failure that two other checks could not.**

`Dropzone`'s disabled state used `opacity-60`. axe computes the blended colour: `#171717` at 60% over `#f7f7f7` is `#727272`, giving **4.49:1** — one hundredth below the 4.5:1 `docs/UI-UX/08` requires.

Neither the jsdom axe pass (colour rules disabled, no layout engine) nor `tokens.spec.ts` (arithmetic on declared values, and nobody declares a blend) could see it. WCAG does exempt "inactive user interface components", which is why a disabled `<button>` with `opacity-50` passes — but the exemption did not apply here, because the opacity sat on a wrapper `<div>` and the text inside was not itself a disabled control.

Fixed by expressing disabled with chosen colours instead of a blend, in `Dropzone` **and** in `Field`'s shared control style, where the same pattern would have been the same latent problem. Chosen colours can be measured; both new pairs are now in `tokens.spec.ts`.

**2. Three token choices failed the contrast test on first run.**

`neutral-500` muted text on a sunken panel (4.35:1), white on `success-600` for the Stepper's done marker (3.30:1), and — worst — `neutral-300` as the control border, at **1.48:1** on white. That last one is the most common accessibility defect in modern form design: a hairline input border that looks tasteful and is invisible to anyone with reduced contrast sensitivity. WCAG 2.1 § 1.4.11 requires 3:1 for the boundary of a control.

The fix separated `--color-border` (decoration, no floor) from `--color-border-strong` (control boundary, 3:1), which is why there are two border tokens at all.

**3. A test asserted the opposite of correct behaviour.**

"traps focus inside the dialog" tabbed twelve times and required `document.activeElement` to stay inside the dialog. It failed on a correct implementation: tabbing past the last element in the top layer hands focus to the **browser's own chrome**, at which point `activeElement` is `<body>`. A test that calls that a failure is a test that pushes someone towards a hand-rolled focus trap — the exact thing `<dialog>` exists to avoid. Rewritten to assert that focus never reaches a control on the page behind.

**4. jsdom 30 implements neither `showModal()` nor `close()`.**

Every Modal test failed on the environment rather than the component. Polyfilled in `testing/setup.ts`, with the four things the polyfill **cannot** prove written down beside it and pointed at the browser suite that does.

**5. `"use client"` does not survive CommonJS compilation.**

`tsc` prepends `"use strict"`, which puts it in front of the directive. Fixed by making `@wi/ui` ESM (ADR-040). Two follow-on failures came from the same rule: `buttonClassName` — a pure function — was unreachable from a server component because it was exported from a client module, and `InteractiveCard` was dragging `Card` into the client bundle.

**6. A stale `.tsbuildinfo` replayed diagnostics for a file I had already fixed.**

`tsconfig.base.json` sets `incremental: true`; combined with `noEmit`, a `lib` change in a child config did not invalidate the cache, and `tsc` kept reporting "Cannot find name 'document'" against a config that plainly contained `dom`. `tsc --showConfig` proved the config was right and the errors were cached. Deleting `e2e/dist/.tsbuildinfo` fixed it. Worth an hour of anyone's time to know.

**7. The E2E suite ran against a stale server for two rounds.**

`next start` failed because the previous instance still held port 3100, the failure went to a log file nobody read, and the old build kept serving — so a fix that was already applied kept "failing". `pkill -f` does not work on Windows; `netstat -ano` plus `taskkill //PID //F` does.

## Follow-Ups and Open Questions

- **The token pair list in `tokens.spec.ts` is hand-maintained.** Nothing derives it from the components, so a new combination is checked only by the browser pass — which sees only what the workbench renders. Both are needed and neither is sufficient; that is written at the top of the file.
- **`packages/template-renderer` is still empty.** `P2-02`. It is deliberately outside the design-token guard: an invitation's colours are per-template data.
- **No `dev` orchestration.** Running the whole product locally is three `pnpm --filter … dev` commands plus compose. A root script would help once there is a reason to run all three at once.
- **ESLint is not wired** (`P0-17`, deferred by ADR-028), so both new guards are scripts. The design-token one is a natural `no-restricted-syntax` rule later.
- **No font files are bundled.** The stacks name Inter and JetBrains Mono and fall back to the system UI font. Self-hosting is a real decision about bytes and licensing and has not been made.
- **`public-invite` and `admin` have no tests of their own.** Both are shells; their content arrives in `P2` and `P5`. The E2E suite covers `web-app` only.

## What to Watch

**A component not rendered in the workbench is a component the browser accessibility pass never sees.** That is the single rule holding the audit together, and it is invisible: adding a component and forgetting the story produces no failure anywhere. It is written at the top of `stories.tsx` and `workbench.e2e.ts`, which is the most that can be done without a mechanism.

**`opacity` will come back for a disabled state.** It is what every UI library does and it looks fine. Two places now carry a comment explaining the measured failure; a third will not.

**The workbench E2E needs a server on port 3100 and says nothing useful without one.** It does not skip — it fails — but the failure looks like a broken component rather than a missing process.

**The `"use client"` boundary is easy to get wrong in the direction that only fails at build time.** Adding a hook to `Badge` or `Card` will break a server render with an error naming the app, not the component.
