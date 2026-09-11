# 12 - Admin Panel

## Modules
1. **Dashboard** — metric summary: total users, total invitations (per status), revenue (daily/monthly), order chart.
2. **User Management** — list, search, filter by status; user detail (their invitations, order history); suspend/unsuspend action (reason mandatory, audit log).
3. **Template Management** — CRUD templates & versions (see 07-TEMPLATE-SYSTEM.md); section/schema definition form; asset upload; preview with dummy data; publish/deprecate versions.
4. **Order & Payment Management** — order list with status filter; payment detail (including raw callback log for debugging); manual refund (reason mandatory).
5. **Moderation Queue** — list of pending guestbook entries & reported content; approve/reject/delete actions; filter per invitation. The queue is fed by two sources: guest reports via `POST /public/i/:slug/guestbook/:entry_id/report` (API/08) and automatic content-filter flags (SECURITY/10). Distinct from the owner's own moderation of their invitation (API/04 § Guestbook (owner side)) — the owner decides what appears on their invitation, the admin decides what the platform will host.
6. **Invitation Overview (read-only)** — search invitations by slug/user for support purposes; CANNOT edit user content (except via special moderation), to preserve privacy boundaries.
7. **Audit Log Viewer** — all admin actions are logged & can be filtered by admin/date/resource.

## Access Control
- All admin panel routes are behind RBAC middleware for the `admin`/`super_admin` role (see SECURITY/04-AUTHORIZATION-RBAC.md).
- The admin panel is served on a separate hostname (`admin.vizunicum.my.id`) with a session separate from the user-facing application, to reduce the attack surface (see SECURITY/02-TRUST-BOUNDARIES.md). One static DNS record, no wildcard — see PLAN/10 § Hostnames.
- 2FA is mandatory for admin accounts (see SECURITY/03-AUTHENTICATION-SECURITY.md).

## Mandatory Audit Trail
- Every write action by an admin: who, when, which resource, before/after change (specifically for refunds, suspensions, moderation, template publishing).
