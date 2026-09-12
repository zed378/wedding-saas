# P2-02 — Feature Spec: Generic Renderer Core

| | |
|---|---|
| **Task** | `P2-02` |
| **Date** | 2026-09-12 |
| **Author** | Claude Code session |
| **Status** | Draft |

---

## 1. Goal

One React component, `<TemplateRenderer>`, in `packages/template-renderer`, that turns a
template version's `sections` plus an invitation's data into rendered output — and is
imported unchanged by the editor's live preview, the public invitation page and the
catalogue demo. Afterwards, adding a template is a database row; it is never a deploy of
template-specific code.

This card builds the **core**: the render flow, the registry, theme application, modes,
and the guards that keep it generic. The ten section components are `P2-03`.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/FRONTEND/04` | Render Flow | The five steps, in order, including the `configurable: false` exception |
| `docs/FRONTEND/04` | Component Registry | Name → component map; a new name per breaking redesign |
| `docs/FRONTEND/04` | Theme Application | CSS custom properties at the renderer root, merged with `theme_override` |
| `docs/FRONTEND/04` | Mode Differences | `live`, `public`, `demo` and what each disables |
| `docs/FRONTEND/04` | Per-Section Error Boundary | Each section isolated — **deferred to `P2-04`**, which is its own card |
| `docs/PLAN/07` | Backward Compatibility | A breaking redesign is a **new component name**, never an edit |
| `docs/PLAN/07` | Required vs Optional | An absent optional field leaves no empty box |
| `docs/PLAN/08` | The whole document | The canonical data shape the dot-notation resolves against |
| `docs/PLAN/18` | R5 | Mitigation: a stored template naming a component that no longer exists |
| `CLAUDE.md` | Non-negotiables | No template-specific logic; no per-template components |

**No disagreement found** between these. `docs/FRONTEND/04` names the error boundary in
the renderer while `TASKS` gives it its own card (`P2-04`); that is sequencing, not
conflict, and the renderer is built so the boundary wraps each section without a
structural change.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| — | Templates are data, not code | `check-no-template-branching.mjs`, a new build guard |
| BR-3.1 | An invitation renders the version it locked | Not here — the renderer receives a version, it does not choose one (`P2-07`) |
| BR-4.1 | Changing template never deletes data | Not here — `P1-15`. The renderer only decides what is *displayed* |

## 4. API Contract

None. **The renderer makes no network call**, which is the property that lets the same
component tree run under SSR, inside the editor against unsaved local state, and on the
catalogue demo against dummy data. All three callers pass data as props.

```tsx
<TemplateRenderer
  templateVersion={{ sections, theme, customizable_theme_keys }}
  invitationData={/* docs/PLAN/08 shape */}
  enabledSections={["hero", "gallery"]}
  themeOverride={{ "colors.primary": "#b76e79" }}
  mode="live" | "public" | "demo"
/>
```

`enabledSections` and `themeOverride` come from `invitation_settings` and are passed
separately rather than nested inside `invitationData`, because `docs/PLAN/08` § Where
Settings Fields Physically Live keeps them in a different table and `P1-14` already treats
them as a separate concern.

## 5. Data Model Impact

None. No table is read or written by this package; it receives already-fetched data.
Migration required: **no**.

## 6. Authorization

**None, and this is deliberate rather than an omission.** The renderer is a pure function
of its props. Every authorization decision happens before its caller has data to pass:
`P2-07`'s public API decides what a guest may see, and `P1-10`'s owner-scoped reads decide
what the editor may see.

The one thing this package must not do is make that decision *look* like it happens here.
It therefore has no concept of a user, a session or an owner, and nothing in it should
gain one — a renderer that filtered by viewer would be a second authorization layer that
the first would eventually be trusted to have done.

## 7. Validation and Sanitization

- **Structural validation**: none at runtime. `template_versions.sections` is validated by
  `P0-20` before it is ever written, so by the time it reaches the renderer it is a shape
  the validator accepted.
- **Sanitization**: none, and deliberately. `P1-16` sanitizes on the way **in**; text
  arriving here is already stored-safe. Sanitizing again would (a) suggest the server's
  sanitiser is optional and (b) alter text that was legitimately stored — the same
  reasoning `P1-23` recorded for the editor's client-side validation.
- **What the renderer must never do**: `dangerouslySetInnerHTML`. Every value is rendered
  as text by React, which escapes it. That is the property a build guard should protect,
  because a single such call anywhere in this package makes `P1-16` load-bearing in a way
  it was never meant to be.

## 8. State Transitions

None.

## 9. Side Effects

None in the core. `mode` decides whether the *sections* may have any:

| Mode | Data source | Submissions | View counter |
|---|---|---|---|
| `live` | local editor state, possibly unsaved | disabled | off |
| `public` | the public API | active | on |
| `demo` | dummy data from the template | inert handlers | off |

The core does not implement submissions or counting; it passes `mode` down so `P2-03`'s
components and Phase 4's wiring can. What the core **does** own is that a section can
never accidentally submit in `live` or `demo` — the prop is required, not defaulted.

## 10. Failure Modes

| Failure | Behaviour | Reasoning |
|---|---|---|
| A section names a component not in the registry | Render nothing for that section, report it | A stored template naming a removed component is `docs/PLAN/18` R5. Crashing the page for one bad section is the outcome `P2-04` exists to prevent, and the core should not produce it in the first place |
| A required field is missing from the data | Render the section with what exists | Absent data is the normal state of a draft being edited. The **publish check** (`P2-06`) is where incompleteness is refused; a preview that crashed on an empty field would make the editor unusable |
| An optional field is absent | Render no element for it at all | `docs/PLAN/07` § Required vs Optional — no empty box |
| A section is absent from `enabled_sections` | **Not in the DOM** | Card DoD: "a hidden section is still a data leak in the page source" |
| `configurable: false` and absent from `enabled_sections` | Rendered anyway | `docs/FRONTEND/04` step 2's explicit exception |

Fail **open** in every case here, and that is not in tension with `docs/SECURITY/00`'s
fail-closed principle: nothing in this package is a security control. The security
decision is which data the caller was given.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| A disabled section's data is read from the page source | Card DoD | The section is absent from the DOM entirely | `"a disabled section is absent from the DOM, not hidden"` |
| A stored template names a component that was deleted | `docs/PLAN/18` R5 | The section is skipped, the rest renders, and CI fails for the stored definition | `"skips a section whose component is not registered"` + the parity guard |
| Text containing markup renders as HTML | `docs/SECURITY/08` | Rendered as text; React escapes it | `"renders markup in a name as text, never as HTML"` |
| A `theme_override` key the template does not permit | `P1-14` | Ignored by the renderer | `"ignores a theme override the template does not list as customizable"` |
| A theme value containing a CSS injection payload | — | Emitted as a custom property value only; no expression is possible | `"a theme value cannot break out of the custom property"` |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit | The five render-flow steps; the `configurable: false` exception; dot-notation resolution including `events.*` collections; theme merge and override filtering; mode propagation; unregistered component handling; absent optional fields |
| Integration | **The reference template with the demo invitation renders every enabled section, in order** — the card's DoD, using the same seed fixtures `P0-21` proved complete |
| Parity | Every name in `@wi/schema`'s `COMPONENT_REGISTRY` has a component here, and every component here is named there — the test ADR-037 owes |
| Guard | No template identifier in a conditional anywhere in the package; no `dangerouslySetInnerHTML` |

## 13. Observability

Nothing is logged from the renderer — it runs in a browser and under SSR, and a logger
here would be a second logging path outside `@wi/logging`'s redaction.

An unregistered component is surfaced through a callback the caller may supply
(`onSectionError`), so `public-invite` can log it server-side in `P2-08` and the editor can
show it in `P2-05`. The renderer decides nothing about where that goes.

## 14. Open Questions

- **`docs/FRONTEND/04` shows `COMPONENT_REGISTRY` in the renderer, and `@wi/schema`
  already has one of the same name** mapping component → section key. They are two
  different maps with one name. Resolution: `@wi/schema`'s stays the vocabulary the API
  validates against; this package's maps the same names to React components, and a parity
  test asserts the two agree. This is what ADR-037 anticipated and is recorded again in
  this card's ADR.
- **Section components do not exist yet** (`P2-03`). The core is built and tested against
  minimal stand-in components registered under the real names, replaced in `P2-03`. That
  is stated here so a reader of the parity test does not mistake the stand-ins for the
  finished library.
