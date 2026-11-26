# P5-14 — Admin session MFA provenance

Date: 2026-11-25. Implements SECURITY/03 mandatory admin MFA and P5-14 bypass acceptance; no new product permission or endpoint.

Admin access tokens must carry a signed MFA verification timestamp. Session authentication checks this against the current database role, so promoting a user cannot promote their existing session. Password and Google logins return the existing MFA challenge/setup response before any admin session is issued. Only successful factor confirmation/verification may issue a session with this proof.

Refresh rows gain nullable `mfa_verified_at`. Issuance after MFA records the timestamp, rotation preserves it, and admin refresh rejects legacy/unverified rows or proof older than four hours. Rotation cannot extend this absolute admin session lifetime. Ordinary user sessions retain the existing behavior. Old admin access and refresh tokens require a new MFA login after rollout.

Tests: signed claim round-trip and malformed claims; authentication rejects admin without proof including role promotion; issuance refuses admin without MFA; Google admin challenge; refresh propagation and expiration; existing MFA and ordinary-user login/rotation suites. Integration uses an isolated PostgreSQL database. No secrets or codes are logged. Migration is additive and has a development rollback.

Files: auth access-token, session/login/Google/controller modules; refresh token schema/service; migration 0018 and journal; auth tests; DATABASE/02 and API/01 security session notes. Full phase acceptance additionally needs no-deploy template/moderation E2E and exhaustive write-audit counts; these are not implied by session tests.
