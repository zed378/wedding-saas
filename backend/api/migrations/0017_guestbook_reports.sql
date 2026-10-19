-- P5-09 -- Moderation queue guestbook reports.
--
-- Creates `guestbook_reports` table to record guest reports against guestbook entries
-- submitted on public invitation pages (POST /public/i/:slug/guestbook/:entry_id/report).
-- Feeds the administrative moderation queue (PLAN/12 § Moderation Queue).
--
-- Expand-only (migrations/README.md): additive table and indexes.

CREATE TABLE "guestbook_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "guestbook_entry_id" uuid NOT NULL REFERENCES "invitation_guestbook"("id") ON DELETE CASCADE,
  "invitation_id" uuid NOT NULL REFERENCES "invitations"("id") ON DELETE CASCADE,
  "reason" varchar(255),
  "reporter_ip_hash" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "idx_guestbook_reports_entry" ON "guestbook_reports" ("guestbook_entry_id");
CREATE INDEX "idx_guestbook_reports_invitation" ON "guestbook_reports" ("invitation_id");
