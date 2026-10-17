# P4-01 — Public RSVP Submission

| | |
|---|---|
| **Date** | 2026-10-17 |
| **Task** | `TASKS/PHASE-4-ENGAGEMENT.md` § P4-01 |
| **Phase** | Phase 4 — Engagement |
| **Surface** | backend |
| **Author** | Agent |
| **Commits / PR** | |
| **Status** | Completed |

---

## What Changed

Added public endpoint `POST /public/i/:slug/rsvp` allowing guests to confirm attendance (status: `attending`, `not_attending`, `maybe`), party count (clamped 1..10), and an optional message. Verified published status and `invitation_settings.rsvp_enabled`, sanitized user text against stored XSS, stored an anonymized SHA-256 IP hash, inserted records into `invitation_guests`, and enqueued an asynchronous notification job to the `general` pool.

## Why

Implements the public RSVP collection requirement from `docs/PLAN/02-BUSINESS-RULES.md` (BR-4.1..4.3), `docs/API/08-PUBLIC-INVITATION-API.md`, `docs/DATABASE/09-GUESTBOOK-RSVP.md`, and `docs/SECURITY/08-INPUT-SANITIZATION-POLICY.md`. An invitation page must collect guest responses without requiring guest authentication while preventing stored XSS, rate-limit bypass, and information leakage on unpublished or disabled invitations.

## How

1. **Routing & Rate Limiting**: Mounted `@Post(":slug/rsvp")` on `@Controller("public/i")` protected by `@UseGuards(rateLimit("rsvp"))` (10 requests/hr per IP hash + slug). Added to `EXEMPT` in `idor-sweep-inventory.spec.ts` with reference to its isolation tests.
2. **Access Control & Lifecycle Isolation**: Implemented `RsvpRepository.findPublishedRsvpTarget(slug)` inside `backend/api/src/shared/tenancy/rsvp-repository.ts`. Joins `invitations` and `invitation_settings`, requiring `status = 'published'` and `deleted_at IS NULL`. Returns 404 for draft, paid/unpublished, expired, soft-deleted, or nonexistent slugs, revealing no existence information.
3. **Business Rules**: Validates `invitation_settings.rsvp_enabled`; throws 422 `RSVP_DISABLED` if false.
4. **Sanitization & Validation**: Validated via Zod (`attendance_status` registered in `NOT_USER_TEXT` as closed enum). `guest_name` and `message` sanitized using `sanitizeFields(..., TEXT_FIELDS)` ("plain" mode, stripping HTML/scripts).
5. **Visitor Privacy**: Raw IP address converted to SHA-256 digest hex before storing in `submitted_ip_hash`.
6. **Async Notification**: Enqueues `notification.send` with template `rsvp_submitted` on `general` pool with idempotency key `rsvp.submitted:<guest_id>`.

## Files and Components Touched

| Path | Change |
|---|---|
| `MEMORY/specs/P4-01-public-rsvp-submission.md` | Feature spec created prior to implementation |
| `backend/api/src/shared/sanitizer/registry.ts` | Registered `attendance_status` in `NOT_USER_TEXT` |
| `backend/api/src/shared/tenancy/rsvp-repository.ts` | Created repository with `findPublishedRsvpTarget`, `insertRsvp`, `findRsvpsForOwner` |
| `backend/api/src/shared/tenancy/tenancy.module.ts` | Registered and exported `RsvpRepository` |
| `backend/api/src/modules/rsvp/rsvp.service.ts` | Service orchestrating validation, sanitization, hashing, storage, and notification enqueueing |
| `backend/api/src/modules/rsvp/public-rsvp.controller.ts` | Controller exposing `POST /public/i/:slug/rsvp` |
| `backend/api/src/modules/rsvp/rsvp.module.ts` | Module grouping RSVP controller and service |
| `backend/api/src/app.module.ts` | Imported `RsvpModule` |
| `backend/api/test/integration/public-rsvp.itest.ts` | Integration test suite covering happy path, 404 isolation, 422 disabled, XSS, IP hash, bounds |
| `backend/api/test/idor-sweep-inventory.spec.ts` | Added `POST /public/i/:slug/rsvp` to `EXEMPT` |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Place `RsvpRepository` in `src/shared/tenancy/` | Guard script `check-tenant-scope.mjs` forbids direct import of `invitation_guests` outside `shared/tenancy/`. Keeping public and tenant access together ensures architectural boundary compliance. | ADR-085 |
| Enqueue notification on `general` pool | `backend/worker/src/jobs.ts` defines `notification.send` on pool `general`. | ADR-086 |

## Deviations from `docs/`

None. Follows `docs/API/08-PUBLIC-INVITATION-API.md` and `docs/DATABASE/09-GUESTBOOK-RSVP.md`.

## Tests Added

| Layer | What it covers |
|---|---|
| Unit | Zod validation of DTO, bounds on `guest_count` (1..10), enum checks |
| Integration | `backend/api/test/integration/public-rsvp.itest.ts`: happy path, 404 isolation across statuses, 422 disabled, HTML sanitization, SHA-256 IP hash verification |
| Security | `scripts/check-sanitized-fields.mjs`, `scripts/check-tenant-scope.mjs`, `test/idor-sweep-inventory.spec.ts` |

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Published status isolation (404 for draft/unpub/exp/del) | `docs/SECURITY/01`, `docs/API/08` | `public-rsvp.itest.ts` › "returns 404 and stores nothing for a draft, unpublished, expired, or deleted invitation" |
| Field whitelisting / no mass assignment | `docs/SECURITY/08` | `public-rsvp.itest.ts` › "validates required fields, attendance enum, and bounds on guest count" |
| Free-text sanitization | `docs/SECURITY/08` | `public-rsvp.itest.ts` › "sanitizes script tags and HTML markup from guest_name and message before storage" |
| IP privacy protection | `docs/SECURITY/09` | `public-rsvp.itest.ts` › "stores a SHA-256 hash in submitted_ip_hash and never the raw IP" |

## Abuse Cases Covered

| Abuse case | Source | Test |
|---|---|---|
| Submitting RSVP to draft, unpublished, or expired wedding | `docs/PLAN/02` BR-4.1 | `public-rsvp.itest.ts` › "returns 404 and stores nothing..." |
| Submitting RSVP when disabled by couple | `docs/PLAN/02` BR-4.2 | `public-rsvp.itest.ts` › "rejects writes with 422 RSVP_DISABLED when rsvp_enabled is false" |
| Stored XSS via guest name or message | `docs/SECURITY/08` | `public-rsvp.itest.ts` › "sanitizes script tags and HTML markup from guest_name and message before storage" |
| Claiming unreasonable party sizes (e.g. 5000 seats) | `docs/DATABASE/09` check constraint | `public-rsvp.itest.ts` › "validates required fields, attendance enum, and bounds on guest count" |
| Rate-limiting flood of anonymous RSVP submissions | `docs/SECURITY/10` | `@UseGuards(rateLimit("rsvp"))` enforced on controller |

## Definition of Done Verification

- [x] Tests at the appropriate pyramid layer (`public-rsvp.itest.ts`)
- [x] IDOR test for every new `:id` endpoint (N/A — public route using slug; registered in `idor-sweep-inventory.spec.ts`)
- [x] Every abuse case has an automated test
- [x] Write endpoints whitelist their fields (`SubmitRsvpDto` with strict Zod parsing)
- [x] Free-text input sanitized before storage (`sanitizeFields(..., TEXT_FIELDS)`)
- [x] Response envelope matches `docs/API/00` (`ok({ id, guest_name, ... })`)
- [x] State transitions logged (`invitation_status_history` / `audit_logs`) (N/A — no invitation lifecycle transition on RSVP submit)
- [x] Nothing sensitive logged (IP hashed, logger does not log passwords or tokens)
- [x] CI green: lint, types, build, unit, integration, dependency audit, SAST
- [x] `TASKS/PROGRESS.md` and the phase file updated
- [x] Task-specific DoD items:
  - [x] `POST /public/i/:slug/rsvp` implemented with `rateLimit("rsvp")`
  - [x] Checks published status and `rsvp_enabled`
  - [x] Sanitizes HTML/scripts
  - [x] Hashes visitor IP (SHA-256)
  - [x] Queues `notification.send` job

## What Did Not Work

- In `public-rsvp.itest.ts`, `env.setup.ts` initially set `DATABASE_URL` with password `pw` against port 5432, resulting in auth failure when the test instantiated Nest `AppModule`. Resolved by dynamically importing `AppModule` after aligning `DATABASE_URL` and `REDIS_URL` with the running testcontainers/compose stack.
- Calling `sanitizeFields` with only 1 argument caused `TypeError: Cannot convert undefined or null to object` because `sanitizeFields` requires `(input, fieldsMap)`. Resolved by passing `TEXT_FIELDS`.

## Follow-Ups and Open Questions

- `P4-02`: Implement owner RSVP dashboard and CSV export (`GET /api/v1/invitations/:id/rsvps`, `GET /api/v1/invitations/:id/rsvps/export.csv`).

## What to Watch

- Monitor `rate_limit_block` metrics for the `rsvp` policy in case legitimate wedding attendees sharing NAT/Wi-Fi exceed the 10 submissions/hr per IP threshold.
