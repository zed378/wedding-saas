# 04 - Database Architecture

## Technology Choice
- **PostgreSQL** as the primary data store — chosen due to the need for complex relations (User→Invitation→many sub-entities) and strong ACID transactions for order/payment.
- JSONB is used sparingly for flexible fields (e.g., `template_version.sections`, `settings.theme_override`) — not for core relational data (Person, Event remain structured tables to enforce strong validation & querying).

## Schema Design Principles
- Every user-owned domain table MUST have an indexed tenant-isolation column (`invitation_id` or `owner_id`), to support efficient queries and authorization enforcement (see SECURITY/05).
- Use UUIDs as the primary key for entities whose IDs might be exposed in public URLs (invitation, media) — prevents enumeration. Auto-increment integer IDs may be used for purely internal tables (e.g., audit log rows) that are never exposed.
- Soft-delete (`deleted_at`) for entities requiring retention/recovery (invitation, media); hard-delete for transient data (rate-limit counters, etc., not in the RDBMS).
- Foreign key constraints are fully enforced (not only at the application level) to ensure data integrity.

## High-Level Schema
See DATABASE/00-DATA-MODEL.md and DATABASE/01-ERD.md for full details. Summary of table groups:
```
users, user_notification_preferences, refresh_tokens, user_tokens,
user_mfa_factors, user_recovery_codes
invitations, invitation_people, invitation_events, invitation_gallery,
invitation_bank_accounts, invitation_quote, invitation_settings,
invitation_status_history, invitation_guests(rsvp), invitation_guestbook,
invitation_preview_tokens, invitation_view_counts, invitation_custom_domains
templates, template_versions, template_assets
packages, addons, orders, payments
media
slug_blocklist
audit_logs
```
Location data lives on `invitation_events` (venue, address, coordinates) rather than a separate `invitation_locations` table; the sections a template supports live in `template_versions.sections` (JSONB) and the ones a user enabled live in `invitation_settings.enabled_sections`, rather than in `template_sections`/`invitation_sections` tables. DATABASE/00-DATA-MODEL.md is authoritative for this mapping.

## Migration Strategy
- Versioned migrations (e.g., via an ORM migration tool); every production schema change goes through a migration file, no manual schema changes in production.
- Destructive migrations (dropping a column, etc.) are done in two stages (deprecate → confirm unused → drop) to avoid downtime.

## Indexing
- Mandatory indexes: `invitations.owner_id`, `invitations.slug` (unique), `media.invitation_id`, `orders.invitation_id`, `payments.order_id`, `invitation_guests.invitation_id`, `invitation_guestbook.invitation_id`.
- Composite index for tenant + status filter queries, e.g., `(invitation_id, status)` on the guestbook for the moderation queue.

## Connection Pooling
- Use a connection pooler (e.g., PgBouncer) in front of Postgres to handle connection spikes from serverless/worker instances (see 08-DEPLOYMENT-ARCHITECTURE.md).

## Read Replica (Phase 2)
- As read traffic (public pages, if not fully cached) increases, consider a read replica for public queries, keeping the primary for the write path (order/payment/editor).
