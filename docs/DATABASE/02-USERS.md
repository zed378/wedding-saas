# 02 - Table: users

```sql
CREATE TABLE users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               VARCHAR(255) NOT NULL,      -- uniqueness via idx_users_email below, not a column constraint
  password_hash       VARCHAR(255),              -- NULL if OAuth-only login
  full_name           VARCHAR(100) NOT NULL,
  phone               VARCHAR(20),
  role                VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','super_admin')),
  email_verified      BOOLEAN NOT NULL DEFAULT false,
  status              VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  oauth_provider      VARCHAR(20),                -- 'google' | NULL
  oauth_subject_id    VARCHAR(255),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
-- UNIQUE since P1-04 (ADR-049): API/01 matches an OAuth login on (provider, subject_id)
-- first, which makes it a login key -- and a login key that matches two rows is a login
-- whose outcome depends on row order. Partial over active rows, like idx_users_email.
CREATE UNIQUE INDEX idx_users_oauth ON users(oauth_provider, oauth_subject_id) WHERE oauth_provider IS NOT NULL AND deleted_at IS NULL;
```

> **Email uniqueness is enforced only by `idx_users_email`** — deliberately not by a
> column-level `UNIQUE` (amended in `P0-07`, ADR-031). A column constraint applies to
> every row including soft-deleted ones, which would make the partial index unreachable
> and hold a deleted account's address hostage until the hard delete ran days later
> (SECURITY/09). The two cannot both be in force; the partial index is the one that
> matches the intent.


## Supporting Tables
```sql
CREATE TABLE user_notification_preferences (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rsvp_email          BOOLEAN NOT NULL DEFAULT true,
  guestbook_email     BOOLEAN NOT NULL DEFAULT true,
  marketing_email     BOOLEAN NOT NULL DEFAULT false,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash          VARCHAR(255) NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
```

## Single-Use Token Table

Backs email verification (API/01 § Registration Flow) and password reset (SECURITY/03 § Password Reset). Tokens are stored **hashed** for the same reason refresh tokens are: a database read must not yield a usable credential.

```sql
CREATE TABLE user_tokens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                VARCHAR(30) NOT NULL CHECK (type IN ('email_verification','password_reset')),
  token_hash          VARCHAR(255) NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  used_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_user_tokens_hash ON user_tokens(token_hash);
CREATE INDEX idx_user_tokens_user_type ON user_tokens(user_id, type) WHERE used_at IS NULL;
```

- Expiry: `email_verification` 24 hours, `password_reset` 1 hour (SECURITY/03).
- Single use: `used_at` is set on redemption in the same transaction as the effect, so a replayed token is a no-op.
- Requesting a new token of the same type invalidates the previous unused one.

## Multi-Factor Authentication Tables

Mandatory for `admin`/`super_admin` (SECURITY/03 § Admin Session, PLAN/12 § Access Control). Available to regular users only if MFA is later offered to them; the schema does not restrict the role.

```sql
CREATE TABLE user_mfa_factors (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                VARCHAR(20) NOT NULL DEFAULT 'totp' CHECK (type IN ('totp')),
  secret_encrypted    BYTEA NOT NULL,              -- application-layer encrypted, never plaintext
  label               VARCHAR(60),
  confirmed_at        TIMESTAMPTZ,                 -- NULL until a first valid code is entered
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_mfa_user_type ON user_mfa_factors(user_id, type) WHERE confirmed_at IS NOT NULL;

CREATE TABLE user_recovery_codes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash           VARCHAR(255) NOT NULL,
  used_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_recovery_codes_user ON user_recovery_codes(user_id) WHERE used_at IS NULL;
```

- A factor is only active once `confirmed_at` is set — enrolment that is started and abandoned must not lock an admin out.
- `secret_encrypted` uses application-layer encryption, not only disk encryption: a TOTP secret readable from a database dump is a shared password.
- Recovery codes are hashed and single-use; regenerating the set invalidates every unused code.

## Notes
- `password_hash` uses the bcrypt/argon2 algorithm (see SECURITY/03-AUTHENTICATION-SECURITY.md) — never stored/logged in plaintext.
- The `deleted_at` column supports soft-deleting accounts per the "Request account deletion" FR (API/02).
- `user_tokens`, `user_mfa_factors` and `user_recovery_codes` all store hashed or encrypted material only. Nothing in this file may be logged (DEVOPS/06 § Mandatory Redaction).
