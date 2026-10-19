# P4-08 — Notification Preferences and Delivery Monitoring

| | |
|---|---|
| **Date** | 2026-10-19 |
| **Task** | `TASKS/PHASE-4-ENGAGEMENT.md` § P4-08 |
| **Phase** | Phase 4 |
| **Surface** | backend, worker, packages/ui |
| **Author** | Agent |
| **Commits / PR** | P4-08: notification preferences, RSVP digest, and email delivery monitoring |
| **Status** | Completed |

---

## What Changed

1. **User Notification Preferences & RSVP Daily Digest Alternative (`rsvp_digest`)**:
   - Added `rsvp_digest` boolean column to `user_notification_preferences` (migration `0016_notification_digest_and_bounces.sql`), defaulting to false.
   - Updated `user.controller.ts` and `user.service.ts` to allow users to get and update `rsvp_digest` alongside `rsvp_email`, `guestbook_email`, and `marketing_email`.
   - Implemented `RsvpDigestService` in `backend/api/src/modules/rsvp/rsvp-digest.service.ts` to aggregate RSVP responses over the preceding 24 hours into a single morning summary email (`rsvp_daily_digest`).
   - Added daily scheduled job `rsvp_daily_digest` at 09:00 WIB in `backend/api/src/jobs/domain-jobs.ts`.
   - Authored `RsvpDailyDigestEmail` React Email template in `packages/ui/src/email/templates.tsx` and exported via `@wi/ui/email`.
2. **Email Delivery Monitoring & Bounce Suppression (`email_bounces`)**:
   - Created `email_bounces` table in `backend/api/src/infra/db/schema/users.ts` with columns `email`, `bounce_type` (`hard_bounce`, `complaint`, `transient`), `provider`, `provider_email_id`, `message`, and timestamps.
   - Implemented `EmailBounceService` in `backend/api/src/modules/notification/email-bounce.service.ts` with `recordBounce()` and `isSuppressed()`.
   - Implemented `EmailWebhookController` at `POST /api/webhooks/email/:provider` to ingest delivery webhooks from providers (Resend, simulated).
   - Exempted `/api/webhooks/email` from rate limiting in `policies.ts` as an external provider callback surface.
   - Suppresses subsequent sends to addresses flagged with hard bounces or spam complaints.
3. **Dead-Letter Queue (DLQ) Alerting**:
   - Implemented `DlqMonitorService` in `backend/api/src/modules/notification/dlq-monitor.service.ts` to inspect the `dead-letter` queue.
   - Added Prometheus metric `wi_notification_dead_letter_total{template}` and alert rule `CriticalEmailDeadLettered` in `deploy/prometheus/alerts.yml` triggering when critical transactional emails (`order_paid`, `email_verification`, `password_reset`, `bank_account_changed`) permanently fail delivery.
4. **Strict Preference Gating vs Mandatory Security Alerts**:
   - `rsvp_submitted` and `guestbook_submitted` strictly respect `user_notification_preferences` (`rsvp_email`, `rsvp_digest`, `guestbook_email`).
   - Mandatory transactional emails (`order_paid`, `email_verification`, `password_reset`, `bank_account_changed`, `password_changed`) unconditionally bypass preference checks.

---

## Why

Per `docs/BACKEND/07-NOTIFICATION.md` § Preferences, `docs/DATABASE/02-USERS.md`, `docs/DEVOPS/07-ALERTING.md`, and `docs/PLAN/13-NOTIFICATION-SYSTEM.md`:
- Wedding invitation owners need granular control over social notifications to avoid inbox fatigue (especially for large weddings with hundreds of RSVPs), while retaining the option for a daily consolidated digest.
- High bounce rates and spam complaints damage sender domain reputation (IP/domain deliverability on Google/Yahoo/Microsoft). Automated suppression of hard bounces and complaints protects domain health.
- Silent delivery failures of critical transactional emails (such as payment receipts and security alerts) must immediately alert engineering rather than going unnoticed.

---

## How

1. **Schema & Migration**:
   - Migration `0016_notification_digest_and_bounces.sql` alters `user_notification_preferences` adding `rsvp_digest boolean DEFAULT false NOT NULL` and creates table `email_bounces`.
   - Migration down script `0016_notification_digest_and_bounces.down.sql` drops table and column cleanly.
2. **Preference Routing**:
   - In `backend/worker/src/handlers/notification-send.handler.ts`:
     - If `rsvp_email` is false, per-submission RSVP emails are skipped.
     - If `rsvp_digest` is true, per-submission RSVP emails are skipped in favor of the 09:00 WIB daily digest.
     - If `guestbook_email` is false, guestbook submission emails are skipped.
     - Mandatory notifications (`order_paid`, `email_verification`, `password_reset`, `bank_account_changed`, `password_changed`) never query or respect preferences.
3. **Provider Webhook**:
   - `POST /api/webhooks/email/:provider` accepts Resend event payloads (`email.bounced`, `email.complained`, `email.delivered`) as well as simulated test payloads.
   - Hard bounces and complaints insert a suppression row and increment `wi_email_bounces_total`. Soft/transient bounces are logged but not permanently suppressed.
4. **Monitoring & Alerting**:
   - Added `EmailDeliveryBounceSpike` alert rule in `deploy/prometheus/alerts.yml` when bounce rate exceeds 5 in 10 minutes.
   - Added `CriticalEmailDeadLettered` alert rule when critical transactional emails enter DLQ.

---

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/migrations/0016_notification_digest_and_bounces.sql` | Migration adding `rsvp_digest` column and `email_bounces` table |
| `backend/api/migrations/0016_notification_digest_and_bounces.down.sql` | Rollback script for migration 0016 |
| `backend/api/migrations/meta/_journal.json` | Updated migration journal entry 16 |
| `backend/api/src/infra/db/schema/users.ts` | Added `rsvpDigest` to `userNotificationPreferences` and added `emailBounces` table |
| `backend/api/src/modules/user/user.controller.ts` | Added `rsvp_digest` to preferences DTO and controller |
| `backend/api/src/modules/user/user.service.ts` | Handled `rsvp_digest` updates in user preferences service |
| `backend/api/src/modules/rsvp/rsvp-digest.service.ts` | Daily RSVP digest aggregation and dispatch service |
| `backend/api/src/modules/rsvp/rsvp.module.ts` | Registered and exported `RsvpDigestService` |
| `backend/api/src/modules/notification/email-bounce.service.ts` | Email bounce recording, suppression check, and dead letter counter |
| `backend/api/src/modules/notification/email-webhook.controller.ts` | Webhook controller receiving provider bounce/complaint callbacks |
| `backend/api/src/modules/notification/email-webhook.service.ts` | Webhook parsing and normalization service |
| `backend/api/src/modules/notification/dlq-monitor.service.ts` | DLQ inspector for critical transactional email delivery failures |
| `backend/api/src/modules/notification/notification.module.ts` | Registered bounce service, webhook controller, and DLQ monitor |
| `backend/api/src/jobs/domain-jobs.ts` | Wired `rsvp_daily_digest` into scheduled domain jobs table |
| `backend/api/src/shared/metrics/metrics.ts` | Added `emailBounces` and `notificationDeadLetter` Prometheus counters |
| `backend/worker/src/handlers/notification-send.handler.ts` | Implemented `rsvp_digest` and suppression check; enforced mandatory bypass |
| `packages/ui/src/email/types.ts` | Added `RsvpDailyDigestEmailProps` |
| `packages/ui/src/email/templates.tsx` | Added `RsvpDailyDigestEmail` component |
| `packages/ui/src/email/render.ts` | Added render support for `rsvp_daily_digest` |
| `deploy/prometheus/alerts.yml` | Added alert rules for bounce spikes and dead-lettered critical emails |
| `backend/api/test/email-webhook.spec.ts` | Unit tests for bounce handling, suppression, and DLQ alert metrics |
| `backend/api/test/rsvp-digest.spec.ts` | Unit tests for daily RSVP digest aggregation |
| `backend/worker/test/notification-send.spec.ts` | Unit tests for preference gating and mandatory bypass |
| `MEMORY/DECISIONS.md` | Recorded ADR-092 |

---

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Daily RSVP digest at 09:00 WIB via `rsvp_digest` | Prevents email floods for popular weddings while keeping couples informed daily. | ADR-092 |
| `email_bounces` suppression table with provider tracking | Avoids sending to dead addresses, protecting sender reputation and avoiding blacklisting. | ADR-092 |
| Critical transactional notification DLQ alert | Guarantees visibility for failures in payment receipts and security alerts without alert fatigue. | ADR-092 |

---

## Deviations from `docs/`

None. Follows `docs/BACKEND/07-NOTIFICATION.md`, `docs/DATABASE/02-USERS.md`, `docs/DEVOPS/07-ALERTING.md`, and `docs/PLAN/13-NOTIFICATION-SYSTEM.md`.

---

## Tests Added

| Layer | What it covers |
|---|---|
| Unit (`backend/api/test/email-webhook.spec.ts`) | Hard bounce suppression, complaint recording, soft bounce filtering, simulated bounce, and DLQ metric increment. |
| Unit (`backend/api/test/rsvp-digest.spec.ts`) | Aggregation of 24h RSVPs, skipping non-digest owners, and queuing digest notification. |
| Unit (`backend/worker/test/notification-send.spec.ts`) | Preference toggle respected for RSVP and guestbook; mandatory notifications ignore preferences; DLQ error emission. |
| Unit (`packages/ui/src/email/email-templates.spec.tsx`) | Rendering of `rsvp_daily_digest` template with long names and single/multiple RSVPs. |

---

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Object-level authorization (404 for a non-owner) | `docs/SECURITY/05` | Verified in IDOR sweep inventory; user preferences route is scoped to authenticated session (`/users/me/preferences`). |
| Mandatory emails ignore preferences | `docs/BACKEND/07`, `docs/SECURITY/07` | `backend/worker/test/notification-send.spec.ts` > "unconditionally sends mandatory security alert without checking preferences" |
| Bounce suppression protects deliverability | `docs/DEVOPS/07`, `docs/DEVOPS/09` | `backend/api/test/email-webhook.spec.ts` > "handles Resend email.bounced hard bounce, stores record and suppresses future sends" |

---

## Definition of Done Verification

- [x] Preference-gated emails respect the toggle; a test asserts both states (`backend/worker/test/notification-send.spec.ts`).
- [x] Mandatory emails ignore preferences (`backend/worker/test/notification-send.spec.ts`).
- [x] A permanently failed invoice email raises an alert (`backend/api/test/email-webhook.spec.ts`, `deploy/prometheus/alerts.yml`).
- [x] Bounce handling exists and is tested with a simulated bounce (`backend/api/test/email-webhook.spec.ts`).
- [x] Full test suite, typecheck, and build pass clean.
- [x] `TASKS/PROGRESS.md` and `TASKS/PHASE-4-ENGAGEMENT.md` updated.
