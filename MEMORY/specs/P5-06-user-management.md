# P5-06 — Feature Spec: User Management

Written **before** implementation for task `P5-06: User Management` (`Spec required: Yes — authorization`).

| | |
|---|---|
| **Task** | `TASKS/PHASE-5-ADMIN-PANEL.md` § P5-06 |
| **Date** | 2026-10-19 |
| **Author** | Agent |
| **Status** | Implemented |

---

## 1. Goal

Allow support staff and platform administrators to locate users via fast email/name search, filter by account status (`active`, `suspended`), inspect account details along with associated invitations and order histories (without exposing sensitive personal wedding content or financial secrets), and execute account suspension and unsuspension with mandatory audited rationale. Suspension immediately revokes active sessions and prevents further logins while leaving published wedding invitations live and accessible to invited guests.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/09-ADMIN-API.md` | § User Management | Endpoints: `GET /users`, `GET /users/:id`, `PATCH /users/:id/suspend`, `PATCH /users/:id/unsuspend`. Mandatory `reason` on writes. |
| `docs/PLAN/12-ADMIN-PANEL.md` | § Modules (User Management) | List, search, filter by status; user detail (their invitations, order history); suspend/unsuspend action with mandatory reason. |
| `docs/SECURITY/09-PRIVACY-DATA-PROTECTION.md` | § Principles & Data Minimization | Show only operational support details; never expose credentials, password hashes, tokens, or raw bank details. |
| `docs/DATABASE/02-USERS.md` | § Users Table | `users.status` constraint: `CHECK (status IN ('active', 'suspended'))`. Revocation of active refresh tokens in `refresh_tokens`. |
| `docs/SECURITY/03-AUTHENTICATION-SECURITY.md` | § Session Revocation | Session rejection immediately upon account suspension via database check in `SessionService`. |
| `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` | § Special Case | Audited cross-tenant administrative reads using dedicated `adminFind*` / service layer. |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-Admin.1 | All admin routes role-gated to `admin` and `super_admin`. | `requireRole('admin', 'super_admin')` guard |
| BR-Admin.3 | All administrative user status modifications require non-empty audited reason (min 5 chars). | `AdminUserActionReasonDto` & `AdminUsersService` |
| BR-Admin.5 | Account suspension immediately revokes sessions and blocks authentication. | `SessionService.loadActiveUser` & `LoginService.login` & `refresh_tokens` |
| BR-Admin.6 | Account suspension leaves published invitations published and accessible to guests. | Absence of cascade to invitation publication status; `public-invitation.service.ts` |
| BR-Admin.7 | Customer privacy boundaries preserved: support cannot see personal couple stories or credentials. | Response DTO whitelist in `AdminUsersService` |

## 4. API Contract

### Endpoints
- `GET /api/v1/admin/users?search=&status=&page=&limit=`
  - Auth: `requireRole('admin', 'super_admin')`
  - Query: `search` (optional string, max 100), `status` (optional: `'all' | 'active' | 'suspended'`), `page` (int >= 1), `limit` (int 1..100)
  - Success: 200 `{ data: UserSummaryItem[], meta: PaginationMeta }`
  - Fields per item: `id`, `email`, `fullName`, `phone`, `role`, `status`, `emailVerified`, `createdAt`, `updatedAt`, `invitationCount`, `orderCount`.
- `GET /api/v1/admin/users/:id`
  - Auth: `requireRole('admin', 'super_admin')`
  - Success: 200 `{ data: UserDetailItem }`
  - Detail payload:
    - User fields: `id`, `email`, `fullName`, `phone`, `role`, `status`, `emailVerified`, `createdAt`, `updatedAt`
    - Invitations list: `id`, `slug`, `title`, `status`, `templateId`, `publishedAt`, `createdAt`
    - Orders list: `id`, `orderNumber`, `packageId`, `amountTotal`, `status`, `paidAt`, `createdAt`
  - 404 if user not found or soft-deleted.
- `PATCH /api/v1/admin/users/:id/suspend`
  - Auth: `requireRole('admin', 'super_admin')`
  - Body: `{ reason: string }` (min 5, max 500 chars)
  - Success: 200 `{ data: { id, status: 'suspended', ... } }`
  - 404 if user not found.
  - Side effect: updates `users.status = 'suspended'`, revokes active refresh tokens, writes `audit_logs` row.
- `PATCH /api/v1/admin/users/:id/unsuspend`
  - Auth: `requireRole('admin', 'super_admin')`
  - Body: `{ reason: string }` (min 5, max 500 chars)
  - Success: 200 `{ data: { id, status: 'active', ... } }`
  - 404 if user not found.
  - Side effect: updates `users.status = 'active'`, writes `audit_logs` row.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `users` | Read & Write | Reads for list/detail; updates `status` and `updated_at`. |
| `refresh_tokens` | Read & Write | Updates `revoked_at = now()` for all active user tokens upon suspension. |
| `invitations` | Read | Aggregates count and summary list for user detail view. |
| `orders` | Read | Aggregates count and summary list for user detail view. |
| `audit_logs` | Write | Records `user.suspend` and `user.unsuspend` actions in the same transaction. |

Migration required: No. The database schema already supports `users.status` ('active', 'suspended') and `refresh_tokens.revoked_at`.

## 6. Authorization

- **Who may call this**: Only authenticated users with `role: 'admin'` or `role: 'super_admin'`. Regular users (`role: 'user'`) receive HTTP 403 Forbidden.
- **Cross-tenant support access**: Admin reads/mutations query across user records for operational support; every write action writes an `audit_logs` row with actor ID, target resource ID, reason, and before/after state diff.
- **Privacy minimization**: No endpoint exists for reading user password hashes, OAuth subject secrets, session token secrets, or personal wedding couple details.

## 7. Validation and Sanitization

- Query parameters parsed with numeric coercions and length caps.
- `reason` validated with `z.string().trim().min(5).max(500)`. Blank or whitespace reasons are rejected with HTTP 400 `VALIDATION_ERROR`.
- Registered in `backend/api/src/shared/sanitizer/registry.ts` to satisfy `scripts/check-sanitized-fields.mjs`.

## 8. State Transitions

- User status:
  - `active` → `suspended` via `PATCH /api/v1/admin/users/:id/suspend`
  - `suspended` → `active` via `PATCH /api/v1/admin/users/:id/unsuspend`
- Published invitations remain in status `'published'`.

## 9. Side Effects

- In-transaction:
  - Revokes all active refresh tokens in `refresh_tokens` (`revoked_at = now()`).
  - Writes audit row into `audit_logs`.
- Immediate effect:
  - `SessionService.loadActiveUser` reads `users.status = 'active'`, so ongoing bearer token requests fail immediately (401).
  - `LoginService.login` rejects login attempts for suspended accounts with 403 Forbidden.

## 10. Failure Modes

- User not found: 404 `USER_NOT_FOUND`.
- Empty or short reason: 400 `VALIDATION_ERROR`.
- Non-admin caller: 403 `FORBIDDEN`.
- Unauthenticated caller: 401 `UNAUTHENTICATED`.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Regular user attempts to access admin user endpoints | `docs/SECURITY/04` | HTTP 403 Forbidden | `regular user cannot access admin users endpoints` |
| Admin attempts suspension without providing reason | `docs/API/09` | HTTP 400 `VALIDATION_ERROR` | `refuses suspension without valid reason` |
| Suspended user attempts to authenticate with existing JWT | `docs/SECURITY/03` | HTTP 401 Unauthorized immediately | `suspended user session is rejected immediately` |
| Suspended user attempts to log in with correct credentials | `docs/API/01` | HTTP 403 Forbidden | `suspended user cannot log in` |
| Public guest accesses published invitation belonging to suspended user | `docs/PLAN/12` § 2 | HTTP 200 OK — public invitation remains accessible | `published invitation remains reachable after owner suspension` |
| Password hash or tokens leaked in admin API response | `docs/SECURITY/09` | Prohibited — response whitelisted | `admin user response never leaks credentials` |

## 12. Test Plan

- Unit & integration tests in `backend/api/test/admin-users.spec.ts`.
- Frontend tests in `admin/src/pages/users.spec.tsx`.
