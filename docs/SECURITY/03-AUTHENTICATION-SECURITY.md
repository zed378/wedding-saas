# 03 - Authentication Security

## Password
- Hash with **argon2id** (recommended) or bcrypt with a cost factor ≥ 12.
- Minimum length of 8 characters, checked against a list of common/breached passwords (e.g., via the haveibeenpwned k-anonymity API) is recommended.
- No overly strict maximum length (allow long passphrases).

## Tokens
- **Access token (JWT)**: 15-minute expiry, signed with HS256/RS256 using a secret/key stored in a secret manager (not hard-coded/in an env file in the repo).
- **Refresh token**: a random 256-bit value, stored **hashed** (not plaintext) in the `refresh_tokens` table, sent via an `HttpOnly; Secure; SameSite=Lax` cookie.
- The refresh token **rotates on every use** — the old token is immediately marked `revoked_at`, and reuse is detected (if a revoked token is used again → indicates theft → revoke ALL of that user's active sessions).

## Login Rate Limiting
- Max 5 failed attempts per 15 minutes per (email, IP) combination → temporary lockout + CAPTCHA after the threshold, per SECURITY/10-ABUSE-PREVENTION.md.
- Generic login error message ("incorrect email or password") — does not distinguish an unregistered email from a wrong password (prevents user enumeration).

## Email Verification
- Verification token: random, 24-hour expiry, single-use.

## Password Reset
- Reset token: random, 1-hour expiry, single-use, invalidates all active sessions/refresh tokens after a successful reset (mitigation in case the account was already compromised previously).

## Google OAuth
- The `id_token` is verified directly with Google (server-side); NEVER trust the email from the request body without verifying the token.

## Admin Session
- 2FA (TOTP) is MANDATORY for the `admin`/`super_admin` role.
- Admin session expiry is shorter (e.g., 4 hours) than a regular user's, and re-authentication is required for highly sensitive actions (large refunds, suspending a user).

## Logging & Monitoring
- Log: consecutive failed logins, logins from a new location/device (optional email notification to the user), detected refresh token reuse — all treated as security events (see DEVOPS/06-LOGGING.md & 12-INCIDENT-RESPONSE.md).
