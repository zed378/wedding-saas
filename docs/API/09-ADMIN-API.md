# 09 - Admin API

All endpoints below are under the `/api/v1/admin/*` prefix, require the `admin`/`super_admin` role, and are logged in the audit log for write actions (see DATABASE/10-AUDIT-LOGS.md).

## User Management
```
GET    /api/v1/admin/users                   ?search=&status=&page=
GET    /api/v1/admin/users/:id
PATCH  /api/v1/admin/users/:id/suspend         { reason }
PATCH  /api/v1/admin/users/:id/unsuspend
```

## Template Management
See 03-TEMPLATE-API.md § Admin.

## Order & Payment Management
```
GET    /api/v1/admin/orders                    ?status=&page=
GET    /api/v1/admin/orders/:id
POST   /api/v1/admin/orders/:id/refund          { reason }   → triggers a state transition (PLAN/06)
GET    /api/v1/admin/payments/:id/raw-log        (debugging, restricted access — see the privacy note below)
```

## Moderation

Platform-level moderation, fed by guest reports (`POST /public/i/:slug/guestbook/:entry_id/report`, API/08) and automatic content-filter flags (SECURITY/10). This is distinct from the invitation owner's own moderation queue in 04-INVITATION-API.md § Guestbook (owner side): the owner decides what appears on their invitation, the admin decides what the platform will host.

```
GET    /api/v1/admin/moderation/guestbook        ?status=pending&page=
PATCH  /api/v1/admin/moderation/guestbook/:id     { status: approved|rejected }
DELETE /api/v1/admin/moderation/guestbook/:id
```

## Invitation Overview (read-only, support)
```
GET    /api/v1/admin/invitations                ?search_slug=&search_user=&page=
GET    /api/v1/admin/invitations/:id             (read-only, no PATCHing user content by an admin)
```

## Dashboard
```
GET    /api/v1/admin/dashboard/summary            Total users, invitations per status, daily/monthly revenue
```

## Audit Log
```
GET    /api/v1/admin/audit-logs                  ?admin_id=&resource_type=&date_from=&date_to=&page=
```

## Admin-Specific Principles
- Admins CANNOT modify a user's invitation content (name, photos, etc.) directly — only moderation (guestbook) and lifecycle actions (refund/suspend). This preserves privacy boundaries (see SECURITY/09-PRIVACY-DATA-PROTECTION.md).
- `raw-log` payment data contains raw payment data — access is restricted to certain roles & logged for who accessed it (sensitive data access logging).
- All write endpoints that affect users (suspend, refund) REQUIRE a `reason` in the body — stored in the audit log.
