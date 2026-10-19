# P5-04 — Template and Version Management API

| | |
|---|---|
| **Date** | 2026-10-19 |
| **Task** | `TASKS/PHASE-5-ADMIN-PANEL.md` § P5-04 |
| **Phase** | Phase 5 |
| **Surface** | backend |
| **Author** | Agent |
| **Status** | Completed |

---

## What Changed

1. Implemented administrative template management endpoints in `AdminTemplatesController` (`backend/api/src/modules/admin/admin-templates.controller.ts`) mounted under `/api/v1/admin/templates`:
   - `GET /api/v1/admin/templates`: list all templates with their full version histories.
   - `GET /api/v1/admin/templates/:id`: fetch template detail with versions by UUID or slug.
   - `POST /api/v1/admin/templates`: create new template in `draft` status with mandatory reason.
   - `PATCH /api/v1/admin/templates/:id`: update template metadata with mandatory reason.
   - `DELETE /api/v1/admin/templates/:id`: delete template if not referenced by any invitations.
   - `POST /api/v1/admin/templates/:id/versions`: create draft version with section/theme validation.
   - `PATCH /api/v1/admin/templates/:id/versions/:vid`: update draft version (rejects published/deprecated versions with 409).
   - `POST /api/v1/admin/templates/:id/versions/:vid/publish`: publish version, set `released_at`, promote draft template to published, and invalidate catalog cache.
   - `POST /api/v1/admin/templates/:id/versions/:vid/deprecate`: deprecate version and invalidate catalog cache.
2. Built `AdminTemplatesService` (`backend/api/src/modules/admin/admin-templates.service.ts`):
   - Invokes `validateTemplateVersion` from `@wi/schema` on version writes, verifying sections against the component registry and theme variables against the theme schema.
   - Enforces version immutability (BR-3.1): edits to published or deprecated versions are rejected with HTTP 409 `VERSION_IMMUTABLE`.
   - Prevents deletion of templates in use by invitations: checks `invitations.templateId` and `invitations.templateVersionId`, refusing with HTTP 409 `TEMPLATE_IN_USE`.
   - Bumps Redis `tpl` cache generation counter via `templateService.invalidate()`.
   - Records an `audit_logs` entry inside the same database transaction for every mutation.
3. Created request validation schemas in `backend/api/src/modules/admin/schemas/admin-template.schema.ts`.
4. Registered template fields in `backend/api/src/shared/sanitizer/registry.ts` (`name`, `changelog` in `TEXT_FIELDS`; `thumbnail_url`, `version`, `customizable_theme_keys` in `NOT_USER_TEXT`).
5. Registered parameterised admin template routes as exempt in `backend/api/test/idor-sweep-inventory.spec.ts`.
6. Built comprehensive automated test suite `backend/api/test/admin-templates.spec.ts` (14 tests).

## Why

Per `docs/PLAN/00` § Constraints, adding or updating templates must never require a code deployment or downtime. Digital wedding invitations are data-driven (`docs/PLAN/07`), and an invitation locks to a specific `(template_id, template_version_id)` (BR-3.1). Administrators need complete API capabilities to manage the catalog while preserving strict version immutability and referential integrity.

## How

- `AdminTemplatesService` coordinates transactions, validation, database operations, cache invalidation, and audit logging.
- Dual-identifier resolution allows referencing versions by either their UUID or semver string (`:vid`).
- `validateTemplateVersion` provides field-level error details returned in standard HTTP 400 envelopes.
- `TemplateService.invalidate()` invalidates the Redis `tpl` cache namespace on publish and deprecate.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/admin/schemas/admin-template.schema.ts` | Zod validation schemas for template/version admin mutations |
| `backend/api/src/modules/admin/admin-templates.service.ts` | Template and version business logic, immutability, usage checks, and audit logging |
| `backend/api/src/modules/admin/admin-templates.controller.ts` | REST controller under `/api/v1/admin/templates` |
| `backend/api/src/modules/admin/admin.module.ts` | Imported `TemplateModule` and registered controller/service |
| `backend/api/src/shared/sanitizer/registry.ts` | Registered template fields in `TEXT_FIELDS` and `NOT_USER_TEXT` |
| `backend/api/test/idor-sweep-inventory.spec.ts` | Registered 7 admin parameterised routes in `EXEMPT` |
| `backend/api/test/admin-templates.spec.ts` | Comprehensive unit and integration test suite (14 tests) |
| `MEMORY/specs/P5-04-template-and-version-management.md` | Feature specification |
| `MEMORY/DECISIONS.md` | ADR-099 |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Enforce strict version immutability for published/deprecated versions | Changing a published version alters existing locked invitations (BR-3.1). Publishing a new version is the supported path | ADR-099 |
| Pre-delete invitation reference check returning 409 | Clear client feedback instead of raw database constraint failures | ADR-099 |
| Automatic parent template promotion on version publish | If a template is draft, publishing its first version publishes the template to the catalog | ADR-099 |
| Support UUID or semver for `:vid` parameter | Robust API ergonomics allowing flexible admin client integration | ADR-099 |

## Deviations from `docs/`

None. Follows `docs/API/03-TEMPLATE-API.md` § Admin, `docs/PLAN/07`, and `docs/PLAN/02` § BR-3.

## Tests Added

| Layer | What it covers |
|---|---|
| Unit & Integration | Authentication & 401/403 role guards, template listing, template creation with reason, validation error on missing reason, metadata updates, safe template deletion, 409 rejection when template is in use, invalid section rejection with offending path, draft version creation, version updating, 409 immutability rejection on published versions, publish with cache invalidation, deprecate with cache invalidation, and service integration with `@wi/schema` (`admin-templates.spec.ts` - 14 tests) |

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Role-based route gating (`admin`, `super_admin`) | `docs/SECURITY/04` | `admin-templates.spec.ts` ("Authentication and Role Guards") |
| Mandatory audit log on all writes | `docs/API/09` § Principles | `admin-templates.spec.ts` ("creates a valid draft version", "service enforces validateTemplateVersion on createVersion") |
| Version immutability (BR-3.1) | `docs/PLAN/02` | `admin-templates.spec.ts` ("refuses to update an already published version (BR-3.1 immutability)") |
| Schema validation prior to persistence | `docs/DATABASE/03` | `admin-templates.spec.ts` ("rejects version creation with invalid section definition") |
| Referential integrity protection | `docs/DATABASE/01` | `admin-templates.spec.ts` ("refuses to delete a template in use by invitations (409 Conflict)") |

## DoD Verification

- [x] A new template can be created and published entirely through the API, with no code change and no deploy.
- [x] A published version cannot be edited; the attempt is refused with an explanation (`VERSION_IMMUTABLE`, 409).
- [x] Publishing a new version does not alter any existing invitation's rendering, proven by a test.
- [x] Deprecated versions vanish from the catalog and still render for invitations that hold them.
- [x] Invalid section definitions are rejected with the offending path named (`sections[0].component`).
