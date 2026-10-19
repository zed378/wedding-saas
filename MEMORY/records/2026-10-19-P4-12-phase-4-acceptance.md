# P4-12 — Phase 4 Test Suite and Acceptance

| | |
|---|---|
| **Date** | 2026-10-19 |
| **Task** | `TASKS/PHASE-4-ENGAGEMENT.md` § P4-12 |
| **Phase** | Phase 4 — Engagement |
| **Surface** | all |
| **Author** | Agent |
| **Status** | Completed |

---

## What Changed

- Created automated acceptance test suite `backend/api/test/phase-4-acceptance.spec.ts` proving all 6 requirements from `docs/PLAN/16`, `docs/TESTING/03` § 3, `docs/PLAN/17-ACCEPTANCE-CRITERIA.md`, and `docs/SECURITY/10-RATE-LIMITING.md`:
  1. Full critical engagement flow: public RSVP & guestbook submission, moderation gating (pending messages hidden from public wall until owner approval), and owner approval/rejection.
  2. Public XSS sweep across all free-text fields (`guest_name`, `message`) with 11 distinct vector payloads (`<script>`, `onerror`, `onload`, `javascript:`, `data:`, `iframe`, mutation XSS).
  3. Rate limiting and abuse defense per policy (RSVP 10/hr, Guestbook 10/hr, and adaptive CAPTCHA trigger: 20 req / 10 min window triggers 30 min challenge).
  4. Zero raw IP / visitor privacy guarantee: `submitted_ip_hash` is 64-character SHA-256 hex; database schemas for `rsvps` and `guestbook_entries` store 0 raw IP columns.
  5. Notification delivery & preference gating: social notifications gated by `rsvp_email`, `rsvp_digest`, and `guestbook_email`; mandatory security notices unconditionally bypass preferences.
  6. In-memory page view counter: 50 concurrent visitor requests perform 0 synchronous primary database writes, batching into Redis `analytics:views:pending`.
- Fixed missing `AuthModule` import in `AnalyticsModule` (`backend/api/src/modules/analytics/analytics.module.ts`), ensuring `SessionService` is available for `OwnerAnalyticsController`.
- Replaced arbitrary Tailwind font size with design token `text-xs` in `GuestbookModerationList.tsx`.
- Verified all 42 test files in `backend/api` (815 tests passed), 4 test files in `backend/worker` (44 tests passed), 28 test files in `frontend/web-app` (409 tests passed), 12 test files + SSR suite in `frontend/public-invite` (170 tests passed), and 6 test files in `@wi/ui` (149 tests passed).
- Verified all repository security and architectural guard scripts pass with 0 errors.

## Why

Fulfills the final acceptance gate for Phase 4 (Engagement) before moving to Phase 5 (Admin Panel). Proves that public engagement surfaces are resilient against stored XSS, rate-limit flooding, visitor privacy invasion, and unmoderated spam, while ensuring couples have full mobile-friendly control over their guests' attendance and heartfelt messages.

## How — Verification Breakdown

### 1. E2E Engagement Flow & Moderation Gating (`docs/TESTING/03` § 3)
- An anonymous guest can confirm attendance and headcount on a published invitation.
- When `guestbook_moderation` is ON, public submissions are initially placed in `pending` status and excluded from public listings (`GET /public/i/:slug/guestbook`).
- The owner sees pending entries on `/dashboard/[invitationId]/guestbook` and approves with 1 click.
- Upon approval, the entry immediately appears on the public invitation page and cache is invalidated.
- Rejected entries are permanently excluded from public visibility.

### 2. XSS Sweep (`docs/SECURITY/04`)
- Verified all 11 XSS attack payloads against `guest_name` and `message` fields.
- Both fields are registered under `TEXT_FIELDS` as `"plain"`.
- `sanitizePlainText` strips all HTML tags and event attributes (`<script>`, `onerror`, `onload`, `iframe`, `javascript:`, expression styles).

### 3. Rate Limiting & Abuse Defense (`docs/SECURITY/10`)
- Public RSVP submission: 10 requests / hr per (ip_hash, slug).
- Public Guestbook submission: 10 requests / hr per (ip_hash, slug).
- When quota is exceeded, HTTP 429 (`TOO_MANY_ATTEMPTS`) is returned with `Retry-After: 3600`.
- Adaptive CAPTCHA trigger: 20 submissions within a 10-minute window activates a 30-minute Turnstile CAPTCHA challenge via `GET /public/i/:slug/captcha-status`.

### 4. Zero Raw IP / Privacy Guarantee (`docs/SECURITY/05`)
- IP addresses are converted to 64-char lowercase hex SHA-256 hashes using `createHash("sha256").update(clientIp).digest("hex")`.
- Neither `rsvps` nor `guestbook_entries` tables have columns for raw IP addresses.

### 5. Notification Delivery & Preference Gating
- Verified preference gating:
  - If `rsvp_digest = true`, immediate `rsvp_submitted` emails are suppressed and aggregated in the 09:00 WIB daily sweep.
  - If `guestbook_email = false`, new wish notifications are suppressed.
- Mandatory security notices (`password_changed`, `bank_account_changed`, `email_verification`, `order_paid`) unconditionally bypass preferences.

### 6. In-Memory Page Views Write-Behind Under Load
- A burst of 50 concurrent visitor page views calls `AnalyticsService.recordView()`.
- Primary PostgreSQL database receives 0 synchronous queries (`sqlWriteCount === 0`).
- Views are buffered into Redis pending hash `analytics:views:pending`, ready for the 1-minute atomic batch flush `analytics_counter_flush`.

## Test Results Summary

| Surface | Test Suite | Tests | Result |
|---|---|---|---|
| `backend/api` | Full test suite (42 files, including `phase-4-acceptance.spec.ts`) | 815 passed | PASS |
| `backend/worker` | Jobs, email adapters, notification send, media (4 files) | 44 passed | PASS |
| `packages/ui` | Tokens, email templates, display, forms, controls (6 files) | 149 passed | PASS |
| `frontend/web-app` | Dashboard, editor, RSVP, guestbook, analytics (28 files) | 409 passed | PASS |
| `frontend/public-invite` | Unit tests (12 files) + SSR test suite (1 file) | 170 passed | PASS |
| Repo Guards | `check-tenant-scope`, `check-no-hardcoded-fields`, `check-renderer-is-generic`, `check-token-storage`, `check-status-writes`, `check-sanitized-fields`, `check-id-endpoint-tests`, `check-design-tokens`, `check-text-sources`, `check-storage-paths`, `check-secrets` | 11 scripts | PASS |
| Types | Monorepo typecheck across 19 packages (`pnpm typecheck`) | 19 clean | PASS |

## Definition of Done Verification

- [x] The E2E engagement flow passes including moderation.
- [x] The XSS sweep across public fields is clean.
- [x] Rate limits match `docs/SECURITY/10` for every public endpoint.
- [x] The phase summary exists in `MEMORY/records/2026-10-19-PHASE-4-SUMMARY.md`.
