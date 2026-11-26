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

Invitation detail includes `validation_summary`: `ready`, `missing_required_fields` (count), and `incomplete_sections` (section keys). It describes required-field completeness only, without content values; payment and slug eligibility are separate support checks. Every administrative detail and list read is audited.

## Dashboard
```
GET    /api/v1/admin/dashboard/summary            Total users, invitations per status, daily/monthly revenue
```

Summary accepts no query parameters and uses fixed UTC periods. Fields: `generated_at`, `timezone`, `revenue_basis`, `total_users`, `total_invitations`, `paid_orders`, `total_revenue`, `daily_revenue`, `monthly_revenue`, `invitations_by_status[{status,count}]`, `orders_by_day[{date,count,revenue}]` (30 zero-filled days), `revenue_by_month[{month,revenue}]` (six zero-filled months), and `funnel{created,ever_paid,paid_and_published}`. Monetary totals are decimal integer strings from `orders.amount_total` on currently paid orders, before fees; refunded orders are excluded once. Daily/monthly grouping uses order creation time, not provider settlement time. The response labels this basis explicitly and is cached for 30 seconds.

Funnel counts nondeleted invitations, then distinct invitations with paid/refunded order history, then that same cohort with non-null `published_at`. Renewals do not double-count invitations and trial-only publishing does not count as paid conversion. These are lifetime operational cohorts, not a chronological acquisition funnel.

## Audit Log
```
GET    /api/v1/admin/audit-logs                  ?admin_id=&resource_type=&date_from=&date_to=&page=
GET    /api/v1/admin/audit-logs/export           Same filters; JSON attachment, at most 10,000 rows
```

The audit list and export also accept `resource_id`. Dates are ISO-8601 UTC; a reversed range is rejected. Export is a deliberate bulk read: it writes an `audit_log.export` audit row identifying the administrator, filters and exported row count, in the same database transaction as the read. An oversized export is rejected rather than silently truncated. Stored rows remain append-only; credentials and financial secrets are redacted from readable before/after snapshots, including legacy rows. Retention is two years (DATABASE/10).

## Slug Blocklist

```
GET    /api/v1/admin/slug-blocklist              ?page=1&per_page=20
POST   /api/v1/admin/slug-blocklist              { term, match_type, category, reason }
PATCH  /api/v1/admin/slug-blocklist/:id          { term, match_type, category, reason }
DELETE /api/v1/admin/slug-blocklist/:id          { reason }
POST   /api/v1/admin/slug-blocklist/test         { slug }
```

P5-13 contract approved by the project owner on 2026-11-25. `match_type` is `exact|substring`; `category` is `reserved|profanity|brand|other`. Term is lowercase slug-alphabet text (1–60 characters); reason is sanitized text (5–500 characters). IDs are UUIDs. Unknown fields are rejected. Every mutation records actor, reason and before/after in the same transaction. Create returns 201; other operations return 200 under the standard success envelope.

List returns entries (`id`, `term`, `match_type`, `category`, `reason`, `created_by`, `created_at`) with standard pagination. Create/update returns `{entry, existing_matches, existing_match_count}`; matches contain only invitation `id`, `slug`, and `status`, maximum 100, and each exposed invitation read is audited. Existing invitations are never changed. Delete returns `{id}`. Candidate test returns `{blocked, valid_format, matching_term}`; malformed slug also includes `message` and does not imply availability. Exact matching is whole-slug; substring matching folds basic leetspeak (DATABASE/12).

Non-admins receive 403 before configuration is read; unauthenticated requests receive 401. Malformed requests are 400; missing IDs 404; duplicate `(lower(term), match_type)` is 409 `BLOCKLIST_TERM_EXISTS`; removing/renaming the exact reservations `preview` or `public`, or an exact seeded system reservation, is 409 `RESERVED_PUBLIC_ROUTE`. Seeded reservations also retain their `reserved` category; their explanation remains editable. The route reservation gate requires new static routes to have exact seed entries before deployment.

## Admin-Specific Principles
- Admins CANNOT modify a user's invitation content (name, photos, etc.) directly — only moderation (guestbook) and lifecycle actions (refund/suspend). This preserves privacy boundaries (see SECURITY/09-PRIVACY-DATA-PROTECTION.md).
- `raw-log` payment data contains raw payment data — access is restricted to certain roles & logged for who accessed it (sensitive data access logging).
- All write endpoints that affect users (suspend, refund) REQUIRE a `reason` in the body — stored in the audit log.
- Suspension and refund also require fresh step-up proof in `X-MFA-Step-Up`, obtained from `POST /api/v1/auth/mfa/step-up`; an ordinary authenticated admin session alone is insufficient.
