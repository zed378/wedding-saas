# P4-03 — Feature Spec: Public Guestbook Submission and Listing

| | |
|---|---|
| **Task** | `TASKS/PHASE-4-ENGAGEMENT.md` § P4-03 |
| **Date** | 2026-10-17 |
| **Author** | Agent |
| **Status** | In Progress |

---

## 1. Goal

Allow guests visiting a published digital wedding invitation to submit congratulatory messages (`POST /public/i/:slug/guestbook`) and view previously approved messages (`GET /public/i/:slug/guestbook`). Respect the owner's `guestbook_moderation` setting by defaulting submissions to `approved` (if moderation is off) or `pending` (if moderation is on), sanitize input against stored XSS, preserve visitor privacy via IP hashing, guard against duplicate spam attacks, and emit notification jobs for invitation owners.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/08-PUBLIC-INVITATION-API.md` | § RSVP & Guestbook Submission | Unauthenticated submission and approved listing endpoints. |
| `docs/DATABASE/09-GUESTS.md` | `invitation_guestbook` | Schema, check constraints, composite `(invitation_id, status)` index. |
| `docs/PLAN/02-BUSINESS-RULES.md` | § BR-7.3 Guestbook Moderation | `guestbook_moderation = true` keeps entries `pending` until approved. |
| `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` | § Public Surfaces | Published status predicate is the boundary; unauthenticated. |
| `docs/SECURITY/08-API-SECURITY.md` | § Input Sanitization | Sanitize `guest_name` and `message` via `TEXT_FIELDS`. |
| `docs/SECURITY/09-PRIVACY-DATA-PROTECTION.md` | § IP Storage | Never store raw IPs; SHA-256 hash in `submitted_ip_hash`. |
| `docs/SECURITY/10-ABUSE-PREVENTION.md` | § Rate Limiting | Rate limiting 10/hr per `(ip_hash, slug)`; duplicate detection flags for moderation. |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-7.1 | Guestbook can be disabled per invitation (`guestbook_enabled = false`). Submissions must be rejected with 422 `GUESTBOOK_DISABLED`. | `GuestbookService.submitEntry` |
| BR-7.3 | If moderation is on (`guestbook_moderation = true`), initial status is `pending`; if off, initial status is `approved`. | `GuestbookService.submitEntry` |
| BR-7.4 | Only `status = 'approved'` entries are displayed in the public guestbook list. Filtered at the database query. | `GuestbookRepository.findApprovedEntries` |
| Security | Submissions to draft, unpublished, expired, or deleted invitations return 404 and store nothing. | `GuestbookRepository.findPublishedTarget` |
| Abuse | Duplicate messages from different IP hashes within a 5-minute window are flagged as `pending` for moderation. | `GuestbookRepository.hasRecentDuplicateMessage` |

## 4. API Contract

Mounted on `backend/api/src/modules/guestbook/public-guestbook.controller.ts`:

### 1. Submit Guestbook Entry
- **Method & Path**: `POST /public/i/:slug/guestbook`
- **Rate Limit**: `@UseGuards(rateLimit("guestbook"))` (10 / hr per IP hash + slug)
- **Request Body**:
```json
{
  "guest_name": "Rian Ardianto",
  "message": "Selamat menempuh hidup baru!"
}
```
- **Validation**:
  - `guest_name`: string, trimmed, 1..150 characters.
  - `message`: string, trimmed, 1..1000 characters.
  - Strict schema (no extra/unexpected fields).
- **Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "guest_name": "Rian Ardianto",
    "message": "Selamat menempuh hidup baru!",
    "status": "approved", // or "pending"
    "created_at": "2026-10-17T12:00:00.000Z"
  }
}
```

### 2. List Approved Guestbook Entries
- **Method & Path**: `GET /public/i/:slug/guestbook?page=1&limit=20`
- **Rate Limit**: Public read rate limit (`general-public`)
- **Query Params**:
  - `page`: positive integer (default 1)
  - `limit` / `per_page`: positive integer, max 100 (default 20)
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "guest_name": "Rian Ardianto",
      "message": "Selamat menempuh hidup baru!",
      "created_at": "2026-10-17T12:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 20,
    "total": 1
  }
}
```

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `invitations` | Read | Scoped by `slug`, `status = 'published'`, and `deleted_at IS NULL`. |
| `invitation_settings` | Read | Read `guestbook_enabled` and `guestbook_moderation`. |
| `invitation_guestbook` | Read & Write | Insert entry with resolved `status` and `submitted_ip_hash`. Query approved entries ordered by `created_at DESC`. |

## 6. Authorization

- **Caller**: Unauthenticated public guest.
- **Enforcement**:
  - Requires target invitation to be currently `published` with `deleted_at IS NULL`.
  - Non-published invitations (draft, paid, expired, soft-deleted, nonexistent) return 404 `NOT_FOUND` without leaking existence.
  - Share-preview tokens cannot submit guestbook entries (preview routes bypass or disallow submissions).

## 7. Validation and Sanitization

- `guest_name` and `message` sanitized using `sanitizeFields(..., TEXT_FIELDS)` ("plain" text mode, removing all HTML/script tags).
- Field names registered in `TEXT_FIELDS` (`backend/api/src/shared/sanitizer/registry.ts`).

## 8. Duplicate Detection

- If an identical message was submitted within the last 5 minutes from a *different* IP hash for the same invitation:
  - Entry is saved as `status = 'pending'`, regardless of `guestbook_moderation` setting.
  - Prevents automated flood attacks from spamming live public boards without locking out innocent guests.

## 9. Test Plan

Integration test suite at `backend/api/test/integration/public-guestbook.itest.ts`:
1. Happy path (moderation off): submission stored as `approved` and returned in `GET /public/i/:slug/guestbook`.
2. Moderation on: submission stored as `pending` and omitted from `GET /public/i/:slug/guestbook`.
3. Disabled guestbook: rejected with 422 `GUESTBOOK_DISABLED`.
4. Lifecycle isolation: draft, unpublished, expired, deleted invitations return 404 and store nothing.
5. Stored XSS: HTML and script tags stripped from name and message before storage.
6. Privacy: `submitted_ip_hash` is SHA-256 hex string, raw IP is never stored.
7. Duplicate detection: identical message from another IP in 5 minutes forces `pending`.
8. Validation: missing fields, empty strings, oversized strings (>150 name, >1000 message) return 400.
