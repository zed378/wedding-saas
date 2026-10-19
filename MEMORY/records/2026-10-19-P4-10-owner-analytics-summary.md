# P4-10 — Owner Analytics Summary

| | |
|---|---|
| **Date** | 2026-10-19 |
| **Task** | `TASKS/PHASE-4-ENGAGEMENT.md` § P4-10 |
| **Phase** | Phase 4 — Engagement |
| **Surface** | backend, web-app |
| **Author** | Agent |
| **Status** | Completed |

---

## What Changed

- Implemented `GET /api/v1/invitations/:id/analytics` returning total and daily page opens, RSVP response breakdown by attendance status, total confirmed attending guests, and guestbook messages by moderation status.
- Added brief 30-second Redis caching on analytics summaries to protect the primary database against frequent refresh storms before the wedding day.
- Implemented `getGuestbookSummaryForOwner` in `GuestbookRepository` with SQL-aggregated counts.
- Created dedicated owner analytics dashboard page at `/dashboard/[invitationId]/analytics` in `frontend/web-app` featuring honest metric labeling, daily visit breakdown, RSVP counters, and guestbook moderation totals.
- Added accessible "Statistik" link to `InvitationCard` in `frontend/web-app`.

## Why

Implements `docs/PLAN/14-ANALYTICS.md` § MVP, `docs/PLAN/04` § F10, and ADR-094. Couplers need a consolidated, honest overview of invitation performance (page opens, RSVP headcount, guestbook messages) without misleading metrics ("page opens" is not "unique visitors"). In the days leading up to the ceremony, anxious couples refresh this page repeatedly; brief Redis caching prevents database degradation.

## How

1. **Owner Analytics Endpoint**: Mounted at `GET /api/v1/invitations/:id/analytics` via `OwnerAnalyticsController`. Enforces authentication (`requireAuth()`) and query-level tenant scoping (`RsvpRepository.ownsInvitation(scope, id)`). Non-owners and soft-deleted invitations unconditionally return 404 (zero IDOR tolerance).
2. **Aggregated Metrics**:
   - Page Views: Queried via `AnalyticsRepository.getViewSummary(scope, invitationId)` and combined with today's unflushed in-memory Redis views from `analytics:views:pending`.
   - RSVP: Queried via `RsvpRepository.getRsvpSummaryForOwner(scope, invitationId)` returning total responses, counts for attending/not_attending/maybe, and total attending guest headcount.
   - Guestbook: Queried via `GuestbookRepository.getGuestbookSummaryForOwner(scope, invitationId)` returning total messages, pending, approved, and rejected counts.
3. **Short TTL Caching**: Results are stored in Redis under key `analytics:${invitationId}` with 30s TTL via `CachePort`. If Redis is degraded, it fails open directly to Postgres.
4. **Honest Metric Presentation**:
   - The UI explicitly states: *"Angka di atas adalah total berapa kali halaman dibuka, bukan jumlah orang atau tamu unik. Platform kami menjaga privasi tanpa menyimpan IP, cookie pengenal, atau data pribadi pengunjung pasif."*
   - Daily visit breakdown displays bar charts for the past 14 days.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/shared/tenancy/guestbook-repository.ts` | Added `getGuestbookSummaryForOwner` SQL aggregation |
| `backend/api/src/modules/analytics/analytics.service.ts` | Added `getAnalyticsSummary` with brief 30s Redis caching and pending views merge |
| `backend/api/src/modules/analytics/owner-analytics.controller.ts` | Implemented `GET /api/v1/invitations/:id/analytics` |
| `backend/api/src/modules/analytics/analytics.module.ts` | Registered `OwnerAnalyticsController` |
| `backend/api/test/analytics.spec.ts` | Added unit tests for `getAnalyticsSummary` and `OwnerAnalyticsController` |
| `backend/api/test/integration/idor-sweep.itest.ts` | Registered `GET /invitations/:id/analytics` in IDOR sweep cases |
| `frontend/web-app/src/lib/invitations.ts` | Added `InvitationAnalytics` interface and `getInvitationAnalytics` API helper |
| `frontend/web-app/src/components/InvitationCard.tsx` | Added accessible "Statistik" link to invitation card |
| `frontend/web-app/src/app/(app)/dashboard/[invitationId]/analytics/page.tsx` | Implemented owner analytics dashboard page |
| `frontend/web-app/test/analytics-dashboard.spec.tsx` | Unit tests for analytics dashboard page and card link |
| `MEMORY/DECISIONS.md` | Added ADR-094 |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| 30-second Redis cache on analytics summary | Protects Postgres against refresh storms by anxious couples in the week before the wedding | ADR-094 |
| Merge pending in-memory Redis views | Allows owners to see near real-time view updates without waiting for the 1-minute write-behind flush | ADR-094 |
| Dedicated page `/dashboard/[invitationId]/analytics` | Clean responsive layout that scales to mobile (360px) and provides room for honest explanatory labels | ADR-094 |
| Strict honest labeling | MVP does not track unique visitors/devices; calling page opens "pengunjung unik" would mislead couples | ADR-094 |

## Deviations from `docs/`

None. Follows `docs/PLAN/14-ANALYTICS.md` § MVP and `docs/PLAN/04` § F10.

## Tests Added

| Layer | What it covers |
|---|---|
| Unit (`backend/api/test/analytics.spec.ts`) | Cache hit return without DB query, 404 on non-owner (IDOR safety), full metric aggregation (views, rsvps, guestbook, pending views), 30s cache write, controller standard envelope response. |
| IDOR Sweep (`backend/api/test/integration/idor-sweep.itest.ts`) | Registered `GET /invitations/:id/analytics` in sweep cases; verified covered by `idor-sweep-inventory.spec.ts`. |
| Unit (`frontend/web-app/test/analytics-dashboard.spec.tsx`) | "Statistik" accessible link in `InvitationCard`, loading and error states with retry, honest labeling rendered, metric displays for views, RSVPs, and guestbook. |

## Security Verification

| Control | How it was tested |
|---|---|
| Object-level authorization | `RsvpRepository.ownsInvitation(scope, invitationId)` validated in `AnalyticsService.getAnalyticsSummary`; non-owners receive 404 `NotFoundError` (never 403 or data). Covered in `test/analytics.spec.ts` and `idor-sweep-inventory.spec.ts`. |
| Input validation | UUID format validated via `tenantScope(user.id)` and standard route parameter constraints. |
| Cache isolation | Cache key is scoped by `invitationId` and access is verified against tenant scope before returning cached data. |

## Abuse Cases Covered

- **Repeated dashboard refresh**: 30-second Redis cache collapses repeated queries from anxious couples into a single database read every 30 seconds.
- **IDOR probe by another logged-in user**: Requesting another tenant's invitation ID returns 404 indistinguishably from non-existent invitations.

## DoD Verification

- [x] The endpoint is ownership-scoped and returns the four metric groups.
- [x] Numbers match the underlying tables in a seeded test.
- [x] Labels do not overstate what is measured.
- [x] All 799 tests in `@wi/api` and 400 tests in `@wi/web-app` pass.
- [x] `scripts/check-tenant-scope.mjs`, `scripts/check-id-endpoint-tests.mjs`, `scripts/check-secrets.mjs` pass.
- [x] `pnpm typecheck` passes across all 13 packages.
- [x] ADR-094 recorded in `MEMORY/DECISIONS.md`.

## Follow-ups

- `P4-11` (Frontend Engagement Screens) will wire `RsvpTable` and `GuestbookModerationList` for full owner moderation and CSV export.
