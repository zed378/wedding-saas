# P4-07 — Transactional Email Wiring

| | |
|---|---|
| **Date** | 2026-10-17 |
| **Task** | `TASKS/PHASE-4-ENGAGEMENT.md` § P4-07 |
| **Phase** | Phase 4 |
| **Surface** | worker, backend, packages/ui |
| **Author** | Agent |
| **Commits / PR** | `P4-07: transactional email wiring` |
| **Status** | Completed |

---

## What Changed

1. Completed transactional email wiring for all notification types from `docs/PLAN/13-NOTIFICATION-SYSTEM.md` and `docs/PLAN/02` § BR-9:
   - Added `invitation_expiry_reminder` email template and handler for H-7 and H-1 expiry notices with actionable renewal links.
   - Added `invitation_retention_warning` email template and handler for the three deletion warnings required by BR-9.1 during the 90-day expired window (Day 30 with 60 days remaining, Day 60 with 30 days remaining, Day 83 with 7 days remaining before soft-delete).
   - Added `order_refunded` email template and handler for admin-processed refunds with formatted amount and optional reason.
2. Implemented `reminder_email_h7_h1` daily scheduled sweep at 08:00 WIB in `InvitationReminderService` (`backend/api/src/modules/publishing/invitation-reminder.service.ts`), wired into `backend/api/src/jobs/domain-jobs.ts`. It generates idempotent BullMQ jobs with key `invitation.reminder:${daysRemaining}:${item.id}:${item.expiryDate}`, guaranteeing zero duplicate emails on double runs.
3. Implemented `sweepRetentionWarnings` in `InvitationRetentionService` (`backend/api/src/modules/invitation/invitation-retention.service.ts`), evaluating expired invitations at days 30, 60, and 83 with idempotent keys `invitation.retention_warning:${warningNumber}:${item.id}`.
4. Added email attachment support to `EmailPort` and `ResendEmailAdapter` (base64 serialized). In `order_paid`, if an invoice row exists in `invoices` table (`P3-08`), the invoice PDF is attached directly to the payment confirmation email alongside the invoice download URL.
5. Decoupled server-side email rendering via `@wi/ui/email` subpath export in `packages/ui/package.json` and `packages/ui/src/index.ts` (`export type * from "./email/types.js"`), preventing Next.js Turbopack client component SSR bundle contamination from `react-dom/server`.

---

## Why

- `docs/PLAN/13-NOTIFICATION-SYSTEM.md` defines the complete table of transactional notifications required for production launch.
- `docs/BACKEND/08-JOBS-WORKERS.md` lists `reminder_email_h7_h1` as a daily 08:00 WIB scheduled job to remind couples that their public invitation is about to lapse.
- `docs/PLAN/02-BUSINESS-RULES.md` § BR-9.1 requires 3 notifications sent to the user before deletion during the 90-day expiry retention window.
- `P4-07` task card requires actionable links, idempotent sweep re-runs, and invoice attachment with payment confirmation.

---

## How

1. **Email Templates in `packages/ui`**:
   - Implemented `InvitationExpiryReminderEmail`, `InvitationRetentionWarningEmail`, and `OrderRefundedEmail` with semantic inline styling, accessible colors, and Indonesian copy per ADR-001.
   - Registered all 14 templates in `renderEmail` engine with clean plaintext extraction.
2. **Subpath Export Decoupling (ADR-091)**:
   - Configured `"./email"` in `packages/ui/package.json` pointing to `./dist/email/index.js`.
   - Replaced root runtime re-export in `packages/ui/src/index.ts` with `export type * from "./email/types.js"`. This ensures `@wi/ui` root remains safe for client components in Next.js without pulling in `react-dom/server`.
3. **Attachment Handling**:
   - Extended `EmailPort` with optional `attachments?: readonly EmailAttachment[]`.
   - Updated `ResendEmailAdapter` to encode Buffer contents as base64 in the Resend API payload.
   - Updated `order_paid` handler in `notification-send.handler.ts` to query `invoices` table and attach the PDF binary when available.
4. **Idempotent Reminder & Retention Sweeps**:
   - `InvitationRepository.invitationsExpiringInDays(days: [7, 1])` queries published invitations where `expiry_date` matches today + 7 days or today + 1 day in WIB.
   - `InvitationRepository.expiredInvitationsForRetentionWarning(daysExpired: [30, 60, 83])` queries expired invitations at milestone days.
   - `InvitationReminderService` and `InvitationRetentionService` enqueue jobs with BullMQ `idempotencyKey` / `jobId` so repeat runs are safe no-ops.

---

## Files and Components Touched

| Path | Change |
|---|---|
| `packages/ui/package.json` | Added `./email` subpath export |
| `packages/ui/src/index.ts` | Exported email types only to prevent client component bundler errors |
| `packages/ui/src/email/types.ts` | Added props and template keys for expiry reminder, retention warning, and refund |
| `packages/ui/src/email/templates.tsx` | Implemented reminder, retention warning, and refund email components |
| `packages/ui/src/email/render.ts` | Added overloads and render cases for 3 new email templates |
| `packages/ui/src/email/email-templates.spec.tsx` | Added unit tests for new templates, long names, and missing optionals |
| `backend/worker/src/email/email-port.ts` | Added `EmailAttachment` interface and `attachments` field |
| `backend/worker/src/email/resend-adapter.ts` | Implemented attachment serialization to Resend API format |
| `backend/worker/src/handlers/notification-send.types.ts` | Added payload types for reminder, retention warning, and refund |
| `backend/worker/src/handlers/notification-send.handler.ts` | Implemented new template handlers and invoice PDF attachment |
| `backend/worker/test/email-adapters.spec.ts` | Added unit test for attachment serialization |
| `backend/worker/test/notification-send.spec.ts` | Added unit tests for invoice attachment, reminder, retention warning, and refund |
| `backend/api/src/infra/queue/queue.module.ts` | Passed `jobId: options.idempotencyKey` for BullMQ deduplication |
| `backend/api/src/shared/tenancy/invitation-repository.ts` | Added `invitationsExpiringInDays` and `expiredInvitationsForRetentionWarning` |
| `backend/api/src/modules/publishing/invitation-reminder.service.ts` | Implemented `InvitationReminderService` for H-7 and H-1 sweeps |
| `backend/api/src/modules/publishing/publishing.module.ts` | Registered `InvitationReminderService` provider and export |
| `backend/api/src/modules/invitation/invitation-retention.service.ts` | Added `sweepRetentionWarnings` for Day 30, 60, and 83 notifications |
| `backend/api/src/jobs/domain-jobs.ts` | Wired `reminder_email_h7_h1` into domain jobs table |
| `backend/api/test/invitation-reminder.spec.ts` | Unit tests for reminder sweep and idempotency |
| `backend/api/test/invitation-retention-warning.spec.ts` | Unit tests for 3 retention warnings |
| `scripts/preview-email.mjs` | Added sample props for previewing all 14 transactional email templates |

---

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Subpath export `@wi/ui/email` | Next.js 16 Turbopack disallows `react-dom/server` inside client component dependencies. Subpath export separates server-side email rendering while keeping `@wi/ui` pure chrome. | ADR-091 |
| 3 Retention Warning Intervals (Days 30, 60, 83) | BR-9.1 requires 3 warnings during the 90-day expired retention window. Day 30 (60 days left), Day 60 (30 days left), and Day 83 (7 days left before soft-delete) provide balanced notice intervals without spamming. | ADR-091 |
| Native BullMQ `jobId` deduplication | Passing `idempotencyKey` as BullMQ `jobId` natively drops duplicate jobs enqueued within the deduplication window. | ADR-091 |

---

## Deviations from `docs/`

None. All implementations match `docs/PLAN/13-NOTIFICATION-SYSTEM.md`, `docs/BACKEND/08-JOBS-WORKERS.md`, and `docs/PLAN/02-BUSINESS-RULES.md` § BR-9.1.

---

## Tests Added

| Layer | What it covers |
|---|---|
| Unit (`@wi/ui`) | All 14 email templates rendering, long name handling, missing optionals (`email-templates.spec.tsx`) |
| Unit (`@wi/worker`) | Handler tests for reminder, retention warning, refund, invoice PDF attachment (`notification-send.spec.ts`) |
| Unit (`@wi/worker`) | Attachment serialization in `ResendEmailAdapter` (`email-adapters.spec.ts`) |
| Unit (`@wi/api`) | H-7 and H-1 reminder sweep and idempotency verification (`invitation-reminder.spec.ts`) |
| Unit (`@wi/api`) | 3 retention warnings sweep with countdown and idempotency (`invitation-retention-warning.spec.ts`) |
| Unit (`@wi/api`) | Worker catalogue verification for `reminder_email_h7_h1` (`domain-jobs.spec.ts`) |

---

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Object-level authorization & privacy | `docs/SECURITY/05` | `backend/worker/test/notification-send.spec.ts` (renders only recipient's data, uses scoped queries) |
| Non-opt-outable security emails | `docs/SECURITY/03`, ADR-025 | `backend/worker/test/notification-send.spec.ts` (verifies bank account & password changes have no opt-out) |
| Preference gating for RSVP & guestbook | `docs/PLAN/13` § Preferences | `backend/worker/test/notification-send.spec.ts` (verifies opt-out skips send) |
| Idempotency on payment & reminder emails | `docs/BACKEND/08` | `backend/api/test/invitation-reminder.spec.ts` and `invitation-retention-warning.spec.ts` |

---

## Definition of Done Verification

- [x] Every notification in `docs/PLAN/13`'s table is implemented and tested.
- [x] Reminder jobs are idempotent; a double run sends one email.
- [x] Deletion warnings send at the defined points before data loss (Days 30, 60, 83).
- [x] No email leaks another user's data; templates render only the recipient's own information.
- [x] Invoice PDF is attached to payment confirmation when available.
- [x] `pnpm typecheck` green (19/19 packages).
- [x] `pnpm build` green (all apps and packages compiled).
- [x] All 13 repository guard checks passed (`check-tenant-scope`, `check-status-writes`, `check-storage-paths`, `check-secrets`, etc.).

---

## Follow-Ups and Open Questions

None. Ready for Phase 4 completion and moving to Phase 5 (Admin Panel).
