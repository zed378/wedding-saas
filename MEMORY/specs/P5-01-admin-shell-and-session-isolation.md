# P5-01 — Feature Spec: Admin Application Shell and Session Isolation

| | |
|---|---|
| **Task** | `P5-01` |
| **Date** | 2026-10-19 |
| **Author** | Agent |
| **Status** | Reviewed |

---

## 1. Goal

Establish the administrative application shell (`@wi/admin`) running on its own dedicated subdomain (`admin.vizunicum.my.id`) with strict session isolation from the end-user application (`app.vizunicum.my.id`). This guarantees that an XSS vulnerability or session leakage in the user application cannot compromise the administrative trust boundary (Trust Boundary 3→4), establishes a hardened Content-Security-Policy (CSP) devoid of third-party user embeds, restricts session lifespan to 4 hours maximum, implements desktop-first navigation, and provides an explicit "Unauthorized" page for non-admin accounts.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/SECURITY/02-TRUST-BOUNDARIES.md` | Boundary 3→4, Data Zones | Admin panel runs on separate hostname (`admin.vizunicum.my.id`) with independent session scope |
| `docs/PLAN/12-ADMIN-PANEL.md` | § Modules, § Access Control | Admin sitemap (Dashboard, Users, Templates, Orders, Moderation, Audit Logs), RBAC enforcement |
| `docs/SECURITY/03-AUTHENTICATION-SECURITY.md` | § Admin Session | Admin session expiry capped at 4 hours; mandatory 2FA |
| `docs/FRONTEND/01-ROUTING.md` | § Admin Panel, § Route Guards | Non-admin users redirected to an explicit Unauthorized page, not a 404 |
| `docs/UI-UX/15-RESPONSIVE-DESIGN.md` | § Admin Panel | Desktop-first layout, basic tablet adaptation, mobile not an MVP priority |
| `MEMORY/DECISIONS.md` | ADR-024 | Single static DNS records per hostname, no wildcards |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-Admin.1 | Only users with role `admin` or `super_admin` may access the admin panel | `admin/src/auth/RequireAdmin.tsx`, backend guards |
| BR-Admin.2 | Non-admin authenticated users attempting admin access must receive an explicit Unauthorized screen | `admin/src/pages/UnauthorizedPage.tsx` |
| BR-Admin.3 | Admin session expiry must not exceed 4 hours (shorter than standard 30-day user refresh) | `admin/src/auth/admin-auth.tsx`, API session duration |
| BR-Admin.4 | Admin sessions must be completely isolated from end-user sessions | Cookie domain/path scoping, separate in-memory token store |

## 4. API Contract & Integration

- Admin endpoints reside under `/api/v1/admin/*`.
- Session profile verification:
  - `GET /api/v1/auth/me`: Returns user profile including `role`.
  - Non-admins attempting admin operations receive HTTP 403 `FORBIDDEN` (or HTTP 401 `UNAUTHENTICATED`).
- Admin shell routing:
  - `/` or `/dashboard` — KPI Metrics & Overview
  - `/users` — User Management & Suspension
  - `/templates` — Template Catalog & Version Management
  - `/orders` — Orders, Payments & Manual Refunds
  - `/moderation` — Guestbook & Reported Content Queue
  - `/audit-logs` — Administrative Audit Trail
  - `/unauthorized` — Explicit access denied screen for non-admin roles
  - `/login` — Admin login screen

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `users` | Read | Checks `users.role IN ('admin', 'super_admin')` |

Migration required: No. The `role` column on `users` (`'user' | 'admin' | 'super_admin'`) was seeded in Phase 0.

## 6. Authorization

- **Who may access**: Only authenticated users whose verified role is `admin` or `super_admin`.
- **Enforcement layer**:
  - Frontend client guard (`RequireAdmin`) inspects verified user profile on initial session check.
  - Backend controllers under `/api/v1/admin/*` enforce `@Roles('admin', 'super_admin')` on every handler.
- **Handling unauthorized requests**:
  - An authenticated standard user (`role: 'user'`) is immediately shown the dedicated `UnauthorizedPage` explaining they lack administrative privileges.
  - An unauthenticated visitor is redirected to `/login`.

## 7. Security & Session Isolation

- **Domain Isolation**: Served strictly from `admin.vizunicum.my.id` (or `localhost:3300` in development).
- **Cookie Isolation**: Refresh cookies on production are scoped strictly to the `admin` subdomain with `SameSite=Lax; HttpOnly; Secure`.
- **Hardened CSP**:
  - `default-src 'self'`
  - `script-src 'self'` (no unsafe-inline or external script CDNs)
  - `style-src 'self' 'unsafe-inline'`
  - `img-src 'self' data: https://*.r2.cloudflarestorage.com https://cdn.vizunicum.my.id`
  - `connect-src 'self' https://admin.vizunicum.my.id https://app.vizunicum.my.id`
  - `frame-ancestors 'none'` (anti-clickjacking)
- **Session Duration**: Capped at 4 hours.

## 8. Failure Modes

- Expired admin session: Clears local in-memory token and routes to login with session expired notification.
- Non-admin login: Displays `UnauthorizedPage` with options to log out or return to standard web app.
- Network/API failure: Displays global error toast / reconnecting indicator without leaking internal infrastructure details.

## 9. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Standard user accesses admin URL | `docs/SECURITY/01` | Routed to explicit Unauthorized page, not 404 | `blocks standard user with unauthorized screen` |
| Session longevity abuse | `docs/SECURITY/03` | Session expires after 4 hours max | `enforces 4-hour max session lifetime` |
| Clickjacking attempt | `docs/SECURITY/08` | `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'` | `verifies frame denial headers` |

## 10. Test Plan

- Unit tests for `admin` application shell, navigation sidebar/header, routing, and `UnauthorizedPage`.
- Role verification and redirect tests for admin vs non-admin.
- Token store isolation test proving admin tokens do not persist into browser storage.
