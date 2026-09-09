# 01 - Entity Relationship Diagram (Text)

```
users (1) ──────< (N) invitations
invitations (1) ──── (1) invitation_people [role=groom]
invitations (1) ──── (1) invitation_people [role=bride]
invitations (1) ──────< (N) invitation_events
invitations (1) ──────< (N) invitation_gallery ────> (1) media
invitations (1) ──────< (N) invitation_bank_accounts
invitations (1) ──── (1) invitation_quote
invitations (1) ──── (1) invitation_settings
invitations (1) ──────< (N) invitation_guests
invitations (1) ──────< (N) invitation_guestbook
invitations (1) ──────< (N) invitation_status_history
invitations (1) ──────< (N) invitation_preview_tokens
invitations (1) ──────< (N) invitation_view_counts   [PK (invitation_id, view_date)]
invitations (1) ──── (1) invitation_custom_domains   [Phase 2]
invitations (N) ──────> (1) templates
invitations (N) ──────> (1) template_versions

templates (1) ──────< (N) template_versions
template_versions (1) ──────< (N) template_assets

invitations (1) ──────< (N) orders ──────< (N) payments
users (1) ──────< (N) orders
users (1) ──── (1) user_notification_preferences
users (1) ──────< (N) refresh_tokens
users (1) ──────< (N) user_tokens
users (1) ──────< (N) user_mfa_factors
users (1) ──────< (N) user_recovery_codes

media (N) ──────> (1) invitations  [nullable, for template_assets invitation_id is null]

audit_logs (N) ──────> (1) users [admin_id]

slug_blocklist — standalone platform configuration, no invitation or user relation
                 beyond `created_by` for attribution
```

## Key Cardinalities
- `invitations.owner_id → users.id`: N:1, ON DELETE RESTRICT (a user cannot be hard-deleted if they still have active invitations — use tiered soft-delete).
- `invitation_events.invitation_id → invitations.id`: N:1, ON DELETE CASCADE.
- `invitations.template_version_id → template_versions.id`: N:1, ON DELETE RESTRICT (a template version cannot be deleted while any invitation still references it — aligned with BR-3.3, use a `deprecated` status instead of deleting).
- `payments.order_id → orders.id`: N:1, ON DELETE RESTRICT (payment history must never be lost).

## Design Notes
- This diagram is text-based for easy versioning in git; it's recommended that the team generate a visual diagram (e.g., via dbdiagram.io/Mermaid ERD) from the actual migration schema as living documentation.
