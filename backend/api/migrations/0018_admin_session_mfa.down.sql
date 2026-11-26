-- Development rollback only: provenance is intentionally discarded.
ALTER TABLE refresh_tokens DROP COLUMN mfa_verified_at;
