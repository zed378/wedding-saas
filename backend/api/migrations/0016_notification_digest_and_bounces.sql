-- P4-08 -- Notification preferences daily digest and email delivery bounce suppression.
--
-- 1. Adds `rsvp_digest` to `user_notification_preferences` for owners wishing to receive
--    a single daily digest rather than individual emails per RSVP submission.
-- 2. Creates `email_bounces` table to record hard bounces and spam complaints from delivery providers,
--    suppressing subsequent sends to dead addresses and protecting sender domain reputation.
--
-- Expand-only (migrations/README.md): additive column and table.

ALTER TABLE "user_notification_preferences" ADD COLUMN "rsvp_digest" boolean DEFAULT false NOT NULL;

CREATE TABLE "email_bounces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(255) NOT NULL,
  "bounce_type" varchar(50) NOT NULL,
  "message" text,
  "provider" varchar(50) DEFAULT 'resend' NOT NULL,
  "provider_email_id" varchar(255),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "idx_email_bounces_email" ON "email_bounces" ("email");
