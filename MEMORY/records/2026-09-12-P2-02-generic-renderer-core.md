# P2-02 — Generic renderer core

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-2-TEMPLATE-RENDERING-AND-PREVIEW.md` § P2-02 |
| **Phase** | Phase 2 |
| **Surface** | web-app, public-invite |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P2-02-renderer-core` |
| **Status** | Completed |
| **Spec** | [`MEMORY/specs/P2-02-generic-renderer-core.md`](../specs/P2-02-generic-renderer-core.md) — written before the code, as the card requires |

---

## What Changed

`<TemplateRenderer>` in `packages/template-renderer`, imported and rendered by both
frontends. The five-step render flow from `docs/FRONTEND/04`, the component registry, the
theme merge, the three modes, and the guard that keeps all of it generic.

| | |
|---|---|
| `TemplateRenderer.tsx` | the render flow |
| `resolve-data.ts` | dot-notation, including `events.*.venue_name` collections |
| `theme.ts` | merge with override, flatten to CSS custom properties |
| `registry.tsx` | name → component, built from `@wi/schema`'s list |
| `scripts/check-renderer-is-generic.mjs` | **New build guard**, in `verify.sh` and `pre-push` |
| Tests | 32 in the package, 1 in web-app, 2 in public-invite |

## Why

`CLAUDE.md`'s first non-negotiable, in executable form: *"Templates are data, not code.
No template-specific backend logic, no per-template React/Vue components."* Everything
after this card — the preview, the public page, the catalogue demo — renders through this
one component or the claim stops being true.

## How

**The render flow is `docs/FRONTEND/04`'s five steps, in order**, including the exception
in step 2: a section absent from `enabled_sections` is skipped **unless**
`configurable: false`, in which case it always shows. `P1-15`'s recompute already relies
on that rule from the other side.

**A section receives only the fields it declared.** Not the whole invitation. Two reasons,
and the second is the one that matters: a component handed everything can read anything,
so `required_fields` stops describing what it uses — and the gift accounts have no
business being in the hero's props.

**A disabled section is not in the DOM.** The card's own words: "a hidden section is still
a data leak in the page source". A `display:none` gift section still ships the couple's
account numbers to every guest who views source, and there is a test asserting the number
does not appear in `innerHTML`.

**Theme is CSS custom properties at the root.** `docs/FRONTEND/04` is specific about the
mechanism and the reason — components read `var(--color-primary)`, so a theme change
restyles the tree without re-rendering it. It is also what makes the non-negotiable hold:
a component with a colour in it belongs to one template; a component reading a variable is
the same component under every template.

**An override applies only if the template lists the key as customizable.** `P1-14`
already refuses to *store* one outside the list, so this is a second layer — and it
protects a different thing. ADR-054 keeps section data across a template change and drops
theme overrides; an override stored under a key the *new* template does not list would
otherwise still apply.

**An unregistered component skips its section and reports.** `docs/PLAN/18` R5. A blank
invitation because one stored definition names a removed component is the outcome this
avoids, and the caller is told through a callback rather than a log line — this package
runs under SSR and in a browser, and a logger here would be a second logging path outside
`@wi/logging`'s redaction.

## Files and Components Touched

| Path | Change |
|---|---|
| `packages/template-renderer/src/{TemplateRenderer,registry}.tsx` | **New** |
| `packages/template-renderer/src/{resolve-data,theme,types,index}.ts` | **New** |
| `packages/template-renderer/src/*.spec.tsx` | **New** — 32 tests |
| `packages/template-renderer/{package,tsconfig,vitest.config}` | ESM, React, jsdom |
| `scripts/check-renderer-is-generic.mjs` | **New guard** |
| `scripts/verify.sh`, `.githooks/pre-push` | the guard, blocking |
| `frontend/public-invite/{vitest.config.mts,test/}` | **New** — its first unit tests |
| `frontend/{web-app,public-invite}/test/renderer-import.spec.tsx` | **New** — DoD item 1 |

## Decisions Made

| Decision | Rationale |
|---|---|
| `enabledSections` and `themeOverride` are separate props, not nested in `invitationData` | `docs/PLAN/08` § Where Settings Fields Physically Live keeps them in another table, and `P1-14` already treats them as a different concern |
| `mode` is required, never defaulted | A section that could submit an RSVP because a prop was missing is exactly what the mode exists to prevent, and a default is how that happens |
| Collections resolve grouped by element | `events.*.title` + `events.*.venue_name` gives each event both. Two flat lists could not be rendered as cards |
| An absent field is absent from the props, not `undefined` | `docs/PLAN/07` § Required vs Optional — the cheapest way to leave no empty box is for the key never to arrive |
| `required_fields` and `optional_fields` both reach the component | The distinction is about what the **publish check** refuses (`P2-06`), not about what a component may see |
| The theme is cloned before an override is applied | The definition comes from `P2-01`'s cache and may be shared between requests; mutating it would apply one invitation's colour to the next |
| The section key alone is not the React key | `docs/PLAN/07` does not forbid two galleries in one template |
| Issues are a callback, not a log | SSR and browser both; `public-invite` logs server-side, the editor shows it |
| Stand-in components, replaced by `P2-03` | The core's tests need *a* component per name. Built from `@wi/schema`'s list so they cannot drift by omission while they are stand-ins |

## Deviations from `docs/`

**None.** `docs/FRONTEND/04` places the per-section error boundary in the renderer while
`TASKS` gives it its own card (`P2-04`); that is sequencing rather than conflict, and each
section is already wrapped in its own element so the boundary drops in without a change of
shape.

## Tests Added

35.

| Group | Cases |
|---|---|
| Step 1, order | definition order, not alphabetical; **two sections of the same key both render** |
| Step 2, enabling | a disabled section omitted; **its data absent from `innerHTML`**; `configurable: false` shows anyway; `enabled_by_default` decides when no settings exist |
| Step 3, registry | which component rendered which section; **an unregistered component skips its section and reports**; no handler required |
| Step 4, data | only declared fields; **collections grouped per element**; an absent field omitted entirely |
| Step 5, props | custom properties at the root; `layout_variant` and `max_items`; **mode reaches every section, for all three modes** |
| Never | **markup renders as text**; an override outside `customizable_theme_keys` ignored; **the template's theme is not mutated**; an empty template still yields a themed root |
| **Parity** | a component for every schema name; **no component the schema does not know**; a count check; prototype keys resolve to nothing; the registry is frozen |
| **Reference template** | all nine enabled sections, **in definition order**, from the seed JSON itself; the disabled one omitted; the theme applied; real names and both events; all three modes |
| Both surfaces | web-app and public-invite each import and render it; **public-invite asserts the account number is not in the page source** |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| A disabled section's data never reaches the page | Card DoD | `"a disabled section is absent from the DOM, not hidden"` searches `innerHTML` for the value, plus the same assertion from `public-invite`, which is the surface it matters on |
| Stored text cannot become HTML | `docs/SECURITY/08` | `"renders markup in a name as text, never as HTML"` — asserts no `<img>` exists and the characters do. The guard additionally forbids `dangerouslySetInnerHTML` anywhere in the package |
| Templates stay data | `CLAUDE.md` | **Mutation**: a template slug assigned and compared in `TemplateRenderer.tsx`. `check-renderer-is-generic.mjs` reported four violations across two lines and exited 1 |
| A stored template cannot name code that does not exist | `docs/PLAN/18` R5 | The parity test, both directions — the one ADR-037 has owed since `P0-20` |
| A path cannot reach the prototype chain | — | `readPath` requires `hasOwnProperty`; `assignPath` refuses `__proto__`, `constructor`, `prototype`; `resolveComponent` returns `undefined` for all three |

## Abuse Cases Covered

- Reading a disabled section's data from the page source.
- A name or caption containing markup rendering as elements.
- A theme override for a key the template does not permit.
- A stored template naming a component that was removed.
- A section path of `constructor.prototype` walking out of the object graph.

## DoD Verification

- [x] **Imported by both `frontend/web-app` and `frontend/public-invite` from one package**
      — and proved by rendering from each, not by the manifest. Both already *declared*
      the dependency before the package had anything in it.
- [x] **A template version naming an unregistered component fails CI** — the parity test,
      plus the renderer skipping and reporting at runtime.
- [x] **No template identifier appears in a conditional anywhere in the package** —
      `check-renderer-is-generic.mjs`, in `verify.sh` and `pre-push`, mutation-verified.
- [x] **Rendering the reference template with demo data produces every enabled section, in
      order** — from the seed JSON files themselves rather than a copy.
- [x] **Disabled sections are absent from the DOM, not hidden with CSS.**
- [x] **The parity test `P0-20` owed (ADR-037)** — both directions.
- [x] **`P0-21`'s handoff**: what was unproven was that the fixtures *render*. They do, in
      all three modes, with no section reporting an issue.

## What Did Not Work

**1. `"type": "module"` changed the rules for every import in the package.** Setting it
switched TypeScript to NodeNext resolution, which requires explicit `.js` extensions on
relative specifiers — six errors at once, in files that had been correct a moment earlier.
`@wi/ui` already writes `./cx.js`, so the convention existed; the package just had no
relative imports before this card to reveal it.

**2. I wrote an assertion that cannot fail.** `expect(screen.getByTestId ?? true)` — a
function reference that is always truthy, in a test named "renders nothing at all for a
template with no sections". It passed, it looked like a test, and it asserted nothing.
Replaced with the real property: an empty template still produces a themed root, because
`P2-11`'s catalogue can render a template with every section disabled and should get an
empty page rather than no page.

Worth recording because it is the failure mode this project keeps finding in *other*
people's tests, written here by inattention while assembling a long file.

**3. The guard's own documentation failed the guard.** The long comment at the top of
`check-renderer-is-generic.mjs` quotes `if (slug === "elegant-rose")` as the thing it
forbids — and the same phrasing in a renderer comment would have tripped it. Comment
lines are stripped before the identifier and slug checks for exactly that reason;
`dangerouslySetInnerHTML` and network calls are checked in comments too, because a
commented-out `fetch` is a fetch somebody intends to restore.

## Follow-Ups and Open Questions

- **The ten section components are stand-ins.** `P2-03` replaces `registry.tsx`'s
  placeholder with the real map. Every test here asserts structure — which component
  rendered which section, what data it received — so they survive that change, which is
  what makes them worth having now.
- **No error boundary yet.** `P2-04`. `docs/FRONTEND/04` places it here; each section is
  already its own element, so it drops in without restructuring.
- **The registry is built from `@wi/schema`'s keys while the components are stand-ins**,
  so drift is currently impossible by construction. `P2-03` writes the map out explicitly
  and drift becomes possible again — at which point the parity test stops being belt and
  braces and becomes the only thing holding.
- **`layout_options` is carried in the type and not used.** `P2-03` implements variant
  handling; the renderer passes `layout_variant` through and that is all it should do.
- **`docs/FRONTEND/04`'s `COMPONENT_REGISTRY` and `@wi/schema`'s share a name.** Two maps,
  one name, deliberately — the schema's is the vocabulary the API validates against and
  cannot import React. The parity test is what makes the duplication safe.

## What to Watch

**The guard forbids `templateId` and `template_id` as identifiers anywhere in the
package.** That is stricter than "no branching on a template" and deliberately so — a
value that cannot be named cannot be branched on. It will eventually block something that
looks reasonable, and the right response is almost always to put the fact in the
definition rather than to loosen the guard.

**Placeholder components render `JSON.stringify(data)` into the DOM.** That is how the
core's tests assert what a section received. When `P2-03` replaces them, any test asserting
on that serialised text stops meaning what it did — the tests here are written against
`data-section`, `data-component` and `data-mode` attributes for that reason, with only two
deliberately checking content.
