# P5-14 — Admin session provenance security review and correction

| | |
|---|---|
| Date | 2026-11-25 |
| Task / phase | P5-14 preparation, Phase 5 |
| Surface / author | API, database, tests, documentation; coding agents in parallel at the owner's request |
| Commits / PR | Uncommitted continuation on feat/P5-10-admin-completion |
| Status | Security correction implemented; Phase 5 acceptance incomplete, not DONE |

## What Changed

Reviewed the admin authentication bypass reported during P5-10–13. Password login already challenged admins, but Google directly issued a session and refresh rows had no record of factor verification. The correction applies a common login challenge, signed access-token proof and persisted refresh provenance. Legacy administrative sessions must complete MFA again after rollout.

Parallel review also added a safe invitation completeness summary, pending blocklist form locks, and Next parallel-slot recognition in the public route reservation gate. Their implementation evidence remains in the individual P5-10–13 records.

## Why

SECURITY/03 § Admin Session requires MFA for administrators, including all authentication and rotation paths. SECURITY/05 and P5-14 require bounded administrative authority. A confirmed factor only proves enrollment; it does not prove that a particular session passed MFA.

## How

`issueLogin` challenges both password and Google administrators. Direct administrative session issuance rejects a missing factor timestamp. Only the two successful MFA controller paths call the proof-bearing by-user-ID session method. Access-token verification validates the optional timestamp and session authentication requires fresh proof against the current database role, blocking promotion of an old ordinary session. Account state is rechecked including soft deletion.

Migration 0018 adds nullable `refresh_tokens.mfa_verified_at`, without backfilling old rows. Rotation retains this original value and clamps successors to four hours after verification. Invalid admin refresh successors are revoked. Ordinary login keeps its existing lifetime. The fresh Testcontainers harness now creates the application role before migration 0006, only in its newly created disposable container; external roles are untouched.

## Files and Components Touched

| Files | Change |
|---|---|
| `backend/api/src/modules/auth/login.service.ts`, `session.service.ts`, `auth.controller.ts`, `oauth/google-oauth.service.ts` | Shared challenge gate, proof issuance/enforcement, current-role checks |
| `backend/api/src/modules/auth/tokens/access-token.service.ts`, `refresh-token.service.ts` | Signed claim validation, persisted proof and expiry-preserving rotation |
| `backend/api/src/infra/db/schema/users.ts`, `backend/api/migrations/0018_admin_session_mfa.sql`, matching `.down.sql`, `meta/_journal.json` | Additive nullable provenance column and development rollback |
| `backend/api/test/admin-mfa-session.spec.ts` | Claims, role promotion, Google challenge, issuance and rotation regression cases |
| `backend/api/test/integration/admin-mfa-session.itest.ts` | Real DB rotation, legacy refresh, promotion and Google challenge scenarios |
| `backend/api/test/integration/google-oauth.itest.ts` | Explicitly narrow ordinary-user sessions in existing fixtures |
| `backend/api/test/support/harness.ts` | Disposable-container application role bootstrap |
| `docs/API/01-AUTHENTICATION.md`, `docs/DATABASE/02-USERS.md`, `docs/SECURITY/03-AUTHENTICATION-SECURITY.md` | Record proof semantics and rollout requirement |
| `docs/API/09-ADMIN-API.md` | Safe invitation completeness summary contract from parallel review |
| `MEMORY/specs/P5-14-admin-session-provenance.md`, `MEMORY/DECISIONS.md`, this record, index, changelog | Spec, ADR-106 and evidence |
| `TASKS/PROGRESS.md`, `TASKS/PHASE-5-ADMIN-PANEL.md`, `TASKS/BACKLOG.md`, `.agents/ck/CONTEXT.md`, `.agents/ck/context.json` | Honest review status and durable checkpoint |

## Decisions Made

ADR-106 persists proof in the session rather than inferring it from enrollment or caching it. The four-hour absolute lifetime implements the existing admin-session requirement. A separate login is required after migration for old admin sessions. No production migration or deployment was performed.

## Deviations from docs/

No change to the required permission model. API/01 and DATABASE/02 now document the missing enforcement details; SECURITY/03 explicitly covers Google and role promotion. No payment-state, upload, pricing or invitation-content mutation was added.

## Tests Added and Execution

| Layer | Evidence |
|---|---|
| Unit/security | `admin-mfa-session.spec.ts`: 18 cases, including actual rotation code with transaction stub; final execution result recorded below when available |
| Integration | `admin-mfa-session.itest.ts`: four real PostgreSQL scenarios; execution is required before certification |
| Existing regressions | Google fixtures narrowed without assuming an administrator receives a session before MFA |
| Types | API `tsc --noEmit` passed after production changes and the new unit file; final integration-file check remains required |
| Static gates | Migration pairs/destructive gate, tenant scope, status writes, sanitization, route reservations, token storage, generic renderer, text/design-token and logger gates passed. The pre-existing OrdersPage mock price literals still fail the price gate. Secret scanner without `--all` reports zero files and is not secret-scan evidence. |
| Full suite | Windows `pnpm verify` invoked WSL bash without node; this attempt failed before checks. Fork/threads workers later stalled under host load; these are not passing tests. A serial Node 24 run was started because default node is 26. |
| Browser/E2E | In-app browser bootstrap failed with missing `sandboxPolicy`; no visual verification or Phase 5 E2E completion is claimed |

## Security Verification

The following are named regression tests, not a claim they have passed until execution succeeds:

| Control | Requirement / test |
|---|---|
| Mandatory session MFA | SECURITY/03; `requires MFA for a returning Google administrator before issuing any credentials`; `refuses direct ... session issuance without MFA` |
| Current-role enforcement | SECURITY/04; `rejects ... access without proof even after role promotion`; integration `cannot promote a pre-MFA user session through access or refresh` |
| Proof integrity and expiry | SECURITY/03; `rejects malformed or future signed MFA claim`; `accepts fresh signed proof and rejects proof at the absolute four-hour limit` |
| Rotation cannot prolong privilege | SECURITY/03; `persists original MFA proof and clamps a real refresh rotation to its absolute expiry`; integration `preserves the original MFA proof and expiry through two real database rotations` |
| Legacy unverified sessions | SECURITY/03; `revokes an unverified or expired admin refresh successor`; integration `rejects legacy administrator refresh rows without MFA provenance` |
| Payment / upload / free-text storage | Not applicable: no payment decisions, upload pipeline, or stored text fields changed |

## Abuse Cases Covered

Tests address promotion of pre-MFA sessions, administrative OAuth bypass, malformed/future signed provenance, expired proof, unverified legacy refresh and extending MFA lifetime through repeated rotation. Existing factor/TOTP/step-up suites must also remain green; this record does not replace their coverage.

## Definition of Done Verification

Implementation and named tests exist. API typecheck and the listed static gates passed. No new resource-ID endpoint was introduced. Phase-specific no-deploy template flow, moderation E2E, exhaustive write-audit counts, full privilege sweep and rendered QA remain outstanding. Global full tests/build/integration/dependency audit/SAST are not certified. P5-10–13 remain REVIEW; P5-14 remains blocked and the phase completion count does not increase. No unmet gate was waived.

## What Did Not Work

`rtk Get-Content` cannot invoke a PowerShell builtin directly; bounded reads used proxy commands. Native pnpm verify picked WSL bash without node. The default host node is 26.10.0; a local Node 24.18.0 was found and used for serial verification. Parallel test worker startup stalled, and retries did not prove assertions; only known task-owned processes were stopped. The in-app browser could not initialize. No council/evaluator or strategic-compaction tool was available; a durable checkpoint was written instead.

## Follow-Ups and Open Questions

P5-14 owns the remaining acceptance criteria, including complete audit counts and template/moderation E2E. BACKLOG records price/provider-boundary regressions, verification environment and visual QA. P0-17 still owns deferred CI/security scanning. Apply migration 0018 before running the new API and require administrators to sign in again.

## What to Watch

Admin 401/refresh rejection rates will initially rise as legacy sessions are replaced. Four-hour session expiry is absolute, not sliding. Migration omission produces a missing-column error in refresh issuance; deployment ordering must include it. Do not interpret factor enrollment as permission to remove the new proof checks.
