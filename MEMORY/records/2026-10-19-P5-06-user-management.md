# Change Record: P5-06 User Management

| | |
|---|---|
| **Task** | `P5-06` — User Management |
| **Date** | 2026-10-19 |
| **Author** | Agent |
| **Status** | Complete |

---

## 1. Summary

Implemented the administrative user management module across backend API and admin frontend:
- **Backend API**: Endpoints for user list with search (`search`) and status filter (`status`), detailed user inspect (`GET /users/:id`), and audited account suspension/unsuspension (`PATCH /users/:id/suspend`, `PATCH /users/:id/unsuspend`).
- **Suspension Semantics**:
  - Sets `users.status = 'suspended'` and revokes all active refresh tokens in `refresh_tokens` (`revoked_at = now()`).
  - Active access token bearer requests fail immediately (HTTP 401) because `SessionService.loadActiveUser` requires `users.status = 'active'`.
  - Further login attempts are immediately blocked with HTTP 403 Forbidden.
  - **Published invitations stay published (BR-Admin.6)**: Public invitation routes filter strictly by `invitations.status = 'published'` without checking owner account suspension status, ensuring guest wedding invitations remain live and accessible.
- **Privacy Minimization (docs/SECURITY/09)**: Never returns password hashes, OAuth subject identifiers, session token secrets, or couple private banking information.
- **Admin Frontend (`UsersPage.tsx`)**: Fast search by email or full name, status filter dropdown, users table with role and status badges, detailed drawer showing associated invitations and order histories, and confirmation modals requiring a minimum 5-character audited reason with an explanatory notice on BR-Admin.6.

---

## 2. Files Changed

### Backend API
- `backend/api/src/modules/admin/schemas/admin-user.schema.ts` — Created query and action reason validation schemas.
- `backend/api/src/modules/admin/admin-users.service.ts` — Implemented listing, detail, and audited suspension/unsuspension.
- `backend/api/src/modules/admin/admin-users.controller.ts` — Implemented role-gated endpoints (`requireRole('admin', 'super_admin')`).
- `backend/api/src/modules/admin/admin.module.ts` — Registered `AdminUsersController` and `AdminUsersService`.
- `backend/api/test/idor-sweep-inventory.spec.ts` — Registered exemption for admin users routes.
- `backend/api/test/admin-users.spec.ts` — Created 13/13 passing unit and integration tests covering role gating, privacy minimization, and suspension business rules.

### Admin Frontend
- `admin/src/pages/UsersPage.tsx` — Implemented full user management UI with search, status filtering, detail drawer with invitations/orders, and suspend/unsuspend modals.
- `admin/src/pages/users.spec.tsx` — Created 7/7 passing unit and integration tests verifying search, filters, modal validation, and API PATCH calls.

### Documentation & Memory
- `MEMORY/specs/P5-06-user-management.md` — Feature specification written before implementation.
- `MEMORY/DECISIONS.md` — Added ADR-101.
- `MEMORY/MEMORY-INDEX.md` — Added index entry.
- `MEMORY/CHANGELOG.md` — Added changelog summary.
- `TASKS/PROGRESS.md` — Updated progress count (103 / 140 done, Phase 5: 6 / 14 done).
- `TASKS/PHASE-5-ADMIN-PANEL.md` — Checked off P5-06.

---

## 3. Decisions & Deviations

See **ADR-101** in `MEMORY/DECISIONS.md`.
- **Reason Requirement**: Minimum 5 characters required on all status mutations to enforce meaningful audit trail entries.
- **PageMeta Conformance**: Service returns `{ page, per_page, total }` adhering to `docs/API/00` § Response Envelope.
- **Independence of Invitation Publication**: Verified via explicit test that published invitations are unaffected by owner account suspension.

---

## 4. Test Verification

- `backend/api/test/admin-users.spec.ts`: 13/13 passing tests.
  - Role gating (401 unauthenticated, 403 regular user, 200 admin).
  - Search and status filtering.
  - Privacy data minimization (no password hash or token leaks).
  - Detail query returning invitations and order histories.
  - Suspend and unsuspend audit logs and reason validation.
  - `SessionService` suspension rejection.
  - `public-invitation.service` access unaffected by suspension.
- `admin/src/pages/users.spec.tsx`: 7/7 passing tests.
  - Filter by search query.
  - Filter by status dropdown.
  - Detail modal display of invitations and orders.
  - Minimum 5 chars validation and explanatory alert.
  - Audit reason transmitted via PATCH.
- Repo Guards:
  - `node scripts/check-sanitized-fields.mjs`: PASSED (all fields registered).
  - `node scripts/check-secrets.mjs`: PASSED.
  - `node scripts/check-id-endpoint-tests.mjs`: PASSED.
  - `pnpm typecheck`: PASSED (19/19 packages clean).
  - `pnpm --filter @wi/admin build`: PASSED.

---

## 5. Security Controls Verified

| Control | Document | Proven by test |
|---|---|---|
| Admin Role Gating | `docs/SECURITY/04` | `admin-users.spec.ts` > `rejects regular user requests with 403 Forbidden` |
| Session Revocation upon Suspension | `docs/SECURITY/03` | `admin-users.spec.ts` > `proves SessionService rejects suspended users immediately upon status change` |
| Invitation Life Continuity (BR-Admin.6) | `docs/PLAN/12` | `admin-users.spec.ts` > `proves published invitations remain published and accessible when owner is suspended` |
| Privacy Data Minimization | `docs/SECURITY/09` | `admin-users.spec.ts` > `never exposes credentials or password hashes in user list` & `returns user detail with invitations and order histories` |
| Audited Administrative Writes | `docs/SECURITY/05` | `admin-users.spec.ts` > `suspends user with valid reason and audit log` |
