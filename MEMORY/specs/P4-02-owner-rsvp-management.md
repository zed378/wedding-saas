# P4-02 — Feature Spec: Owner RSVP Management and CSV Export

| | |
|---|---|
| **Task** | `TASKS/PHASE-4-ENGAGEMENT.md` § P4-02 |
| **Date** | 2026-10-17 |
| **Author** | Agent |
| **Status** | Implemented |

---

## 1. Goal

Allow authenticated invitation owners to manage their guest RSVPs from the dashboard: view a paginated list of RSVPs with optional attendance filtering (`attending`, `not_attending`, `maybe`), inspect aggregate attendance and headcounts calculated directly in PostgreSQL, download a full CSV export with strict spreadsheet formula injection mitigation, and delete spam or erroneous RSVP entries while enforcing tenant isolation (returning 404 for non-owners).

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/PLAN/04-FEATURE-SPECIFICATIONS.md` | § F10 RSVP Management | RSVP list, attendance summary, CSV export, and deletion. |
| `docs/API/04-INVITATION-API.md` | § Sub-resource: RSVP (owner side) | Contracts for listing, summary, export, and delete. |
| `docs/DATABASE/09-GUESTBOOK-RSVP.md` | `invitation_guests` | Schema, check constraints, indexes. |
| `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` | § Object-level Authorization | Queries strictly scoped by `owner_id = user.id`; non-owner gets 404. |
| `docs/SECURITY/08-INPUT-SANITIZATION-POLICY.md` | § CSV Injection Protection | Escaping/quoting cells starting with `=`, `+`, `-`, `@`, `\t`, `\r`. |
| `docs/SECURITY/10-ABUSE-PREVENTION.md` | § Rate Limiting | Rate limiting heavy read operations (CSV export). |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-4.1 | Only the invitation owner can view, summarize, export, or delete RSVP submissions. | `RsvpRepository` tenant scope checks (`WHERE invitations.owner_id = :scope`). |
| BR-4.3 | CSV export must prevent formula injection when opened in Excel/Google Sheets. | `RsvpService.exportCsv` formula escaping. |
| BR-4.4 | Summary numbers must accurately aggregate totals per attendance status and total attending heads. | SQL query in `RsvpRepository.getRsvpSummaryForOwner`. |

## 4. API Contract

Mounted on `backend/api/src/modules/rsvp/owner-rsvp.controller.ts` under `@Controller("api/v1/invitations/:id/rsvps")`:

### 1. List RSVPs
- **Method & Path**: `GET /api/v1/invitations/:id/rsvps?page=1&limit=20&status=attending`
- **Query params**:
  - `page`: positive integer (default 1)
  - `limit`: integer 1..100 (default 20)
  - `status`: optional enum (`attending`, `not_attending`, `maybe`)
- **Response**:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "guest_name": "Dimas Anggara",
        "attendance_status": "attending",
        "guest_count": 2,
        "message": "Selamat ya!",
        "created_at": "2026-10-17T12:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total_items": 1,
      "total_pages": 1
    }
  }
}
```

### 2. RSVP Summary
- **Method & Path**: `GET /api/v1/invitations/:id/rsvps/summary`
- **Response**:
```json
{
  "success": true,
  "data": {
    "total_responses": 10,
    "attending": 7,
    "not_attending": 2,
    "maybe": 1,
    "total_attending_guests": 14
  }
}
```

### 3. CSV Export
- **Method & Path**: `GET /api/v1/invitations/:id/rsvps/export`
- **Headers**:
  - `Content-Type`: `text/csv; charset=utf-8`
  - `Content-Disposition`: `attachment; filename="rsvps-<slug>.csv"`
- **Response**: Streaming/raw CSV text with headers: `No,Nama Tamu,Status Kehadiran,Jumlah Tamu,Pesan,Waktu Konfirmasi`.
- **Formula Injection Mitigation**: Any value starting with `=`, `+`, `-`, `@`, `\t`, `\r` is prepended with `'` (single quote) and wrapped in quotes.

### 4. Delete RSVP
- **Method & Path**: `DELETE /api/v1/invitations/:id/rsvps/:rsvp_id`
- **Response**:
```json
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `invitations` | Read | Scoped by `id` and `owner_id = scope` and `deleted_at IS NULL`. |
| `invitation_guests` | Read / Delete | Read in list, summary, and export; row deleted in DELETE endpoint. |

Migration required: No. Uses existing `invitations` and `invitation_guests` tables.

## 6. Authorization

- **Caller**: Authenticated owner holding JWT (`@RequireAuth()`).
- **Enforcement**:
  - Service receives `TenantScope` (`req.user.scope`).
  - Repository ensures invitation exists and belongs to owner in the exact same query (`WHERE invitations.owner_id = :scope AND invitations.deleted_at IS NULL`).
  - If the invitation does not belong to the user, the query returns 0 rows, resulting in `NotFoundError` (HTTP 404). Never HTTP 403.
  - For `DELETE .../:rsvp_id`, the deletion ensures both `invitation_id = :id` and `invitations.owner_id = :scope`.

## 7. Validation and Sanitization

- `page`, `limit`, and `status` validated via Zod schema.
- Non-whitelisted fields rejected.
- CSV values escaped against formula injection.

## 8. State Transitions

None.

## 9. Side Effects

None.

## 10. Failure Modes

- DB failure: 500.
- Redis failure: rate limiter fails open for export reading.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Non-owner listing RSVPs | `docs/SECURITY/05` | 404 NOT_FOUND | non-owner access returns 404 for list |
| Non-owner viewing summary | `docs/SECURITY/05` | 404 NOT_FOUND | non-owner access returns 404 for summary |
| Non-owner exporting CSV | `docs/SECURITY/05` | 404 NOT_FOUND | non-owner access returns 404 for export |
| Non-owner deleting RSVP | `docs/SECURITY/05` | 404 NOT_FOUND | non-owner access returns 404 for delete |
| Cross-invitation RSVP deletion | `docs/SECURITY/05` | 404 NOT_FOUND | deleting RSVP belonging to another invitation returns 404 |
| CSV Formula Injection (`=cmd`, `@SUM`) | `docs/SECURITY/08` | Prepended with `'` | escapes formula characters in CSV export |
| Excessive export requests | `docs/SECURITY/10` | 429 when throttled | rate-limited under export policy |

## 12. Test Plan

- Integration tests in `backend/api/test/integration/owner-rsvp.itest.ts`:
  - Pagination and attendance status filtering.
  - SQL aggregation summary matching exact database counts.
  - CSV export format, headers, and formula injection escaping.
  - Delete RSVP functionality.
  - 404 isolation across non-owners for all four endpoints.
  - Deleting another invitation's RSVP fails with 404.
