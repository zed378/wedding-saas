# P5-04 — Feature Spec: Template and Version Management API

| | |
|---|---|
| **Task** | `P5-04` |
| **Date** | 2026-10-19 |
| **Author** | Agent |
| **Status** | Reviewed |

---

## 1. Goal

Implement the complete administrative template and version management API (`/api/v1/admin/templates/*`), enabling platform administrators to create, configure, version, validate, publish, deprecate, and delete digital wedding invitation templates dynamically through the API without requiring code changes or application redeployments.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/03-TEMPLATE-API.md` | § Admin | Specification for `POST /admin/templates`, `PATCH /admin/templates/:id`, `POST /admin/templates/:id/versions`, `PATCH /admin/templates/:id/versions/:vid`, `POST /admin/templates/:id/versions/:vid/publish`, `POST /admin/templates/:id/versions/:vid/deprecate`, `DELETE /admin/templates/:id` |
| `docs/PLAN/07-TEMPLATE-SYSTEM.md` | § Entire document | Templates are data, not code. Section & theme definitions; version lifecycle (draft -> published -> deprecated); generic rendering principles |
| `docs/PLAN/02-BUSINESS-RULES.md` | § BR-3 | BR-3.1 (version immutability & invitation pinning), BR-3.2 (explicit version upgrade), BR-3.3 (deprecated version retention & catalog omission) |
| `docs/DATABASE/03-TEMPLATES.md` | § Schema Validation | Sections and theme validation against `@wi/schema` (`validateTemplateVersion`) before saving to database |
| `docs/DATABASE/01-TEMPLATE-CATALOG.md` | § Referential Integrity | `ON DELETE RESTRICT` backstop; refusal when referenced by invitations |
| `docs/API/09-ADMIN-API.md` | § Principles | Role authorization (`admin`, `super_admin`), mandatory `reason` on writes, audit log recording |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-3.1 | An invitation references a specific `template_id` + `template_version_id`. Published versions are strictly immutable. | `AdminTemplateService`: updates rejected if version status is `published` or `deprecated` |
| BR-3.3 | Deprecated templates/versions remain renderable for existing invitations, but are removed from public catalog. | `TemplateRepository`, status transitions in `AdminTemplateService`, cache invalidation |
| BR-Admin.3 | Admin write operations require a non-empty `reason` (5-500 chars). | `adminActionReasonSchema`, `AdminTemplateController` |
| BR-Admin.4 | Every administrative mutation generates an `audit_logs` record in the same database transaction. | `AuditLogService.record(tx, entry)` |
| BR-Integrity | A template referenced by any invitation cannot be deleted. | Pre-delete check in `AdminTemplateService` returning 409 conflict |

## 4. API Contract & Schemas

### Routes
```http
GET    /api/v1/admin/templates                           List all templates (including drafts and deprecated)
GET    /api/v1/admin/templates/:id                       Get template detail with all versions
POST   /api/v1/admin/templates                           Create new template (status: draft)
PATCH  /api/v1/admin/templates/:id                       Update template metadata
DELETE /api/v1/admin/templates/:id                       Delete template (if never used)
POST   /api/v1/admin/templates/:id/versions             Create new version (status: draft)
PATCH  /api/v1/admin/templates/:id/versions/:vid         Update version definition (sections, theme, customizable_keys)
POST   /api/v1/admin/templates/:id/versions/:vid/publish Publish version and invalidate catalog cache
POST   /api/v1/admin/templates/:id/versions/:vid/deprecate Deprecate version and invalidate catalog cache
```

### Schemas
- `createTemplateSchema`: `slug` (3-80 chars, lowercase slug), `name` (1-100 chars), `category` (optional string array), `is_premium` (boolean, default false), `thumbnail_url` (optional url), `reason` (min 5, max 500).
- `updateTemplateSchema`: `name`, `category`, `is_premium`, `thumbnail_url`, `status` (`draft` | `published` | `deprecated`), `reason` (min 5, max 500).
- `createVersionSchema`: `version` (semver e.g. `1.0.0`), `sections` (array of section definitions), `theme` (object), `customizable_theme_keys` (optional string array), `changelog` (optional string), `reason` (min 5, max 500).
- `updateVersionSchema`: `sections` (optional), `theme` (optional), `customizable_theme_keys` (optional), `changelog` (optional), `reason` (min 5, max 500).
- `versionActionSchema`: `reason` (min 5, max 500).
- `deleteTemplateSchema`: `reason` (min 5, max 500).

## 5. Validation Architecture

All version writes (`createVersion` and `updateVersion`) MUST invoke `validateTemplateVersion` from `@wi/schema`:
- Verifies that section definitions match known component names and valid field paths.
- Verifies that theme tokens match theme schema constraints.
- Verifies that `customizable_theme_keys` resolve to existing values in `theme`.
- Returns comprehensive 400 `VALIDATION_ERROR` with path details if any check fails.

## 6. Version Lifecycle & Immutability

1. `draft`: Editable via `PATCH`. Not visible in public catalog.
2. `published`: Immutable! Any `PATCH` is rejected with 409 `VERSION_IMMUTABLE`. Visible in public catalog for new invitations.
3. `deprecated`: Immutable! Removed from public catalog (`GET /templates`), but remains renderable for existing locked invitations.

## 7. Cache Invalidation

Publishing (`/publish`) or deprecating (`/deprecate`) a version triggers `templateService.invalidate()`, bumping the `tpl` cache namespace generation counter in Redis so stale catalog responses are cleared immediately.

## 8. Audit Logging

Every mutation creates an `audit_logs` record inside the same transaction with:
- `actor_id`: admin user ID
- `action`: `template.create`, `template.update`, `template.delete`, `template_version.create`, `template_version.update`, `template_version.publish`, `template_version.deprecate`
- `resource_type`: `template` or `template_version`
- `resource_id`: template or version UUID
- `reason`: mandatory string from request
- `diff`: `{ before, after }` state capture

## 9. Test Plan

- Unit & HTTP tests (`admin-templates.spec.ts`):
  - Admin authentication and role requirements (`admin`, `super_admin`).
  - Template creation and slug uniqueness.
  - Template metadata update with audit recording.
  - Draft version creation with valid and invalid section definitions (checking structured error response).
  - Version update and immutability rejection on published versions.
  - Publishing a version (sets `released_at`, status `published`, invalidates cache).
  - Deprecating a version (hides from catalog, retains existing render).
  - Refusal to delete a template referenced by an invitation (409 conflict).
  - Successful deletion of an unused template and versions.
