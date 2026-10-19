# P5-03 — Feature Spec: Admin Authorization Path and Audit Middleware

| | |
|---|---|
| **Task** | `P5-03` |
| **Date** | 2026-10-19 |
| **Author** | Agent |
| **Status** | Reviewed |

---

## 1. Goal

Mount all administrative endpoints under `/api/v1/admin/*` behind strict role-based authorization (`admin` and `super_admin`), enforce mandatory, non-empty reason strings on all state-altering administrative write operations, bind audit log records to the exact transaction of the change, record all deliberate cross-tenant lookups (`adminFind*`), restrict raw payment logs to `super_admin` with sensitive data access tracking, and guarantee that no endpoint exists through which an administrator can edit user invitation content.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` | § Special Case: Admin Access | Deliberate tenant isolation bypass code path; must be logged in `audit_logs` with admin, target, and timestamp |
| `docs/API/09-ADMIN-API.md` | § Principles | Write endpoints require `reason`; admins cannot modify user invitation content; raw payment log access restricted & audited |
| `docs/DATABASE/10-AUDIT-LOGS.md` | § Entire document | Schema, append-only constraint, snapshots trimmed/redacted, same-transaction requirement |
| `docs/PLAN/03-AUTHORIZATION.md` | § Principles | `admin` does not imply `super_admin`; least privilege enforced |
| `docs/SECURITY/04-AUTHORIZATION-SECURITY.md` | § Mandatory Middleware | Role checking at HTTP boundary; object authorization at service layer |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-Admin.1 | All `/api/v1/admin/*` endpoints require `admin` or `super_admin` role | `requireRole('admin', 'super_admin')`, `AdminGuard` |
| BR-Admin.2 | Regular users attempting admin access receive consistent HTTP 403 Forbidden | `RequireRoleGuard`, `ForbiddenError` |
| BR-Admin.3 | Admin write operations affecting users require non-empty `reason` | Request validation schema, `AdminReasonSchema` |
| BR-Admin.4 | Every admin write produces an `audit_logs` record in the same database transaction | `AuditLogService.record(tx, entry)` |
| BR-Admin.5 | Cross-tenant lookups (`adminFind*`) generate an audit trail entry | `AdminInvitationService`, `TenancyRepository` |
| BR-Admin.6 | Raw payment logs (`GET /admin/payments/:id/raw-log`) require `super_admin` role and log sensitive data access | `requireRole('super_admin')`, `logSecurityEvent` |
| BR-Admin.7 | Admins cannot modify invitation content (names, photos, events) | Architectural absence of mutation endpoints |

## 4. API Contract & Schemas

### Base Admin Write Body (with mandatory reason)
```ts
export const adminActionReasonSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});
```

### Endpoints Defined in P5-03:
1. `GET /api/v1/admin/audit-logs`:
   - Query: `admin_id?: string`, `resource_type?: string`, `date_from?: string`, `date_to?: string`, `page?: number`, `limit?: number`.
   - Access: `admin`, `super_admin`.
   - Envelope: Standard `ok({ items: AuditLogEntry[], total, page, limit })`.
2. `GET /api/v1/admin/payments/:id/raw-log`:
   - Access: `super_admin` ONLY.
   - Emits security event `admin.raw_payment_log_accessed`.
   - Returns redacted raw gateway provider webhook/query payload.
3. Content Mutation Protection:
   - Automated routing assertion confirms no `PATCH /api/v1/admin/invitations/:id` or sub-resources (couple, events, gallery) exist.

## 5. Data Model Impact

Uses existing `audit_logs` table (`docs/DATABASE/10-AUDIT-LOGS.md`):
- `id` (uuid)
- `admin_id` (uuid references users.id)
- `action` (varchar e.g. `user.suspend`, `invitation.view_support`)
- `resource_type` (varchar e.g. `user`, `invitation`, `order`)
- `resource_id` (varchar)
- `reason` (text, nullable in table but required on writes by API schema)
- `before_state` (jsonb, redacted)
- `after_state` (jsonb, redacted)
- `ip_address` (varchar)
- `created_at` (timestamp)

Migration required: No. Schema was defined in `backend/api/src/infra/db/schema/audit.ts`.

## 6. Authorization

- Route level: `UseGuards(requireAuth(), requireRole("admin", "super_admin"))`.
- `super_admin` specific routes: `UseGuards(requireAuth(), requireRole("super_admin"))`.
- Standard user: Throws `ForbiddenError("FORBIDDEN")` resulting in HTTP 403 envelope.
- Anonymous caller: Throws `UnauthenticatedError("UNAUTHENTICATED")` resulting in HTTP 401 envelope.

## 7. Abuse Cases

| Abuse case | Expected behaviour |
|---|---|
| Standard user calling `/api/v1/admin/*` | HTTP 403 `FORBIDDEN` |
| Regular admin attempting `GET /api/v1/admin/payments/:id/raw-log` | HTTP 403 `FORBIDDEN` (`super_admin` required) |
| Admin submitting action without `reason` or whitespace only | HTTP 400 `VALIDATION_ERROR` with reason field violation |
| Transaction rollback during write operation | Audit log record rolls back identically; no phantom audit rows |
| Sensitive credentials/numbers in before/after states | Automatically redacted by `redact()` before insertion |

## 8. Test Plan

- Unit tests for `requireRole` with admin and super_admin hierarchy check.
- Integration tests for `GET /api/v1/admin/audit-logs` pagination, filtering.
- Integration test for `GET /api/v1/admin/payments/:id/raw-log` verifying regular admin gets 403, super_admin gets 200, and access is audited.
- Test asserting absence of invitation content editing routes.
