# P4-01 — Feature Spec: Public RSVP Submission

| | |
|---|---|
| **Task** | `P4-01` |
| **Date** | 2026-10-17 |
| **Author** | AI Agent (Antigravity) |
| **Status** | Implemented |

---

## 1. Goal

Implement `POST /public/i/:slug/rsvp` per `docs/API/08-PUBLIC-INVITATION-API.md`. The endpoint allows invited wedding guests to confirm attendance and submit a congratulatory note without requiring an account. It enforces invitation status verification (`published` only), explicit section activation checks (`rsvp_enabled = true`), strict data validation (attendance enum, guest count 1..10, name/message bounds), prose sanitization against stored XSS, privacy-preserving IP hashing, and Redis-backed rate limiting (10 submissions/hour per IP-hash and slug).

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/08-PUBLIC-INVITATION-API.md` | § RSVP & Guestbook Submission | Endpoint path `POST /public/i/:slug/rsvp`, accepted request payload, error envelopes, and public status isolation. |
| `docs/DATABASE/09-GUESTS.md` | `invitation_guests` schema | Columns `id`, `invitation_id`, `guest_name` (varchar 150), `attendance_status` ('attending', 'not_attending', 'maybe'), `guest_count` (int, 1..10), `message` (text), `submitted_ip_hash` (varchar 64), `created_at`. |
| `docs/PLAN/02-BUSINESS-RULES.md` | § BR-7 RSVP & Guestbook | BR-7.1 (public unauthenticated submission, rate-limited); BR-7.2 (soft duplicate guard preventing accidental re-submits without blocking shared family devices). |
| `docs/SECURITY/08-INPUT-VALIDATION-AND-XSS.md` | Stored XSS Prevention | All free-text inputs (`guest_name`, `message`) sanitized before storage. |
| `docs/SECURITY/09-DATA-PRIVACY-GDPR.md` | IP Address Privacy | Raw IP addresses must never be written to database columns; store SHA-256 hash only. |
| `docs/SECURITY/10-ABUSE-PREVENTION.md` | Rate Limiting | `POST /public/i/:slug/rsvp`: 10 requests / 1 hour / (IP hash, slug). |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-7.1 | RSVP can be submitted by anyone holding the link; rate-limited per IP/device | `PublicRsvpController.ts`, `rate-limit.guard.ts` |
| BR-7.2 | Accidental duplicate submissions discouraged while supporting shared family phones | `RsvpService.ts` |
| BR-4.1 | Disabled sections reject writes even if request is hand-crafted | `RsvpService.ts` (`rsvp_enabled === true` check) |
| Security | Submitting to draft, unpublished, expired, or non-existent invitations answers 404 | `PublicRsvpRepository.ts` |
| Security | Raw IP is never stored in database; only SHA-256 hash | `RsvpService.ts` |

## 4. API Contract

- **Method and path**: `POST /public/i/:slug/rsvp`
- **Request schema**:
  ```json
  {
    "guest_name": "string (1..150 characters, required)",
    "attendance_status": "'attending' | 'not_attending' | 'maybe' (required)",
    "guest_count": "integer (1..10, optional, defaults to 1)",
    "message": "string (max 1000 characters, optional)"
  }
  ```
- **Success response (HTTP 201)**:
  ```json
  {
    "success": true,
    "data": {
      "id": "uuid",
      "guest_name": "Budi Santoso",
      "attendance_status": "attending",
      "guest_count": 2,
      "message": "Selamat berbahagia!",
      "created_at": "2026-10-17T17:00:00.000Z"
    }
  }
  ```
- **Error cases**:
  - `404 NOT_FOUND`: Slug not found, or invitation status is not `published`, or invitation is soft-deleted.
  - `422 UNPROCESSABLE_ENTITY` with code `RSVP_DISABLED`: When invitation exists and is published, but `invitation_settings.rsvp_enabled` is `false`.
  - `400 BAD_REQUEST` / `422 VALIDATION_ERROR`: Missing `guest_name`, invalid `attendance_status`, or `guest_count` out of bounds (1..10).
  - `429 TOO_MANY_REQUESTS`: Exceeded 10 submissions in 1 hour from the same client IP hash on this slug.

## 5. Data Model Impact

- Reads `invitations` and `invitation_settings` matching `slug` where `status = 'published'` and `deleted_at IS NULL`.
- Inserts new row into `invitation_guests`:
  - `invitation_id`: Resolved UUID
  - `guest_name`: Sanitized plain text
  - `attendance_status`: Validated enum
  - `guest_count`: 1..10
  - `message`: Sanitized plain text or null
  - `submitted_ip_hash`: `createHash('sha256').update(ip).digest('hex')` (64 chars)
- Migration required: None (table `invitation_guests` was created in `P0-09` migration `0003_invitations.sql`).

## 6. Authorization & Rate Limiting

- **Authorization**: Public anonymous endpoint. No bearer token or cookie session required.
- **Tenancy Boundary**: The invitation is resolved exclusively by published slug: `WHERE i.slug = :slug AND i.status = 'published' AND i.deleted_at IS NULL`. An unpublished invitation yields 404, never disclosing whether the slug exists.
- **Rate Limit**: `@UseGuards(rateLimit("rsvp"))` which applies policy `{ name: "rsvp", limit: 10, windowSeconds: 3600, key: "iphash+slug" }`.
- **Sanitization**: All string fields registered with `TEXT_FIELDS` are sanitized using `sanitizeFields(...)` before DB insertion.
