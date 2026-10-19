# Change Record — P5-01: Admin Application Shell and Session Isolation

| | |
|---|---|
| **Task** | `P5-01` |
| **Date** | 2026-10-19 |
| **Author** | Agent |
| **Status** | Completed |
| **Spec** | `MEMORY/specs/P5-01-admin-shell-and-session-isolation.md` |
| **ADR** | `MEMORY/DECISIONS.md#ADR-096` |

---

## 1. What Changed and Why

### Summary
Established the administrative application shell (`@wi/admin`) running on its dedicated origin (`admin.vizunicum.my.id`, port 3300 locally) with strict session isolation from the end-user application (`app.vizunicum.my.id`). This implements Trust Boundary 3→4 (`docs/SECURITY/02`), enforces a hardened Content-Security-Policy (CSP) devoid of third-party user embeds or external script sources, caps admin session lifetime at 4 hours maximum (`docs/SECURITY/03`), implements a desktop-first shell with sidebar navigation covering all 6 core admin modules (`docs/UI-UX/15`), and provides an explicit 403 `UnauthorizedPage` for non-admin accounts (`docs/FRONTEND/01`).

### Detailed Changes
1. **Administrative Authentication & State (`admin/src/auth/admin-auth.tsx`)**:
   - Implemented `AdminAuthProvider` and `useAdminAuth` hook.
   - Enforced 4-hour max session lifespan (`MAX_ADMIN_SESSION_MS = 4 * 60 * 60 * 1000`).
   - Session remaining time tracker recalculates time remaining and automatically expires sessions when the cap elapses.
   - Separate in-memory token store via `@wi/api-client` `accessTokenStore`; strictly zero writes to `localStorage`, `sessionStorage`, or client-accessible cookies (`check-token-storage.mjs`).
   - Verified session check via `GET /api/v1/auth/me`. Identifies `admin` and `super_admin` as authorized; marks standard `user` accounts as `isUnauthorized: true`.
2. **Route Guard & Explicit 403 Unauthorized Screen (`admin/src/auth/RequireAdmin.tsx`, `admin/src/pages/UnauthorizedPage.tsx`)**:
   - `RequireAdmin` guards administrative views. If unauthenticated, routes to `LoginPage`.
   - When an authenticated non-admin arrives, renders `UnauthorizedPage` explaining the 403 access denial with options to return to the main app (`https://app.vizunicum.my.id`) or log out.
3. **Desktop-First Administrative Shell (`admin/src/components/AdminLayout.tsx`)**:
   - Desktop sidebar navigation covering all 6 core modules: Dashboard (`/`), Users (`/users`), Templates (`/templates`), Orders (`/orders`), Moderation (`/moderation`), and Audit Logs (`/audit-logs`).
   - Header displaying active breadcrumb, administrator profile pill (Avatar, email, and Role badge), and Logout button.
   - Session expiration indicator showing remaining time out of the 4-hour allocation.
   - Skip to main content link for keyboard and screen-reader accessibility (`#main-content`).
   - Built exclusively with `@wi/ui` design tokens and semantic classes (`check-design-tokens.mjs`).
4. **Module Placeholders & App Routing (`admin/src/pages/*`, `admin/src/router.tsx`, `admin/src/App.tsx`)**:
   - Placeholder pages for Dashboard, Users, Templates, Orders, Moderation, Audit Logs, and Login.
   - Custom lightweight history router with `useRouter()` and `<Link>` supporting `popstate` and pushState.
5. **Production Proxy & Hardened CSP (`deploy/Caddyfile.production`, `deploy/docker-compose.staging.yml`)**:
   - Replaced 503 placeholder stubs with reverse proxy routing `/api/*` to `api:3000` and SPA UI to `admin:8080`.
   - Applied hardened CSP (`frame-ancestors 'none'`, `X-Frame-Options: DENY`, strict `script-src` and `connect-src`).
   - Wired `admin` service into `deploy/docker-compose.staging.yml` `caddy` dependencies.
6. **Guard & Token Compliance**:
   - Replaced hardcoded price literals in `frontend/web-app/src/editor/PublishCta.tsx` and `checkout/[invitationId]/page.tsx` to satisfy `check-price-literals.mjs`.

---

## 2. Security Verification

| Control | Enforced in | Test Name |
|---|---|---|
| Trust Boundary 3→4 Subdomain & Session Isolation | `admin/src/auth/admin-auth.tsx`, `deploy/Caddyfile.production` | `clears in-memory token store upon logout`, `check-token-storage.mjs` |
| 4-Hour Maximum Admin Session Lifespan | `admin/src/auth/admin-auth.tsx` (`MAX_ADMIN_SESSION_MS`) | `enforces 4-hour max session lifetime on login (docs/SECURITY/03)` |
| Role-Based Admin Access (`admin`, `super_admin`) | `admin/src/auth/admin-auth.tsx`, `RequireAdmin.tsx` | `identifies admin role as authorized admin`, `identifies super_admin role as authorized admin` |
| Non-Admin Access Denial (BR-Admin.2) | `admin/src/auth/RequireAdmin.tsx`, `UnauthorizedPage.tsx` | `identifies standard user role as isUnauthorized and not isAdmin (BR-Admin.1)`, `renders explicit UnauthorizedPage (403) when authenticated non-admin user arrives` |
| Anti-Clickjacking & Hardened CSP | `deploy/Caddyfile.production`, `admin/nginx.conf` | `X-Frame-Options: DENY`, `frame-ancestors 'none'` in Caddyfile |
| No Tokens in Browser Storage | `accessTokenStore` (closure memory) | `scripts/check-token-storage.mjs` (436 files checked, 0 violations) |

---

## 3. DoD Verification

- [x] Dedicated admin app shell running at `admin.vizunicum.my.id` (port 3300 locally).
- [x] Desktop-first sidebar layout covering all 6 core modules (Dashboard, Users, Templates, Orders, Moderation, Audit Logs).
- [x] Host-level session isolation and in-memory token management with 4-hour max session lifespan.
- [x] Explicit 403 `UnauthorizedPage` rendered for non-admin accounts.
- [x] Hardened CSP without user iframe embeds.
- [x] Network restriction strategy documented in ADR-096.
- [x] All unit and integration tests passing (10 tests in `@wi/admin`).
- [x] All 16 repository guard scripts passing.
