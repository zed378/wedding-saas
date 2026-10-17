# P4-04 — Feature Spec: Owner Guestbook Moderation

Written before implementation for `P4-04` (`TASKS/PHASE-4-ENGAGEMENT.md`).

| | |
|---|---|
| **Task** | `P4-04 — Owner Guestbook Moderation` |
| **Date** | 2026-10-17 |
| **Author** | AI |
| **Status** | Implemented |

---

## 1. Goal

Allows wedding invitation owners to manage and moderate guestbook entries left by their guests: listing entries with optional status filtering (`pending`, `approved`, `rejected`), approving or rejecting entries (recording moderator identity and timestamp), and deleting entries. Enforces strict tenant isolation (non-owners receive 404, never 403) and invalidates the public page cache upon approval so approved entries become visible immediately.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/PLAN/04-DETAILED-REQUIREMENTS.md` | § F11 Guestbook & Moderation | Owner can view entries and moderate (`pending` -> `approved` / `rejected`); deletion; notification |
| `docs/PLAN/02-BUSINESS-RULES.md` | § BR-7.3, BR-7.4 | Guestbook entries moderated if enabled; moderation actions take immediate effect |
| `docs/UI-UX/10-COMPONENT-SPECIFICATION.md` | § GuestbookModerationList | Filter tabs (Pending / Approved / Rejected), action buttons (Approve, Reject, Delete), item details |
| `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` | § Query-level isolation | Object-level authorization on `:id` endpoints enforced at DB query (`WHERE owner_id = :scope`); non-owner gets 404 |
| `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` | § Attack Surfaces 6 & 7 | Nested ids (`:id` invitation and `:entry_id` entry) must be validated together in the query scope |
| `docs/API/00-API-STANDARDS.md` | Standard envelope & error codes | Standard `ok()` envelope, `pageMeta()`, standard validation error formats |
| `MEMORY/DECISIONS.md` | ADR-021 | Owner-side guestbook moderation endpoints under `/api/v1/invitations/:id/guestbook[/:entry_id]` |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-7.3 | If moderation is on, entries remain pending until explicitly approved by owner | `GuestbookService.moderateEntry` |
| BR-7.4 | Moderation actions (approve, reject, delete) take effect immediately on public page | `GuestbookService` via `PublicInvitationCache.invalidate` |

## 4. API Contract

Mounted under `/api/v1/invitations/:id/guestbook`. All routes require JWT authentication (`AuthGuard`).

### 4.1. GET /api/v1/invitations/:id/guestbook
- **Method & Path**: `GET /api/v1/invitations/:id/guestbook`
- **Query Parameters**:
  - `page`: optional positive integer (default 1)
  - `per_page`: optional positive integer <= 100 (default 20)
  - `status`: optional enum (`"pending" | "approved" | "rejected"`)
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "uuid",
        "guest_name": "Sarah Connor",
        "message": "Congratulations on your special day!",
        "status": "pending",
        "submitted_ip_hash": "a1b2c3d4...",
        "moderated_by": null,
        "moderated_at": null,
        "created_at": "2026-10-17T12:00:00.000Z"
      }
    ],
    "meta": {
      "page": 1,
      "per_page": 20,
      "total": 1,
      "total_pages": 1
    }
  }
  ```
- **Error Cases**:
  - `401 Unauthorized`: Missing or invalid token
  - `404 Not Found`: Invitation does not exist, belongs to another user, or is deleted

### 4.2. PATCH /api/v1/invitations/:id/guestbook/:entry_id
- **Method & Path**: `PATCH /api/v1/invitations/:id/guestbook/:entry_id`
- **Request Body (JSON)**:
  ```json
  {
    "status": "approved" // or "rejected"
  }
  ```
  Strict whitelist: unknown properties return 400.
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "id": "uuid",
      "guest_name": "Sarah Connor",
      "message": "Congratulations on your special day!",
      "status": "approved",
      "submitted_ip_hash": "a1b2c3d4...",
      "moderated_by": "user-uuid",
      "moderated_at": "2026-10-17T12:05:00.000Z",
      "created_at": "2026-10-17T12:00:00.000Z"
    }
  }
  ```
- **Error Cases**:
  - `400 Bad Request`: Invalid status value or unrecognized field
  - `401 Unauthorized`: Missing or invalid token
  - `404 Not Found`: Invitation or entry does not exist, or does not belong to user

### 4.3. DELETE /api/v1/invitations/:id/guestbook/:entry_id
- **Method & Path**: `DELETE /api/v1/invitations/:id/guestbook/:entry_id`
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "id": "entry-uuid",
      "deleted": true
    }
  }
  ```
- **Error Cases**:
  - `401 Unauthorized`: Missing or invalid token
  - `404 Not Found`: Invitation or entry does not exist, or does not belong to user

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `invitations` | Read | Scoped by `id` and `owner_id = scope` (and `deleted_at IS NULL`) |
| `invitation_guestbook` | Read / Write / Delete | Queried and updated strictly via `GuestbookRepository` in `shared/tenancy` |

Migration required: No. Schema `invitation_guestbook` already contains `moderated_by` and `moderated_at`.

## 6. Authorization

- **Caller**: Authenticated wedding invitation owner (`user.id`).
- **Enforcement Layer**:
  - Query-level tenant filter in `GuestbookRepository`:
    `WHERE invitations.owner_id = scope AND invitations.id = :id AND invitations.deleted_at IS NULL`
  - When accessing `:entry_id`, verified with composite predicate `invitation_guestbook.id = :entry_id AND invitation_guestbook.invitation_id = :id`.
- **Non-owner response**:
  - Exactly `404 Not Found` with standard message ("Undangan tidak ditemukan"). Never `403 Forbidden` to prevent resource-existence probing.
- **Admin path**:
  - None on this surface. Platform-wide admin moderation is a separate Phase 5 endpoint (`P5-09`).

## 7. Validation and Sanitization

- `patchModerationSchema`:
  ```ts
  z.object({
    status: z.enum(["approved", "rejected"]),
  }).strict()
  ```
- `ownerGuestbookQuerySchema`:
  ```ts
  z.object({
    page: z.coerce.number().int().positive().optional(),
    per_page: z.coerce.number().int().positive().max(100).optional(),
    status: z.enum(["pending", "approved", "rejected"]).optional(),
  }).strict()
  ```
- Unaccepted fields: Any client attempt to set `moderated_by`, `moderated_at`, `submitted_ip_hash`, `message`, or `guest_name` is rejected with 400.

## 8. State Transitions

- Entry status transitions:
  - `pending` -> `approved`
  - `pending` -> `rejected`
  - `approved` -> `rejected`
  - `rejected` -> `approved`
- On each transition: `moderated_by` is set to caller's `user.id`, `moderated_at` set to current timestamp.

## 9. Side Effects

- When an entry transitions to `approved` (or is deleted while `approved`, or transitioned from `approved` to `rejected`), public cache for `slug` is invalidated immediately via `PublicInvitationCache.invalidate({ slug, invitationId })`.

## 10. Failure Modes

- Cache down / Redis error during invalidation: `PublicInvitationCache.invalidate` fails open / logs error without failing the DB update transaction.
- Database error: 500 internal server error; no state changed.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| IDOR: non-owner viewing guestbook | `docs/SECURITY/05` | 404 Not Found | "returns 404 when non-owner attempts to view guestbook" |
| IDOR: non-owner moderating entry | `docs/SECURITY/05` | 404 Not Found | "returns 404 when non-owner attempts to moderate entry" |
| IDOR: non-owner deleting entry | `docs/SECURITY/05` | 404 Not Found | "returns 404 when non-owner attempts to delete entry" |
| Cross-invitation entry ID spoofing | `docs/SECURITY/05` § 7 | 404 Not Found | "returns 404 when entry belongs to different invitation of same user" |
| Mass assignment of moderator metadata | `docs/SECURITY/08` | 400 Validation Error | "rejects payload containing unexpected fields" |

## 12. Test Plan

- Integration test in `backend/api/test/integration/owner-guestbook.itest.ts`:
  1. Lists entries with pagination and status filters (`pending`, `approved`, `rejected`).
  2. Moderates entry from `pending` to `approved` and records `moderated_by` and `moderated_at`.
  3. Moderates entry from `pending` to `rejected`.
  4. Deletes entry and verifies removal from database.
  5. Proves 404 IDOR isolation on all endpoints (non-owner caller).
  6. Proves 404 for cross-invitation entry manipulation.
  7. Verifies cache invalidation when entry status becomes `approved`.

## 13. Observability

- Structured logger:
  - `guestbook.moderated`: `{ invitation_id, entry_id, from_status, to_status, moderated_by }`
  - `guestbook.deleted`: `{ invitation_id, entry_id, moderated_by }`
