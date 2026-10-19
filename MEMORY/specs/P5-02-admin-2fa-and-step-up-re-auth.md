# P5-02 — Feature Spec: Admin 2FA (TOTP) and Step-Up Re-Authentication

| | |
|---|---|
| **Task** | `P5-02` |
| **Date** | 2026-10-19 |
| **Author** | Agent |
| **Status** | Reviewed |

---

## 1. Goal

Implement mandatory Two-Factor Authentication (TOTP, RFC 6238) for all administrative accounts (`admin`, `super_admin`) and step-up re-authentication for high-impact administrative actions (manual refunds, user suspensions). This ensures that compromised administrative passwords cannot grant access to tenant data, financial workflows, or platform configuration (`docs/SECURITY/03`, `docs/PLAN/12`).

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/SECURITY/03-AUTHENTICATION-SECURITY.md` | § Admin Session | 2FA (TOTP) is mandatory for `admin`/`super_admin`; re-authentication required for sensitive actions |
| `docs/DATABASE/02-DATABASE-SCHEMA.md` | § Multi-Factor Authentication Tables | Schema for `user_mfa_factors` and `user_recovery_codes` |
| `docs/PLAN/12-ADMIN-PANEL.md` | § Access Control | Mandatory 2FA, unenrolled admin can only reach enrollment, no bypass |
| `docs/SECURITY/01-THREAT-MODEL.md` | § Admin Panel | Admin account takeover threat mitigation |
| `MEMORY/DECISIONS.md` | ADR-020 | Recovery codes hashed, partial unique index allowing abandoned enrollment retry |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-MFA.1 | Admin and super_admin logins MUST complete TOTP verification before receiving an admin access token | `AuthService.login`, `MfaService.verifyTotp` |
| BR-MFA.2 | Unenrolled admins MUST enroll in TOTP before accessing any admin panel features | `RequireAdmin.tsx`, backend route guards |
| BR-MFA.3 | TOTP secrets MUST be encrypted at rest using AES-256-GCM | `MfaService`, `CryptoService` |
| BR-MFA.4 | Recovery codes MUST be single-use and stored hashed | `user_recovery_codes`, `MfaService.useRecoveryCode` |
| BR-MFA.5 | High-impact actions (refunds, suspensions) require fresh step-up re-authentication within 10 minutes | Step-up guard, admin controllers |
| BR-MFA.6 | Failed TOTP attempts MUST be rate limited and audited | Rate limiter, security logger |

## 4. API Contract & Integration

1. `POST /api/v1/auth/login`:
   - For `admin`/`super_admin`: if 2FA active, returns `{ requires_mfa: true, mfa_ticket: string }`.
   - If unenrolled: returns `{ requires_mfa_setup: true, setup_ticket: string }`.
2. `POST /api/v1/auth/mfa/setup`:
   - Requires valid `setup_ticket` or active session.
   - Returns `{ secret: string, qr_uri: string, recovery_codes: string[] }`.
   - Stores unconfirmed factor in `user_mfa_factors` (`confirmed_at = NULL`).
3. `POST /api/v1/auth/mfa/confirm`:
   - Body: `{ code: string }`.
   - Validates TOTP code against secret.
   - Sets `confirmed_at = NOW()`, hashes & stores recovery codes in `user_recovery_codes`.
   - Returns full admin access token.
4. `POST /api/v1/auth/mfa/verify`:
   - Body: `{ mfa_ticket: string, code?: string, recovery_code?: string }`.
   - Validates 6-digit TOTP code or single-use recovery code.
   - On success: marks recovery code as used (if used), issues standard 4-hour admin access token.
5. `POST /api/v1/auth/mfa/step-up`:
   - Headers: `Authorization: Bearer <admin_token>`.
   - Body: `{ code: string }`.
   - Verifies TOTP code and issues a 10-minute step-up token / updates session claim.

## 5. Data Model Impact

Uses existing tables seeded in Phase 0:
- `user_mfa_factors`: `user_id`, `type = 'totp'`, `secret_encrypted` (bytea, AES-256-GCM), `confirmed_at`, `last_used_at`.
- `user_recovery_codes`: `user_id`, `code_hash` (argon2id or sha256), `used_at`.

Migration required: No. Schema was defined in `backend/api/src/infra/db/schema/users.ts`.

## 6. Authorization

- Unenrolled admin accounts have restricted capabilities: they can only access `/api/v1/auth/mfa/setup` and `/api/v1/auth/mfa/confirm`.
- High-impact endpoints inspect step-up status; if older than 10 minutes, request is rejected with HTTP 403 `MFA_STEP_UP_REQUIRED`.

## 7. Abuse Cases

| Abuse case | Expected behaviour |
|---|---|
| Brute forcing 6-digit TOTP code | Rate limited after 5 failed attempts per 15 minutes; logged as security event |
| Reusing an already-used recovery code | Immediate rejection; marked `used_at` checked in SQL query |
| Database dump leakage | TOTP secrets remain encrypted with application-layer AES-256-GCM |
| Admin performing refund without recent step-up | HTTP 403 `MFA_STEP_UP_REQUIRED` |
| Abandoned enrollment retry | Partial index allows new enrollment attempt; old unconfirmed factor replaced |

## 8. Test Plan

- Unit & integration tests for TOTP RFC 6238 generation, drift handling (±1 step, 30s window), and AES-256-GCM encryption/decryption.
- Unit tests for step-up verification timeout (10-minute validity).
- Recovery code generation, verification, and single-use invalidation.
- Frontend test: Admin login MFA challenge, enrollment flow with recovery codes, and step-up modal.
