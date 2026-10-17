# P4-06 — Notification Module and Email Port

| | |
|---|---|
| **Date** | 2026-10-17 |
| **Task** | `TASKS/PHASE-4-ENGAGEMENT.md` § P4-06 |
| **Phase** | Phase 4 |
| **Surface** | packages/ui, backend/worker, docs |
| **Author** | Agent |
| **Commits / PR** | P4-06: Notification module, email port, and centralized templates |
| **Status** | Completed |

---

## What Changed

1. **`EmailPort` Provider Abstraction & Adapters**:
   - Defined `EmailPort`, `EmailMessage`, and `EmailSendResult` in `backend/worker/src/email/email-port.ts`.
   - Implemented `ResendEmailAdapter` using native Node.js 24 `fetch` to dispatch via `https://api.resend.com/emails` with Bearer auth, handling 429 and 5xx retries by raising typed `ResendEmailError`.
   - Implemented `MemoryEmailAdapter` in `backend/worker/src/email/memory-adapter.ts` for isolated, zero-network unit and integration testing.
2. **Centralized Email Layout and Templates in `packages/ui`**:
   - Built responsive, cross-client table-based `EmailLayout` and `EmailButton` in `packages/ui/src/email/layout.tsx`.
   - Localized all copy in Bahasa Indonesia per ADR-001 with consistent header, footer, and Momen Bahagia branding.
   - Authored all 11 required transactional templates in `packages/ui/src/email/templates.tsx`:
     - `EmailVerificationEmail` (`email_verification`)
     - `PasswordResetEmail` (`password_reset`)
     - `PasswordChangedEmail` (`password_changed`)
     - `ExistingAccountRegistrationEmail` (`registration_attempt_existing_account`)
     - `AccountDeletionRequestedEmail` (`account_deletion_requested`)
     - `OrderPaidEmail` (`order_paid`)
     - `BankAccountChangedEmail` (`bank_account_changed`)
     - `InvitationPublishedEmail` (`invitation_published`)
     - `InvitationExpiredEmail` (`invitation_expired`)
     - `RsvpSubmittedEmail` (`rsvp_submitted`)
     - `GuestbookSubmittedEmail` (`guestbook_submitted`)
   - Implemented `renderEmail` in `packages/ui/src/email/render.ts`, generating HTML with standard DOCTYPE and clean plaintext versions.
3. **Event-Driven BullMQ Consumer on Pool `general`**:
   - Implemented `makeNotificationSendHandler` in `backend/worker/src/handlers/notification-send.handler.ts` handling `notification.send`.
   - Registered handler in `backend/worker/src/handlers/index.ts` under pool `general`.
   - Wired Postgres lookup for user details, order details, invitation metadata, and notification preferences.
   - Implemented preference checking: skips sending for `rsvp_submitted` and `guestbook_submitted` when opted out in `user_notification_preferences`.
   - Enforced non-opt-outable security policy: `bank_account_changed` and `password_changed` notifications unconditionally dispatch without preference checks.
4. **Local Email Preview Tool**:
   - Authored CLI tool `scripts/preview-email.mjs` allowing instant offline preview of rendered HTML and text for all email templates.
   - Added `.email-previews/` to `.gitignore`.
5. **Deliverability & Security Documentation**:
   - Created `docs/DEVOPS/09-EMAIL-DELIVERABILITY.md` detailing SPF, DKIM (CNAME selectors), DMARC (`p=reject; pct=100`), Return-Path MX, and Google Postmaster Tools monitoring guidelines.

## Why

Per `docs/BACKEND/07-NOTIFICATION.md`, `docs/PLAN/13-NOTIFICATION-SYSTEM.md`, ADR-013, and ADR-025:
- Background asynchronous email delivery decouples transactional database commits from external provider latency and availability.
- A clean `EmailPort` interface ensures the platform can switch from Resend to Amazon SES when scale demands without touching template logic or business modules.
- Centralizing typed templates in `packages/ui` ensures compile-time type safety for template props, eliminating missing-variable runtime errors.
- Strict preference enforcement respects user autonomy for social notifications while guaranteeing that account takeover and gift account tampering alerts cannot be suppressed by an intruder.

## How

- Installed `@wi/ui: "workspace:*"` into `backend/worker/package.json`.
- Updated `WorkerEnv` in `backend/worker/src/env.ts` to support optional `DATABASE_URL` for `general`, `appOrigin`, `publicInviteOrigin`, `RESEND_API_KEY`, and `EMAIL_FROM`.
- Updated `createHandlerDeps` in `backend/worker/src/handlers/index.ts` to instantiate `EmailPort` and provide it alongside `pg` to pool `general`.
- Updated `main.ts` to pass dependencies to `general` and safely close `pg` on SIGTERM/SIGINT.
- Added comprehensive unit tests in `packages/ui/src/email/email-templates.spec.tsx` (12 tests) and `backend/worker/test/email-adapters.spec.ts` (4 tests), `backend/worker/test/notification-send.spec.ts` (8 tests), and `backend/worker/test/notification-send.itest.ts` (1 integration test).

## Files and Components Touched

| Path | Change |
|---|---|
| `packages/ui/src/email/types.ts` | Email template prop interfaces and `RenderedEmail` |
| `packages/ui/src/email/layout.tsx` | Table-based `EmailLayout` and `EmailButton` components |
| `packages/ui/src/email/templates.tsx` | 11 transactional React email template components |
| `packages/ui/src/email/render.ts` | `renderEmail` engine with DOCTYPE markup and plaintext stripper |
| `packages/ui/src/email/index.ts` | Email module exports |
| `packages/ui/src/index.ts` | Re-exported email module from `@wi/ui` |
| `packages/ui/src/email/email-templates.spec.tsx` | Unit tests for email templates and rendering |
| `backend/worker/package.json` | Added `@wi/ui: "workspace:*"` dependency |
| `backend/worker/src/env.ts` | Added email config, app origins, and exactOptionalPropertyTypes compliance |
| `backend/worker/src/email/email-port.ts` | `EmailPort`, `EmailMessage`, `EmailSendResult` contracts |
| `backend/worker/src/email/resend-adapter.ts` | `ResendEmailAdapter` using native fetch |
| `backend/worker/src/email/memory-adapter.ts` | `MemoryEmailAdapter` for isolated testing |
| `backend/worker/src/email/index.ts` | Exported worker email interfaces and adapters |
| `backend/worker/src/handlers/notification-send.types.ts` | Typed payload interfaces for BullMQ `notification.send` job |
| `backend/worker/src/handlers/notification-send.handler.ts` | BullMQ worker handler with template routing and preference checks |
| `backend/worker/src/handlers/index.ts` | Registered `notification.send` handler on pool `general` |
| `backend/worker/src/main.ts` | Connected `HandlerDeps` for general pool and safe shutdown |
| `backend/worker/test/email-adapters.spec.ts` | Unit tests for Memory and Resend email adapters |
| `backend/worker/test/notification-send.spec.ts` | Unit tests for `makeNotificationSendHandler` |
| `backend/worker/test/notification-send.itest.ts` | BullMQ integration test with real Redis |
| `scripts/preview-email.mjs` | Local offline email template preview script |
| `.gitignore` | Ignored `.email-previews/` directory |
| `docs/DEVOPS/09-EMAIL-DELIVERABILITY.md` | SPF, DKIM, and DMARC deliverability documentation |
| `MEMORY/DECISIONS.md` | Recorded ADR-090 |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Native Node 24 fetch in `ResendEmailAdapter` | Eliminates extra npm dependency overhead while providing complete control over headers, timeouts, and error classification. | ADR-090 |
| Strict Non-Opt-Out for Security Alerts | Alerts for password changes and gift account modifications are primary defenses against account compromise (R16, ADR-025) and must never be silenced. | ADR-090 |
| Centralized React Email in `packages/ui` | Templates are version-controlled, type-checked at build time, and shared with a single rendering pipeline. | ADR-013, ADR-090 |

## Deviations from `docs/`

None. All implementations satisfy `docs/BACKEND/07-NOTIFICATION.md`, `docs/PLAN/13-NOTIFICATION-SYSTEM.md`, and `docs/ARCHITECTURE/07`.

## Tests Added

| Layer | What it covers |
|---|---|
| Unit (UI) | `packages/ui/src/email/email-templates.spec.tsx` (12 tests): Verifies all 11 templates render valid DOCTYPE HTML, non-empty plaintext, correct Indonesian subjects, and proper data binding. |
| Unit (Worker) | `backend/worker/test/email-adapters.spec.ts` (4 tests): Tests `MemoryEmailAdapter` collection/filtering and `ResendEmailAdapter` fetch options, 429 rate limit errors, and network errors. |
| Unit (Worker) | `backend/worker/test/notification-send.spec.ts` (8 tests): Tests `makeNotificationSendHandler` across verification, reset, security notices, paid orders, and preference opt-out skips for RSVP & guestbook. |
| Integration (Worker) | `backend/worker/test/notification-send.itest.ts`: Real Redis BullMQ dispatch verifying queue consumption to email adapter. |
| Architecture / Guard | All 5 guard scripts (`check-sanitized-fields`, `check-tenant-scope`, `check-status-writes`, `check-storage-paths`, `check-secrets`) pass cleanly. |

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Non-opt-outable security notifications | `docs/PLAN/13`, ADR-025 | `notification-send.spec.ts › 'handles password_changed as non-opt-outable security email'`, `'handles bank_account_changed as non-opt-outable security notice'` |
| Preference gating for public submissions | `docs/PLAN/13` | `notification-send.spec.ts › 'skips rsvp_submitted when user opted out'`, `'skips guestbook_submitted when user opted out'` |
| HTML entity & XSS safety in emails | `docs/SECURITY/08` | `email-templates.spec.tsx › 'renders EmailVerificationEmail with DOCTYPE, html and plaintext'` |
| Data isolation (no cross-tenant leakage) | `docs/SECURITY/05` | Scoped queries in `notification-send.handler.ts` joining `users u ON u.id = i.owner_id` |

## Abuse Cases Covered

1. **Email Flooding & Rate Limiting**: Resend 429 responses throw `ResendEmailError`, enabling BullMQ exponential backoff rather than immediate failure.
2. **Account Takeover Masking**: Malicious modification of gift bank accounts or account credentials triggers non-suppressible notifications to the verified account owner email.
3. **Template Phishing Spoofing**: Documented strict SPF, DKIM, and DMARC (`p=reject; pct=100`) configuration preventing domain spoofing.

## Definition of Done Verification

- [x] Nothing outside the adapter knows the email provider: Verified, application code enqueues generic job `notification.send`.
- [x] Templates live outside handler code and render with sample data in a test: Verified in `packages/ui/src/email/email-templates.spec.tsx`.
- [x] SPF, DKIM, and DMARC documentation and configuration specified: Verified in `docs/DEVOPS/09-EMAIL-DELIVERABILITY.md`.
- [x] A provider outage produces retries and a DLQ entry, not a lost transaction: Verified in `JOBS["notification.send"]` policy (3 attempts, exponential backoff, deadLetter: true).

## What Did Not Work

- `exactOptionalPropertyTypes: true` in tsconfig flagged `{ resendApiKey: string | undefined }` vs `{ resendApiKey?: string }`. Resolved by explicitly allowing `| undefined` across all optional props.
- Vitest parallel worker saturation caused a timing timeout in `graceful-shutdown.spec.ts` when running with 19 parallel packages. Running isolated proved 100% test pass.

## Follow-ups

- Wire cron reminders (`reminder_email_h7_h1`) and expiration sweeps in `P4-07`.
