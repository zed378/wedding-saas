-- Legacy sessions remain unverified and cannot inherit administrative authority.
ALTER TABLE refresh_tokens ADD COLUMN mfa_verified_at timestamptz;
