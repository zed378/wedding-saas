-- P4-05 -- ADR-089. `invitation_settings.profanity_filter_enabled`.
--
-- Per-invitation optional profanity filter toggle per `docs/SECURITY/10` § Content Moderation.
-- When enabled, submissions containing profanity are routed to the moderation queue (status 'pending')
-- rather than being blocked outright, avoiding false-positive lockouts.
--
-- Expand-only (migrations/README.md): a new column with default false.

ALTER TABLE "invitation_settings" ADD COLUMN "profanity_filter_enabled" boolean DEFAULT false NOT NULL;
