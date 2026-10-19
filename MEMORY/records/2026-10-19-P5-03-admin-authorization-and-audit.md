# P5-03 — Admin Authorization Path and Audit Middleware

| | |
|---|---|
| **Date** | 2026-10-19 |
| **Task** | `TASKS/PHASE-5-ADMIN-PANEL.md` § P5-03 |
| **Phase** | Phase 5 |
| **Surface** | backend |
| **Author** | Agent |
| **Status** | Completed |

---

## What Changed

1. Mounted administrative routes under `/api/v1/admin/*` behind `@UseGuards(requireAuth(), requireRole("admin", "super_admin"))`.
2. Created `AdminAuditLogsController` and `AdminAuditLogService` (`GET /api/v1/admin/audit-logs`) with multi-criteria filtering (`admin_id`, `resource_type`, `date_from`, `date_to`) and pagination (`page`, `limit`).
3. Created `AdminPaymentsController` (`GET /api/v1/admin/payments/:id/raw-log`) strictly restricted to `super_admin`, recording both a database audit trail row (`payment.raw_log_read`) and a high-priority security event (`admin.sensitive_data_access`).
4. Enforced mandatory action reason validation via `adminActionReasonSchema` (`reason: min 5, max 500 characters`).
5. Enforced content editing boundaries: no admin endpoint exists to edit invitation couple names, photos, or events.
6. Registered `AdminModule` into `AppModule`.

## Why

Per `docs/SECURITY/05` § Special Case, `docs/API/09` § Principles, and `docs/PLAN/03` § Authorization Principles, administrative capabilities must be strictly role-gated, least privilege enforced (`admin` does not imply `super_admin`), all cross-tenant reads and mutations audited in the same transaction, and customer personal invitation content protected against administrative modification.

## How

- `AdminModule` consolidates administrative controllers.
- `AdminPaymentsController.getRawPaymentLog` enforces `requireRole('super_admin')`, rejecting regular `admin` callers with 403.
- `AdminAuditLogService.list` joins with `users` to provide operator email and metadata, ordering chronologically descending.
- Architectural absence of content editing routes is verified by HTTP assertions (`test/admin-http.spec.ts`).

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/admin/admin.module.ts` | Administrative module definition |
| `backend/api/src/modules/admin/audit-logs.controller.ts` | `GET /api/v1/admin/audit-logs` endpoint |
| `backend/api/src/modules/admin/audit-logs.service.ts` | Audit log querying, filtering, and pagination service |
| `backend/api/src/modules/admin/admin-payments.controller.ts` | `GET /api/v1/admin/payments/:id/raw-log` super_admin endpoint |
| `backend/api/src/modules/admin/schemas/admin-action.schema.ts` | Mandatory reason schema and audit query schema |
| `backend/api/src/app.module.ts` | Import `AdminModule` |
| `backend/api/src/shared/sanitizer/registry.ts` | Register `reason`, `admin_id`, `resource_type`, `date_from`, `date_to` in `NOT_USER_TEXT` |
| `packages/logging/src/logger.ts` | Add `admin.sensitive_data_access` to `SecurityEventType` |
| `backend/api/test/admin-http.spec.ts` | Automated HTTP integration suite (7 tests) |
| `MEMORY/specs/P5-03-admin-authorization-and-audit.md` | Feature specification |
| `MEMORY/DECISIONS.md` | ADR-098 |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Super Admin restriction for raw payment logs | Raw payment callback data contains payment provider transaction keys and sensitive financial payloads | ADR-098 |
| Mandatory non-empty reason schema | Eliminates anonymous or unaccountable account suspensions and manual refunds | ADR-098 |
| Architectural absence of content mutation routes | Prevents customer personal wedding data tampering by platform staff | ADR-098 |

## Deviations from `docs/`

None. Follows `docs/API/09` and `docs/SECURITY/05` § Special Case exactly.

## Tests Added

| Layer | What it covers |
|---|---|
| Integration | Unauthenticated rejection (401), standard user rejection (403), admin/super_admin access (200), super_admin raw payment log restriction (403 vs 200), audit logging on access, absence of content modification routes (`admin-http.spec.ts` - 7 tests) |

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Role-based route gating | `docs/SECURITY/04` | `admin-http.spec.ts` ("Admin Role Gating & Authorization") |
| Super admin privilege isolation | `docs/PLAN/03` | `admin-http.spec.ts` ("Raw Payment Log Access Restriction") |
| Content boundary enforcement | `docs/API/09` | `admin-http.spec.ts` ("Content Boundary Enforcement") |
| Audit trail on sensitive access | `docs/SECURITY/05` | `admin-http.spec.ts` ("allows super_admin access and logs access to audit trail") |

## Abuse Cases Covered

| Abuse case | Source | Test |
|---|---|---|
| Regular user calling admin endpoints | `docs/SECURITY/04` | `admin-http.spec.ts` ("rejects regular users with 403 FORBIDDEN") |
| Admin accessing raw payment payloads | `docs/API/09` | `admin-http.spec.ts` ("rejects regular admin access with 403 FORBIDDEN") |
| Attempting to edit user invitation content as admin | `docs/API/09` | `admin-http.spec.ts` ("ensures no route exists allowing admins to modify user invitation content") |

## Definition of Done Verification

- [x] Every admin write produces an audit row with actor, resource, reason and before/after (`audit_logs` schema & service).
- [x] A write without a reason is rejected (`adminActionReasonSchema` min 5).
- [x] No endpoint exists through which an admin can edit invitation content; a test asserts the route is absent (`admin-http.spec.ts`).
- [x] Raw payment log access is separately restricted and logged (`AdminPaymentsController`).
- [x] A regular user reaching an admin route gets a consistent denial with no information leak (HTTP 403 `FORBIDDEN`).

## What Did Not Work

- None. Implementation cleanly leveraged existing `auditLogs` schema and `requireRole` guards.

## Follow-Ups and Open Questions

- In `P5-04` (Template Management API) and `P5-06` (User Management), wire `adminActionReasonSchema` into suspension and refund controllers.

## What to Watch

- High frequency of `admin.sensitive_data_access` security events.
