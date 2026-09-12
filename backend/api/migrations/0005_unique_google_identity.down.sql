-- Reverses 0005_unique_google_identity.sql: back to the plain index from 0001.
--
-- Safe in both directions -- dropping a unique index never rejects data.

DROP INDEX IF EXISTS "idx_users_oauth";--> statement-breakpoint
CREATE INDEX "idx_users_oauth" ON "users" USING btree ("oauth_provider","oauth_subject_id") WHERE oauth_provider IS NOT NULL;
