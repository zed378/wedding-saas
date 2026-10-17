# P4-03 — Public Guestbook Submission and Listing

| | |
|---|---|
| **Date** | 2026-10-17 |
| **Task** | `TASKS/PHASE-4-ENGAGEMENT.md` § P4-03 |
| **Phase** | Phase 4 |
| **Surface** | backend |
| **Author** | AI |
| **Commits / PR** | |
| **Status** | Completed |

---

## What Changed

Added public-facing guestbook submission and paginated listing endpoints on published invitations:
- `POST /public/i/:slug/guestbook`: allows wedding guests to submit congratulatory wishes (`guest_name`, `message`). Respects the owner's `guestbook_moderation` setting (defaults to `approved` if moderation is off, or `pending` if enabled). Incorporates a duplicate content spam detector that flags identical messages submitted from a different IP hash within 5 minutes into `pending`. Sanitizes free-text inputs against stored XSS, anonymizes IP via SHA-256, enforces the 10/hour rate limit per IP hash and slug, and asynchronously enqueues a `guestbook.submitted` notification job.
- `GET /public/i/:slug/guestbook`: returns a paginated list of entries strictly filtered by `status = 'approved'` (ordered newest first), hiding all pending/unapproved entries and visitor IP hashes.
- Created `GuestbookRepository` in `backend/api/src/shared/tenancy/guestbook-repository.ts` to cleanly satisfy the tenancy architecture guard (`scripts/check-tenant-scope.mjs`).

## Why

Implements the public guestbook requirements of `docs/PLAN/02-BUSINESS-RULES.md` (BR-7.1, BR-7.2, BR-7.3, BR-7.4), `docs/PLAN/05-ADMIN-PANEL.md` § Guestbook Moderation, `docs/API/08-PUBLIC-INVITATION-API.md`, and `docs/SECURITY/10-ABUSE-PREVENTION.md` § Duplicate Spam.

## How

1. **Repository Boundary (`GuestbookRepository`)**:
   - `findPublishedGuestbookTarget`: selects `invitation_id`, `guestbook_enabled`, and `guestbook_moderation` by slug where `status = 'published'` and `deleted_at IS NULL`.
   - `hasRecentDuplicateMessage`: queries for identical message on the same invitation from a different `submitted_ip_hash` within the last 300s window.
   - `insertGuestbookEntry`: records entry into `invitation_guestbook`.
   - `findApprovedEntries`: paginated fetch filtering strictly on `status = 'approved'`, ordered by `created_at DESC`.
2. **Service Layer (`GuestbookService`)**:
   - Validates existence and published status (404 for draft/unpublished/expired/deleted/missing).
   - Enforces `guestbook_enabled` toggle (422 `GUESTBOOK_DISABLED` if false).
   - Sanitizes `guest_name` and `message` via `sanitizeFields` registered with `TEXT_FIELDS`.
   - Hashes client IP using SHA-256 (`submitted_ip_hash`).
   - Resolves entry status based on moderation setting and duplicate spam check.
   - Asynchronously enqueues `guestbook.submitted` notification job to BullMQ `general` queue with idempotency key.
3. **Controller Layer (`PublicGuestbookController`)**:
   - Mounted at `/public/i`.
   - Validates request payload and query via strict Zod schemas (`submitGuestbookSchema`, `listGuestbookQuerySchema`).
   - Uses `rateLimit("guestbook")` for submissions (10/hr) and `rateLimit("general-public")` for listing.
   - Formats responses using standard `ok()` envelope and `pageMeta()`.
4. **App & Tenancy Registration**:
   - Registered `GuestbookRepository` in `TenancyModule`.
   - Created `GuestbookModule` and registered in `AppModule`.
   - Added `/public/i/:slug/guestbook` to `EXEMPT` inventory in `test/idor-sweep-inventory.spec.ts` with test coverage in `public-guestbook.itest.ts`.

## Files and Components Touched

| Path | Change |
|---|---|
| `MEMORY/specs/P4-03-public-guestbook.md` | Feature spec created before implementation |
| `backend/api/src/shared/tenancy/guestbook-repository.ts` | Guestbook repository for public queries and inserts |
| `backend/api/src/shared/tenancy/tenancy.module.ts` | Exported `GuestbookRepository` |
| `backend/api/src/modules/guestbook/guestbook.service.ts` | Service layer handling business rules, spam guard, sanitization |
| `backend/api/src/modules/guestbook/public-guestbook.controller.ts` | HTTP controller for public guestbook endpoints |
| `backend/api/src/modules/guestbook/guestbook.module.ts` | Guestbook module setup |
| `backend/api/src/app.module.ts` | Imported `GuestbookModule` |
| `backend/api/test/idor-sweep-inventory.spec.ts` | Added public guestbook routes to exempt list |
| `backend/api/test/integration/public-guestbook.itest.ts` | Comprehensive integration test suite (8 test cases) |
| `docs/API/08-PUBLIC-INVITATION-API.md` | Documented public guestbook submission and list contract |
| `MEMORY/records/2026-10-17-P4-03-public-guestbook.md` | Change record |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Centralize `invitationGuestbook` queries in `GuestbookRepository` inside `shared/tenancy` | `invitationGuestbook` is guarded in `scripts/check-tenant-scope.mjs`. Placing data access in `shared/tenancy` allows clean reuse for public access now and owner moderation in P4-04 | ADR-087 |
| Duplicate message from different IP within 5 min sets status to `pending` | Prevents automated spam rings from flooding weddings with duplicate messages while keeping legitimate entries queued for owner moderation | ADR-087 |

## Deviations from `docs/`

None. Follows `docs/API/08-PUBLIC-INVITATION-API.md`, `docs/PLAN/02-BUSINESS-RULES.md`, and `docs/SECURITY/10-ABUSE-PREVENTION.md`.

## Tests Added

| Layer | What it covers |
|---|---|
| Integration | `test/integration/public-guestbook.itest.ts`: Submits message with approved status when moderation is off; verifies listing displays approved entries |
| Integration | Submits message with pending status when moderation is on; verifies listing hides unapproved entries until approved |
| Integration | Flags duplicate message from different IP hash in 5 min window into pending |
| Integration | Rejects submission with 422 `GUESTBOOK_DISABLED` when guestbook is turned off in settings |
| Integration | Rejects submit and list with 404 for draft, unpublished, expired, deleted, or nonexistent invitations |
| Integration | Sanitizes `<script>` and HTML markup from guest name and message before storage |
| Integration | Stores SHA-256 hash in `submitted_ip_hash` and never the raw IP address |
| Integration | Validates required fields, max length bounds, and rejects unexpected properties |

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Object-level authorization / published boundary (404 for unpublished/deleted) | `docs/SECURITY/05`, `docs/API/08` | `test/integration/public-guestbook.itest.ts` > "returns 404 for draft, unpublished, expired, or deleted invitations on submit and list" |
| Field whitelisting / no mass assignment | `docs/SECURITY/08` | `test/integration/public-guestbook.itest.ts` > "validates required fields, maximum length, and rejects unexpected properties" |
| Free-text sanitization | `docs/SECURITY/08` | `test/integration/public-guestbook.itest.ts` > "sanitizes script tags and HTML markup from guest_name and message before storage" |
| PII / IP anonymization | `docs/SECURITY/10` | `test/integration/public-guestbook.itest.ts` > "stores a SHA-256 hash in submitted_ip_hash and never the raw IP" |
| Moderation visibility barrier | `docs/PLAN/05` | `test/integration/public-guestbook.itest.ts` > "submits message with status pending when moderation is on and hides from public list until approved" |

## Abuse Cases Covered

| Abuse case | Source | Test |
|---|---|---|
| Spam flood / identical messages across IPs | `docs/SECURITY/10` | `test/integration/public-guestbook.itest.ts` > "flags identical message from a different IP in 5 min as pending for moderation" |
| Stored XSS via guestbook name and message | `docs/SECURITY/08` | `test/integration/public-guestbook.itest.ts` > "sanitizes script tags and HTML markup from guest_name and message before storage" |
| Submitting to disabled guestbook | `docs/PLAN/02` | `test/integration/public-guestbook.itest.ts` > "rejects writes with 422 GUESTBOOK_DISABLED when guestbook_enabled is false" |
| Crawling unapproved / pending entries | `docs/PLAN/05` | `test/integration/public-guestbook.itest.ts` > "submits message with status pending when moderation is on and hides from public list until approved" |

## Definition of Done Verification

- [x] Tests at the appropriate pyramid layer (`test/integration/public-guestbook.itest.ts`)
- [x] IDOR test / public inventory verification (`test/idor-sweep-inventory.spec.ts`)
- [x] Every abuse case has an automated test (XSS, spam flood, disabled guestbook, visibility leak)
- [x] Write endpoints whitelist their fields (`submitGuestbookSchema.strict()`)
- [x] Free-text input sanitized before storage (`TEXT_FIELDS` via `sanitizeFields`)
- [x] Response envelope matches `docs/API/00` (`ok()`, `pageMeta()`)
- [x] State transitions logged / notifications enqueued (`guestbook.submitted` job queued)
- [x] Nothing sensitive logged (IP hashed, no PII leaked)
- [x] CI green: lint, types, build, unit (772 passed), integration (8 passed), all 5 guard scripts passed
- [x] `TASKS/PROGRESS.md` and the phase file updated
- [x] Task-specific DoD items satisfied (feature spec, dual status handling, duplicate detector, pagination, 404/422 handling)

## What Did Not Work

- In the integration test environment, Supertest calls Express without `app.set("trust proxy", 1)`. When testing multiple `X-Forwarded-For` IPs, `req.ip` defaulted to `127.0.0.1` for both calls, causing the duplicate detector's `ne(submittedIpHash, currentIpHash)` condition to not trigger. Solved by configuring `app.getHttpAdapter().getInstance().set("trust proxy", 1)` in test setup, matching `main.ts` behavior.

## Follow-Ups and Open Questions

- `P4-04`: Owner guestbook moderation endpoints (`GET /api/v1/invitations/:id/guestbook`, `PATCH .../:entry_id`, `DELETE .../:entry_id`).

## What to Watch

- Monitor rate-limit hits on `/public/i/:slug/guestbook` to verify standard users aren't running into false positives during large receptions.
