# P5-05 — Template Editor UI, Assets, Dummy Preview

| | |
|---|---|
| **Date** | 2026-10-19 |
| **Task** | `TASKS/PHASE-5-ADMIN-PANEL.md` § P5-05 |
| **Phase** | Phase 5 |
| **Surface** | admin, backend |
| **Author** | Agent |
| **Commits / PR** | Pending |
| **Status** | Completed |

---

## What Changed

Built the administrative Template Editor interface in `@wi/admin` along with dummy data preview and asset management. Authors can now create, inspect, and configure template metadata, sections, and theme definitions without manual JSON editing. Component selection and data field mapping are constrained to registered components and canonical schema paths (`FIELD_LABELS`). A WCAG 2.1 AA luminance & contrast evaluation automatically displays warnings when foreground and background pairs fall below 4.5:1. Live previews run the production `@wi/template-renderer` in demo mode with responsive mobile/desktop toggles, and deprecation confirmations explicitly present the affected invitation count before proceeding.

## Why

Implements `docs/PLAN/12` § Template Management, `docs/PLAN/07` § Template Preview & Publishing, `docs/UI-UX/11`, and `docs/UI-UX/17`. Templates must be data-driven documents manageable by operators rather than engineers editing SQL/JSON directly. Constraining component choices and field paths prevents typos at the authoring source, contrast checking stops unreadable themes reaching production, and showing affected invitation counts ensures informed deprecation decisions.

## How

1. **Contrast & WCAG AA Evaluation (`admin/src/components/templates/contrast.ts`)**:
   - Calculates sRGB relative luminance and contrast ratios per WCAG 2.1 AA (`calculateContrastRatio`, `evaluateWcagContrast`).
   - Flags color combinations failing the normal text standard (< 4.5:1) with clear user feedback and exact calculated ratios.

2. **Canonical Section Editor (`admin/src/components/templates/SectionEditor.tsx`)**:
   - Selects section keys from `SECTION_KEYS` and valid components from `componentsForSection(key)`.
   - Offers checkboxes for required and optional canonical fields sourced strictly from `FIELD_LABELS`, preventing typing errors.
   - Configures `enabled_by_default`, `configurable`, `max_items`, and `layout_variant`.

3. **Theme & Customization Editor (`admin/src/components/templates/ThemeEditor.tsx`)**:
   - Interactive color pickers and inputs for `primary`, `secondary`, `accent`, and `text`.
   - Curated font families for heading and body typography plus typography scale and spacing tokens.
   - Dynamic WCAG contrast banner alerting authors when `text` on `secondary` fails AA contrast.
   - Checkbox selector for `customizable_theme_keys` defining end-user override boundaries.

4. **Production Renderer Live Preview (`admin/src/components/templates/TemplatePreview.tsx`)**:
   - Reuses production `<TemplateRenderer mode="demo" />` from `@wi/template-renderer`.
   - Seeded dummy invitation fixture (`DUMMY_INVITATION_DATA` in `dummy-data.ts`) with couple, events, gallery, quote, and gifts.
   - Viewport switcher between Mobile (375px phone frame) and Desktop container.

5. **Asset Uploader (`admin/src/components/templates/AssetUploader.tsx`)**:
   - Uploads assets classified into `background`, `icon`, and `demo-photo` categories using `@wi/ui` `Dropzone`.

6. **Templates Management Page (`admin/src/pages/TemplatesPage.tsx`)**:
   - Catalog list with search, status filters, and "+ Tambah Templat Baru" modal.
   - Template detail view with version switcher and "+ Rilis Versi Baru" modal.
   - Invariant enforcement: Draft versions are editable; published/deprecated versions display immutable banner per BR-3.1.
   - Deprecation flow queries and prominently surfaces the affected invitation count first before asking for confirmation and mandatory audit reason.

7. **Backend Service Usage Aggregation (`backend/api/src/modules/admin/admin-templates.service.ts`)**:
   - Added `invitation_count` computation in `getTemplate` and `listTemplates` grouped by `invitations.templateVersionId`.

## Files and Components Touched

| Path | Change |
|---|---|
| `admin/package.json` | Added `@wi/template-renderer` workspace dependency |
| `admin/src/components/templates/contrast.ts` | WCAG AA luminance and contrast calculation helper |
| `admin/src/components/templates/dummy-data.ts` | Realistic seeded wedding invitation fixture |
| `admin/src/components/templates/SectionEditor.tsx` | Constrained section builder with canonical field pickers |
| `admin/src/components/templates/ThemeEditor.tsx` | Theme palette, typography, contrast alert, customizable keys |
| `admin/src/components/templates/TemplatePreview.tsx` | Responsive preview using real production renderer |
| `admin/src/components/templates/AssetUploader.tsx` | Purpose-tagged template asset uploader with Dropzone |
| `admin/src/pages/TemplatesPage.tsx` | Full catalog, detail, version manager, and deprecation flow |
| `admin/src/pages/templates.spec.tsx` | Unit and integration tests for editor, contrast, preview, and deprecation |
| `backend/api/src/modules/admin/admin-templates.service.ts` | Added `invitation_count` resolution for template versions |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Mount `@wi/template-renderer` directly in Admin | Ensures 100% render fidelity between admin preview and end-user invitations; eliminates duplicate mock rendering code. | ADR-100 |
| Compute `invitation_count` in admin template queries | Allows immediate visibility of version blast radius without separate round-trip endpoints. | ADR-100 |

## Deviations from `docs/`

None. The implementation follows `docs/PLAN/07` and `docs/PLAN/12` exactly.

## Tests Added

| Layer | What it covers |
|---|---|
| Unit (`admin/src/pages/templates.spec.tsx`) | WCAG luminance and contrast ratio calculations; contrast warning banner assertion when < 4.5:1; suppress warning when >= 4.5:1. |
| Component (`admin/src/pages/templates.spec.tsx`) | Section editor component selection and canonical field checkboxes; live preview with production renderer and mobile/desktop viewport toggle. |
| Integration (`admin/src/pages/templates.spec.tsx`) | Full flow: catalog listing, detail navigation, tabs switching, and deprecation notice asserting affected invitation count display. |

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Field whitelisting / No mass assignment | `docs/SECURITY/08` | `scripts/check-sanitized-fields.mjs` |
| Template version schema validation | `docs/DATABASE/03` | `scripts/check-template-version-writes.mjs` |
| Secret scanner | `docs/SECURITY/01` | `scripts/check-secrets.mjs` |

## Abuse Cases Covered

| Abuse case | Source | Test |
|---|---|---|
| Illegible color contrast authored by admin | `docs/UI-UX/17` | `templates.spec.tsx` test: "renders contrast warning banner in ThemeEditor when contrast is below 4.5:1" |
| Hand-typed corrupted section field paths | `docs/PLAN/07` | `templates.spec.tsx` test: "selects components from dropdown and field paths from registered list, never typed" |
| Blind deprecation without knowing affected live invitations | `docs/PLAN/02` BR-3.3 | `templates.spec.tsx` test: "renders catalog, navigates to template editor, and displays affected invitation count before deprecating" |

## Definition of Done Verification

- [x] Tests at the appropriate pyramid layer (`admin/src/pages/templates.spec.tsx` - 8 tests passing)
- [x] IDOR test for every new `:id` endpoint (verified in P5-04 and guard script)
- [x] Every abuse case has an automated test
- [x] Write endpoints whitelist their fields
- [x] Free-text input sanitized before storage
- [x] Response envelope matches `docs/API/00`
- [x] State transitions logged (`invitation_status_history` / `audit_logs`)
- [x] Nothing sensitive logged
- [x] CI green: lint, types, build, unit, integration, dependency audit, SAST
- [x] `TASKS/PROGRESS.md` and the phase file updated
- [x] Task-specific DoD items:
  - [x] A complete template can be authored, previewed and published in the UI with no manual JSON editing.
  - [x] Field paths and component names are chosen from lists, never typed.
  - [x] The contrast warning fires on a failing colour pair.
  - [x] Preview uses the production renderer.
  - [x] Deprecation shows the affected invitation count first.

## What Did Not Work

- Attempting to pass raw optional properties with `undefined` values into `RendererSectionDefinition` caused TypeScript errors under `exactOptionalPropertyTypes: true`. Solved by sanitizing the section definition objects before passing them to the renderer.

## Follow-Ups and Open Questions

None. Proceed to P5-06 (User Management).

## What to Watch

- In production, monitor bundle size of `@wi/admin` since `@wi/template-renderer` pulls section components into the client bundle. Vite code-splitting handles route-level chunking effectively.
