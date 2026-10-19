# Change Record: P5-09 Moderation Queue

| | |
|---|---|
| **Task** | `P5-09` — Moderation Queue |
| **Date** | 2026-10-19 |
| **Author** | Agent |
| **Status** | Complete |

---

## 1. Summary

Implemented the complete platform moderation queue for wedding guestbooks across database, backend API, public guest reporting, and the administrative frontend UI:
- **Database Schema (Migration 0017)**:
  - Added `guestbook_reports` table linking to `invitation_guestbook.id` with `onDelete: 'cascade'`.
  - Captures optional report reason (max 500 chars), submitted IP hash, and creation timestamp.
  - Exported `guestbookReports` in `backend/api/src/infra/db/schema/invitations.ts`.
- **Public Guest Reporting Endpoint**:
  - `POST /public/i/:slug/guestbook/:entry_id/report` in `public-guestbook.controller.ts`.
  - Validates that the invitation exists, is published, and that the specified guestbook entry belongs to the invitation.
  - Applies rate limiting and validates payload using Zod (`publicGuestbookReportSchema`).
- **Administrative Moderation API**:
  - `GET /api/v1/admin/moderation/guestbook`: Paginated listing with search by guest name, message, or invitation slug; status filtering (`all`, `pending`, `approved`, `rejected`); and source filtering (`reported`, `auto_flagged`).
  - `PATCH /api/v1/admin/moderation/guestbook/:id`: Approve or reject guestbook entries with mandatory audit logging and real-time edge/Redis cache invalidation.
  - `DELETE /api/v1/admin/moderation/guestbook/:id`: Permanently delete guestbook entries with audit logging and immediate cache purging.
- **Admin Frontend UI (`ModerationPage.tsx`)**:
  - Fully interactive moderation dashboard at `/moderation`.
  - Search bar and status tabs with badge counts.
  - Flag source chips (`Dilaporkan Tamu`, `Filter Otomatis`, `Moderasi Pemilik`).
  - Visitor reports modal inspecting user-submitted report reasons.
  - Action buttons with confirmation dialogs for approving, rejecting, or deleting entries.

---

## 2. Files Changed

### Database & Migrations
- `backend/api/migrations/0017_guestbook_reports.sql` — Created migration adding `guestbook_reports`.
- `backend/api/migrations/0017_guestbook_reports.down.sql` — Rollback migration.
- `backend/api/src/infra/db/schema/invitations.ts` — Defined and exported `guestbookReports` table.

### Backend API
- `backend/api/src/shared/tenancy/guestbook-repository.ts` — Added `findEntryById` and `insertReport`.
- `backend/api/src/modules/guestbook/guestbook.service.ts` — Added `reportEntry` method.
- `backend/api/src/modules/guestbook/public-guestbook.controller.ts` — Added `POST :entry_id/report` endpoint.
- `backend/api/src/shared/sanitizer/registry.ts` — Registered `flag_source` in `NOT_USER_TEXT`.
- `backend/api/src/modules/admin/schemas/admin-moderation.schema.ts` — Added query and action validation schemas.
- `backend/api/src/modules/admin/admin-moderation.service.ts` — Implemented listing, approval/rejection, deletion, audit, and cache eviction.
- `backend/api/src/modules/admin/admin-moderation.controller.ts` — Mounted admin moderation endpoints.
- `backend/api/src/modules/admin/admin.module.ts` — Registered controller and service.
- `backend/api/test/idor-sweep-inventory.spec.ts` — Registered IDOR exemptions for admin moderation routes.
- `backend/api/test/admin-moderation.spec.ts` — 16 unit and integration tests.

### Admin Frontend
- `admin/src/pages/ModerationPage.tsx` — Replaced placeholder with full moderation UI.
- `admin/src/pages/moderation.spec.tsx` — 5 unit tests for moderation table, filtering, reporting modal, and actions.

### Documentation & Memory
- `MEMORY/DECISIONS.md` — Added ADR-104.
- `MEMORY/MEMORY-INDEX.md` — Added index entry.
- `MEMORY/CHANGELOG.md` — Added changelog summary.
- `TASKS/PROGRESS.md` — Updated counts (106 / 140 done, Phase 5: 9 / 14 done).
- `TASKS/PHASE-5-ADMIN-PANEL.md` — Marked P5-09 as DONE.

---

## 3. Decisions & Deviations

See **ADR-104** in `MEMORY/DECISIONS.md`.
- **Public Guest Reporting**: Guests can report abusive entries without creating an account; rate limiting and IP hashing prevent griefing.
- **Immediate Cache Purge**: Moderation actions on published invitations immediately evict cached versions in Redis and edge.

---

## 4. Test Verification

- `backend/api/test/admin-moderation.spec.ts`: 16 passed.
- `backend/api/test/idor-sweep-inventory.spec.ts`: 3 passed.
- `admin/src/pages/moderation.spec.tsx`: 5 passed.
- `pnpm --filter @wi/admin test`: 43 passed across 7 test files.
- `pnpm --filter @wi/admin build`: Success.
- `pnpm typecheck`: 19/19 packages passed.
- Scripts: `check-sanitized-fields.mjs`, `check-secrets.mjs`, `check-id-endpoint-tests.mjs` all passed.
