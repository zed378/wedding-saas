-- P1-04 (ADR-049) -- a Google identity belongs to at most one active account.
--
-- `idx_users_oauth` shipped in 0001 as a plain index, exactly as docs/DATABASE/02 writes
-- it. `P1-04` step 3 makes `(oauth_provider, oauth_subject_id)` the FIRST thing an OAuth
-- login matches on, which turns it from a lookup key into a login key -- and a login key
-- that can match two rows is a login whose outcome depends on row order.
--
-- Partial over active rows, matching `idx_users_email`: a soft-deleted account must not
-- hold a Google identity hostage until the hard delete runs days later.
--
-- Not destructive under the expand-contract rule in migrations/README.md: no column is
-- dropped and no data is lost. It CAN fail on existing data if two active rows already
-- share a subject id -- impossible through the documented flow (the email index prevents
-- two active accounts on one address, and nothing has written these columns yet), and a
-- failure here is the correct outcome rather than a silent pick between two accounts.

DROP INDEX IF EXISTS "idx_users_oauth";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_oauth" ON "users" USING btree ("oauth_provider","oauth_subject_id") WHERE oauth_provider IS NOT NULL AND deleted_at IS NULL;
