# P0-20 — Feature Spec: Template Schema Definition and Field Resolver

| | |
|---|---|
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-20 |
| **Date** | 2026-09-10 |
| **Author** | Claude Code session |
| **Status** | Implemented — see [the change record](../records/2026-09-10-P0-20-template-schema-and-resolver.md) |

---

## 1. Goal

A template version becomes machine-checkable. `sections` and `theme` get formal schemas; every field a section may reference comes from one enumerated registry; every component a section may name comes from one enumerated registry; and a single dot-notation resolver — shared by the API and all three frontends — answers "what is at this path" and "is it empty" the same way everywhere.

After this, a template definition with a typo in a field path, an unknown component, a section key nothing renders, or a `customizable_theme_keys` entry pointing at a theme key that does not exist, is **rejected at authoring time** with a message naming the offending value. Today all four fail silently at render time as an empty section.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/PLAN/07-TEMPLATE-SYSTEM.md` | Core Principles | Templates are data. No per-template backend logic, no per-template components |
| `docs/PLAN/07` | Section System | The section entry shape: `section_key`, `component`, `enabled_by_default`, `configurable`, `max_items`, `required_fields`, `optional_fields`, `layout_variant`, `layout_options`. The ten section keys |
| `docs/PLAN/07` | Required vs Optional Fields | `required_fields` blocks publish (BR-4.2); `optional_fields` may be empty; both refer to the canonical schema in `PLAN/08` — "templates do NOT define a new data structure" |
| `docs/PLAN/07` | Theme Variables | `colors`, `typography`, `spacing`, `border_radius`; users override a subset bounded by `customizable_theme_keys` |
| `docs/PLAN/07` | Backward Compatibility | A breaking component change is a **new component name**, never an edit — because old versions reference the old name |
| `docs/PLAN/07` | Template Compatibility & Migration | Switching templates maps by `section_key`. Unrecognised sections are hidden, not deleted |
| `docs/PLAN/08-INVITATION-DATA-MODEL.md` | whole document | The canonical field vocabulary. `Person`, `Event`, `Photo`, `BankAccount`, `Quote`, `Settings` |
| `docs/PLAN/08` | Design Principles | "Do not hard-code fields into the frontend" — the frontend reads the field list from the section definition |
| `docs/DATABASE/03-TEMPLATES.md` | Schema Validation | `sections` is validated against a fixed JSON Schema **in application code, not in the DB**, before being saved |
| `docs/DATABASE/03` | table definition | `customizable_theme_keys` is a **column** on `template_versions`, not a key inside `theme` |
| `docs/BACKEND/03-VALIDATION.md` | Validating Completeness for Publishing | The exact publish algorithm: skip disabled sections, resolve each `required_fields` path, collect the empty ones |
| `docs/FRONTEND/04-TEMPLATE-RENDERING.md` | Render Flow | Steps 2–5: skip by `enabled_sections` unless `configurable: false`; resolve component by name; extract data by dot path; merge theme with `theme_override` |
| `docs/API/03-TEMPLATE-API.md` | Example Response, Important Rules | The wire shape; `customizable_theme_keys: ["colors.primary"]` confirms dot paths for theme keys |
| `docs/PLAN/18-RISK-REGISTER.md` | R5 | "New template breaks old invitations because a shared component was changed" — mitigated by strict versioning and a new component for breaking changes |

**Two places where the documents differ, both resolved without amendment:**

1. `docs/PLAN/07` shows `customizable_theme_keys` in prose next to the theme block; `docs/DATABASE/03` makes it a column and `docs/API/03` returns it as a sibling of `theme`. Two of three agree and the physical schema is the tiebreak. **It is a column.** The validator therefore takes it as a third argument and cross-checks it against the theme it accompanies.

2. `docs/PLAN/07` § Section System draws `Event` with `Akad` and `Reception` nested beneath it. Those are not two sections; they are two rows of `invitation_events`, and `docs/PLAN/08` confirms an invitation has `1..N` events. **`event` is one section key** whose component renders the whole collection.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-3.1 | An invitation locks a specific `template_version_id`, not "latest" | Already enforced by `P0-09`'s schema. This task makes the locked definition self-describing enough to render years later |
| BR-3.3 | A deprecated version still renders for invitations that reference it | Consequence of the component registry being append-only — see § 7 |
| BR-4.1 | Sections the active template does not support are not displayed, but the data remains | The resolver reads from the invitation, never from the template; a path is resolvable whether or not any section references it |
| BR-4.2 | Required fields must not be empty when publishing | `collectMissingRequiredFields()` — the implementation of `docs/BACKEND/03`'s pseudocode. **Empty is defined here, once**, in § 7 |

## 4. API Contract

**This task adds no endpoint.** `docs/API/03` § Admin defines `POST/PATCH /api/v1/admin/templates/:id/versions[/:vid]`, which belong to Phase 5. What this task produces is the validator those endpoints must call, and the resolver `POST /api/v1/invitations/:id/publish` (Phase 3) must call.

The shapes below are the contract this task fixes, because `docs/API/03` § Example Response already publishes them to clients:

```jsonc
// One entry of template_versions.sections
{
  "section_key": "gallery",          // required, one of the ten
  "component": "GalleryGrid",        // required, must be registered FOR THIS section_key
  "enabled_by_default": true,        // required
  "configurable": true,              // required
  "max_items": 20,                   // optional, integer >= 1
  "required_fields": ["gallery.photos"],   // optional, default []
  "optional_fields": ["gallery.photos.*.caption"],
  "layout_variant": "grid-3col",     // optional
  "layout_options": ["grid-3col", "carousel"]  // optional
}
```

```jsonc
// template_versions.theme
{
  "colors":     { "primary": "#8B5E3C", "secondary": "#F4EDE4", "accent": "#C9A876", "text": "#2B2B2B" },
  "typography": { "heading_font": "Playfair Display", "body_font": "Lato", "scale": "default" },
  "spacing": "comfortable",
  "border_radius": "rounded"
}
```

Errors follow `docs/API/00`: `VALIDATION_ERROR`, 422, with `details[]` of `{ field, message }`. `field` is the JSON pointer into the definition (`sections[1].required_fields[0]`) and `message` names the offending value — a validator that says "invalid section" costs more time than it saves.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `template_versions` | neither, directly | This task validates what is written there. `sections` and `theme` are `JSONB`, `customizable_theme_keys` is `VARCHAR(60)[]` — all three already exist from `P0-08` |

**Migration required: no.** No column changes. The schemas describe data that the existing `JSONB` columns already hold.

## 6. Authorization

No endpoint, so no object-level authorization surface of its own. Two things it must not do:

- **The resolver must never fetch.** It takes an already-assembled invitation object and walks it. If it could load data, it would become a second data-access path with no tenant scope — exactly what `scripts/check-tenant-scope.mjs` exists to prevent. It is a pure function over a plain object, and it lives in a package with no database dependency at all, which makes that structural rather than a rule.
- **`resolvePath` must not be usable to reach outside the invitation.** A path is validated against the registry before use, and the walk refuses `__proto__`, `constructor` and `prototype` segments regardless. A template definition is admin-authored, but "the input is trusted" is the sentence that precedes most prototype-pollution advisories.

The Phase 5 admin endpoints that write template versions are admin-only and audited per `docs/SECURITY/05` § Special Case: Admin Access. That is their spec to write, not this one — but § 14 records the obligation so it is not discovered late.

## 7. Validation and Sanitization

### 7.1 The field registry

One enumerated list of canonical paths, derived from `docs/PLAN/08` and cross-checked against the columns `P0-09` actually created.

| Path | Source entity |
|---|---|
| `couple.groom.full_name`, `.nickname`, `.photo`, `.instagram`, `.father_name`, `.mother_name`, `.child_order` | `invitation_people` where `role = 'groom'` |
| `couple.bride.…` (same seven) | `invitation_people` where `role = 'bride'` |
| `events` (the collection) | `invitation_events` |
| `events.*.type`, `.title`, `.date`, `.start_time`, `.end_time`, `.venue_name`, `.address`, `.latitude`, `.longitude`, `.maps_url`, `.description` | `invitation_events` |
| `gallery.photos` (the collection) | `invitation_gallery` |
| `gallery.photos.*.media_id`, `.caption`, `.order`, `.is_cover` | `invitation_gallery` |
| `gift.accounts` (the collection) | `invitation_bank_accounts` |
| `gift.accounts.*.type`, `.provider_name`, `.account_number`, `.account_holder`, `.order` | `invitation_bank_accounts` |
| `quote.text`, `quote.source` | `invitation_quote` |

**Not in the registry, deliberately:** anything under `settings`. A template selects *content*; `enabled_sections`, `slug`, `theme_override` and the toggles are how the invitation configures the template, and letting a template declare `settings.slug` as a required field would invert that. The renderer reads `enabled_sections` directly (`docs/FRONTEND/04` step 2), not through this resolver.

**Also not in the registry:** RSVP and guestbook entries. They are guest-submitted, so a template cannot require them to be non-empty before publish — that would make publishing impossible by construction.

### 7.2 The component registry

A closed map from component name to the one `section_key` it renders:

| `section_key` | Components |
|---|---|
| `hero` | `HeroClassic` |
| `couple` | `CoupleProfile` |
| `quote` | `QuoteBanner` |
| `event` | `EventCardDouble` |
| `gallery` | `GalleryGrid`, `GalleryCarousel` |
| `maps` | `MapsStatic` |
| `gift` | `GiftAccountList` |
| `rsvp` | `RsvpForm` |
| `guestbook` | `GuestbookWall` |
| `closing` | `ClosingSimple` |

Binding each component to a section key is stricter than `docs/PLAN/07` asks for, and it is free: `{ "section_key": "gallery", "component": "HeroClassic" }` is a definition that passes a name-only check and renders a hero where a gallery belongs.

**The registry is append-only.** `docs/PLAN/07` § Backward Compatibility requires a breaking component change to ship as a new name (`GalleryGridV2`), because template versions already in the database reference the old one. Removing a name from this list breaks every invitation locked to a version that uses it — which is R5 in `docs/PLAN/18`, stated as a mechanism rather than a hope.

### 7.3 Section entry rules

Beyond the shape:

- `required_fields` and `optional_fields` entries must be in the registry. A path not in it is rejected **naming the path** (DoD item 1).
- A field path may not appear in both `required_fields` and `optional_fields` of the same section.
- `component` must be registered for that `section_key` (DoD item 2).
- `configurable: false` with `enabled_by_default: false` is rejected. `docs/FRONTEND/04` step 2 renders a non-configurable section unconditionally, so the two together describe a section that is both always-on and off by default.
- `layout_variant`, when both are present, must appear in `layout_options`.
- `layout_options` must not contain duplicates and must have at least two entries — one option is not a choice, and the user-facing control would be a dropdown with a single item.
- `section_key` must be unique across the array. Two entries with the same key make `enabled_sections` ambiguous and template switching non-deterministic.
- `max_items` is an integer ≥ 1.

### 7.4 Theme rules

- `colors.*` must be `#rrggbb` or `#rgb`. All four keys required — a component reading `var(--color-accent)` on a template that omitted `accent` renders invisible text, and the failure appears only on the one section that used it.
- `typography.heading_font` and `body_font` are non-empty strings; `scale` is one of `compact | default | large`.
- `spacing` is one of `compact | comfortable | spacious` (`docs/PLAN/07` names all three).
- `border_radius` is one of `none | subtle | rounded | full`. **`docs/PLAN/07` gives only the example value `"rounded"`** — the enumeration is a decision this task makes, recorded as an open question in `TASKS/BACKLOG.md` and as an ADR, because the value is stored data and widening it later is cheap while narrowing it is a migration.
- Every entry of `customizable_theme_keys` must be a dot path that resolves inside the accompanying `theme` (`colors.primary`, `typography.heading_font`). A key naming something that does not exist means the editor offers a control that changes nothing.
- `spacing` and `border_radius` are legitimate entries in `customizable_theme_keys` — they are theme keys like any other. The only restriction is the one above: an entry must resolve inside the accompanying `theme`.

### 7.5 Sanitization

Nothing in a template definition is free text from an end user — these are admin-authored documents. Font names and layout variant strings are echoed into CSS by the renderer, which is `P2`'s concern; this task constrains them to a character class (`[A-Za-z0-9 _-]` for layout variants and scale/spacing values, and a length cap for font names) so that a definition cannot carry a CSS injection payload waiting for a renderer that interpolates carelessly.

### 7.6 Emptiness — the definition BR-4.2 depends on

`isEmpty(value)` is true when the value is:

| Value | Empty? | Why |
|---|---|---|
| `null`, `undefined` | yes | DoD item 4 |
| `""` | yes | DoD item 4 |
| `"   "` (whitespace only) | yes | A name of three spaces is not a name, and it survives HTML sanitization |
| `[]` | yes | DoD item 4 |
| `{}` | yes | An empty object carries no field either |
| `0` | **no** | A legitimate `order` value |
| `false` | **no** | A legitimate `is_cover` value |
| `"0"` | **no** | A string with content |

For a **wildcard** path (`events.*.date`), the result is missing when the collection is empty **or any element's value is empty**. Fail closed: two events where one has no date is not a publishable invitation, and the alternative reading — "some event has a date, good enough" — publishes a page with a blank event card.

## 8. State Transitions

None. This task writes no status. It supplies `collectMissingRequiredFields()` to the publish transition (Phase 3), which is where `draft → published` is decided and where `InvitationStatusService` (P0-14) writes the history row.

## 9. Side Effects

None. Every export is a pure function. No I/O, no queue, no cache, no clock.

That is a property worth keeping: it is why the same code can run in the editor's keystroke-level validation, in the API's publish check, and in the server-rendered public page without three behaviours.

## 10. Failure Modes

Nothing here can be "down". The failure modes are of the validator's own construction:

- **A definition already in the database that the validator would now reject.** Possible whenever the schema tightens. The reference template (`P0-21`) is the only definition that will exist when this lands, and it is authored against this schema. From Phase 5 onward, a tightening needs a check over stored rows in the same change — recorded in § 14.
- **The resolver receiving a shape it did not expect** — an invitation object assembled differently, an array where an object was expected. It returns `undefined` rather than throwing, and `undefined` is empty, so publish blocks. Fail closed: a resolver that throws takes the whole publish request down with a 500 and tells the user nothing.
- **A path that is valid in the registry but absent from the invitation object** — for example `quote.text` when the invitation has no quote row. `undefined` → empty → publish blocks if required. Correct.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| A definition sets `required_fields: ["__proto__.polluted"]` | prototype pollution, `docs/SECURITY/08` | Rejected by the registry check; and independently, the walk refuses the segment | "refuses `__proto__`, `constructor` and `prototype` segments" |
| A definition names a component that does not exist, so the section silently renders nothing | R5, `docs/PLAN/18` | Rejected naming the component | "rejects a component no renderer provides" |
| A definition names a real component under the wrong section key | R5 | Rejected naming both | "rejects a component registered for a different section" |
| A definition sets `layout_variant` to a CSS payload | stored XSS via the renderer, `docs/SECURITY/08` | Rejected by the character class | "rejects a layout variant outside the safe character class" |
| A path typo (`couple.groom.nickmame`) ships and every invitation using the template shows a blank hero | `docs/PLAN/08` § Design Principles | Rejected naming the path | "rejects an unknown field path, naming it" |
| `customizable_theme_keys` names a key absent from `theme`, so the editor shows a control that does nothing | `docs/API/03` | Rejected naming the key | "rejects a customizable theme key that does not resolve" |
| An invitation with one of two events missing a date is published | BR-4.2 | `collectMissingRequiredFields` reports `events.*.date` | "a wildcard path is missing when any element is empty" |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit — registry | every registry path is unique; every path's shape is reachable in a realistic invitation object; the component registry has no name bound to two section keys |
| Unit — section validation | valid definition accepted; unknown field path rejected naming it; unknown component; component under the wrong section; duplicate `section_key`; a field in both required and optional; `configurable:false` + `enabled_by_default:false`; `layout_variant` absent from `layout_options`; single-entry `layout_options`; `max_items: 0` |
| Unit — theme validation | valid theme accepted; missing colour key; malformed hex; unknown `spacing`; unknown `border_radius`; `customizable_theme_keys` entry that does not resolve; entry that does |
| Unit — resolver | present; absent; nested absent parent; empty string; whitespace string; empty array; empty object; `0`; `false`; wildcard over multiple events; wildcard over an empty collection; wildcard where one element is empty; a path into a section the user disabled (resolves normally — BR-4.1); `__proto__` refused |
| Unit — publish completeness | the `docs/BACKEND/03` algorithm end to end: a complete invitation reports nothing; an incomplete one reports exactly the missing paths; a **disabled** section's required fields are not reported; a **non-configurable** section's required fields **are** reported even when absent from `enabled_sections` |
| Integration | none needed — no I/O. Stated rather than skipped silently |
| Security | the abuse-case table above, one test each |
| Mutation | after the suite passes: delete the registry check, delete the component-section binding, and change `isEmpty` to ignore whitespace. Each must fail a named test |

## 13. Observability

Nothing to log at runtime — these functions run inside request handlers that already log. Two things worth surfacing when the callers arrive:

- The publish endpoint (Phase 3) should log the **count** of missing fields and their **paths**. Paths are field names, not values; they carry no personal data and they are what turns "users cannot publish" into a specific fix.
- The Phase 5 admin endpoints should log a rejected template definition with the failing pointer, at `warn`. An admin fighting an opaque validator is a support ticket.

Neither is logged here. Recorded so the callers do not have to rediscover it.

## 14. Open Questions

- **`border_radius`'s value set is invented.** `docs/PLAN/07` shows only `"rounded"`. Going into `TASKS/BACKLOG.md` as an open question and decided by ADR in the same change, because blocking Phase 0 on a design token vocabulary is worse than a value that is cheap to widen. Same for `typography.scale`, where the document shows only `"default"`.
- **Nothing enforces "validate before any write" yet**, because no write path exists — the only writers in Phase 0 are the seed and the test factories. `docs/DATABASE/03` § Schema Validation requires it before saving. A build guard refusing an unvalidated insert/update of `template_versions` is the mechanism this repository uses for exactly this shape of obligation, and it is in scope for this task.
- **A future tightening of the schema can invalidate stored definitions.** From Phase 5 there will be admin-authored versions in the database. Any change to this schema needs a sweep over stored rows in the same change. There is no mechanism for that yet and inventing one now would be speculative.
- **The component registry is a name list with no implementations.** `packages/template-renderer` is `P0-22`/Phase 2 work. Until it exists, nothing proves the names match real components. The parity test belongs in that package, and the obligation is recorded there rather than assumed.
