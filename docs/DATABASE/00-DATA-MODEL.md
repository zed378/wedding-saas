# 00 - Data Model (Overview)

Mapping from the domain model (PLAN/08-INVITATION-DATA-MODEL.md) to the physical PostgreSQL table schema.

## Table Groups
```
users
  ├── user_notification_preferences (1..1)
  ├── refresh_tokens (1..N)
  ├── user_tokens (1..N, email verification & password reset)
  ├── user_mfa_factors (1..N, TOTP — mandatory for admins)
  ├── user_recovery_codes (1..N)
  └── invitations (owner_id → users.id)
        ├── invitation_people (groom & bride, 1 row each)
        ├── invitation_events (1..N)
        ├── invitation_gallery (1..N, → media)
        ├── invitation_bank_accounts (1..N)
        ├── invitation_quote (1..1)
        ├── invitation_settings (1..1)
        ├── invitation_guests (rsvp, 1..N, public write)
        ├── invitation_guestbook (1..N, public write)
        ├── invitation_preview_tokens (1..N, share-preview links)
        ├── invitation_view_counts (1..N, one row per day)
        ├── invitation_custom_domains (1..1, Phase 2)
        └── invitation_status_history (lifecycle audit)

templates
  └── template_versions (1..N)
        ├── template_sections (1..N, embedded JSONB or a separate table — see 03-TEMPLATES.md)
        └── template_assets (1..N)

orders (invitation_id, user_id)
  └── payments (1..N, usually 1 active)

media (polymorphic: used by invitation_gallery, invitation_people.photo, template_assets)

slug_blocklist (platform configuration, admin-managed)

audit_logs (admin actions)
```

## Principles
- Every invitation-child table stores `invitation_id` (FK, NOT NULL, indexed) — no table only stores `user_id` for data that conceptually belongs to an invitation (avoiding ownership ambiguity).
- `deleted_at` (soft-delete) exists on: `invitations`, `media`, `users`. Transactional tables (`orders`, `payments`) are not soft-deleted (immutable history); status is changed via the `status` field.
- All timestamps: `created_at`, `updated_at` (auto), UTC timezone.
- Full column details per table: see 02-USERS.md through 12-PLATFORM-CONFIG.md.

## Naming Convention
- Tables: `snake_case`, plural.
- Primary key: `id` (UUID).
- Foreign key: `{singular_table_name}_id`.
- Enum: stored as a native Postgres ENUM or varchar + check constraint (team's choice), consistent throughout the schema.
