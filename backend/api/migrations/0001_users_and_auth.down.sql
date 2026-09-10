-- Reverses 0001_users_and_auth.sql.
--
-- Safe here only because no data exists yet. Running this against a populated database
-- destroys every account and everything cascading from one; migrations/README.md
-- explains why db:rollback is a development tool and not production recovery.
--
-- Order matters: children before the parent, or the foreign keys refuse. The triggers
-- go with their tables automatically, so they are not dropped separately.

DROP TABLE IF EXISTS user_recovery_codes;
DROP TABLE IF EXISTS user_mfa_factors;
DROP TABLE IF EXISTS user_tokens;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS user_notification_preferences;
DROP TABLE IF EXISTS users;
