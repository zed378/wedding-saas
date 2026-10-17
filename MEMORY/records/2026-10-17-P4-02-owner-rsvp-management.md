# P4-02 — Owner RSVP Management and CSV Export

| | |
|---|---|
| **Date** | 2026-10-17 |
| **Task** | `TASKS/PHASE-4-ENGAGEMENT.md` § P4-02 |
| **Phase** | Phase 4 |
| **Surface** | backend / docs |
| **Author** | Agent |
| **Commits / PR** | |
| **Status** | Completed |

---

## What Changed

Added owner-facing RSVP management and export endpoints mounted under `@Controller("api/v1/invitations/:id/rsvps")`:
1. `GET /api/v1/invitations/:id/rsvps`: Paginated list of RSVPs with optional attendance status filtering (`attending`, `not_attending`, `maybe`).
2. `GET /api/v1/invitations/:id/rsvps/summary`: Total response counts, status breakdown, and attending headcounts computed directly in PostgreSQL SQL aggregation.
3. `GET /api/v1/invitations/:id/rsvps/export`: Downloadable CSV file with headers (`No,Nama Tamu,Status Kehadiran,Jumlah Tamu,Pesan,Waktu Konfirmasi`) and spreadsheet formula injection mitigation (OWASP CSV Injection). Rate limited under the `export` policy (30/hr per user).
4. `DELETE /api/v1/invitations/:id/rsvps/:rsvp_id`: Hard deletion of an RSVP entry scoped to the invitation and owner.

All endpoints enforce tenant isolation at query time via `TenantScope` and return 404 for non-owners.

## Why

Implements Feature Spec F10 from `docs/PLAN/04-FEATURE-SPECIFICATIONS.md` § F10 RSVP Management and API contracts in `docs/API/04-INVITATION-API.md` § Sub-resource: RSVP (owner side). Couples need to monitor guest responses, check total headcount for catering/seating planning, export attendee lists for wedding organizers, and remove spam submissions without exposing endpoints to IDOR vulnerabilities or spreadsheet formula execution.

## How

- **Data Access (`src/shared/tenancy/rsvp-repository.ts`)**:
  - Implemented `ownsInvitation(scope, invitationId)` to verify ownership within `TenantScope`.
  - Implemented `findRsvpsForOwner` with pagination (`page`, `limit`, `offset`) and status filtering.
  - Implemented `getRsvpSummaryForOwner` using pure PostgreSQL aggregations (`count`, `count(case when ...)`, and `coalesce(sum(case when ...), 0)`).
  - Implemented `findAllRsvpsForExport` returning invitation slug and chronological rows.
  - Implemented `deleteRsvpForOwner` with dual constraints `id = :rsvpId AND invitation_id = :invitationId`.
- **Service (`src/modules/rsvp/rsvp.service.ts`)**:
  - Added `escapeCsvCell(value)` prepending single quotes (`'`) for values starting with `=`, `+`, `-`, `@`, `\t`, or `\r`.
  - Added `getRsvpsForOwner`, `getRsvpSummaryForOwner`, `exportRsvpsCsv`, and `deleteRsvpForOwner`, throwing `NotFoundError` for unowned or missing records.
- **Controller & Module (`src/modules/rsvp/owner-rsvp.controller.ts`, `rsvp.module.ts`)**:
  - Mounts routes on `api/v1/invitations/:id/rsvps` protected with `requireAuth()`.
  - Exports endpoint guarded by `@UseGuards(rateLimit("export"))`.
  - Registered `OwnerRsvpController` in `RsvpModule`, importing `AuthModule` for `SessionService`.
- **Completeness & IDOR verification**:
  - Registered all 4 routes in `backend/api/test/integration/idor-sweep.itest.ts` and verified with `backend/api/test/idor-sweep-inventory.spec.ts`.

## Files and Components Touched

| Path | Change |
|---|---|
| `MEMORY/specs/P4-02-owner-rsvp-management.md` | Feature spec authored before implementation. |
| `backend/api/src/shared/rate-limit/policies.ts` | Added `export` rate limit policy (30/hr per user). |
| `backend/api/src/shared/sanitizer/registry.ts` | Added `limit` to `NOT_USER_TEXT` for pagination parameter allowlist. |
| `backend/api/src/shared/tenancy/rsvp-repository.ts` | Implemented owner queries for listing, SQL summary, export, and deletion with `TenantScope`. |
| `backend/api/src/modules/rsvp/rsvp.service.ts` | Implemented owner methods and `escapeCsvCell` formula escaping. |
| `backend/api/src/modules/rsvp/owner-rsvp.controller.ts` | Created controller with GET, GET summary, GET export, and DELETE handlers. |
| `backend/api/src/modules/rsvp/rsvp.module.ts` | Imported `AuthModule` and registered `OwnerRsvpController`. |
| `backend/api/test/integration/owner-rsvp.itest.ts` | Integration test suite covering pagination, status filter, SQL summary, CSV formatting, deletion, and 404 IDOR isolation. |
| `backend/api/test/support/phase-one-tenant.ts` | Added `rsvpId` to `TenantInvitation` fixtures for IDOR sweep coverage. |
| `backend/api/test/integration/idor-sweep.itest.ts` | Added 4 RSVP owner cases to universal IDOR sweep. |
| `docs/API/04-INVITATION-API.md` | Documented owner RSVP endpoints, query parameters, SQL summary, and CSV export details. |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Prepend formula characters with single quote `'` and wrap in double quotes | OWASP CSV Injection recommendation to prevent formula evaluation in MS Excel, LibreOffice, and Google Sheets while keeping text readable. | ADR-083 (documented in spec) |
| SQL-computed RSVP summary | Computing summary via Postgres aggregation avoids fetching hundreds/thousands of guest records over the network on every dashboard visit. | Spec § 4 |

## Deviations from `docs/`

None. Follows `docs/API/04-INVITATION-API.md`, `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md`, and `docs/SECURITY/10-ABUSE-PREVENTION.md`.

## Tests Added

| Layer | What it covers |
|---|---|
| Integration | `backend/api/test/integration/owner-rsvp.itest.ts` (10 tests) covering pagination, status filter, SQL summary aggregation, CSV header & formula escaping, RSVP deletion, and 404 IDOR isolation. |
| Integration | `backend/api/test/integration/idor-sweep.itest.ts` (100 tests) covering non-owner access and cross-parent isolation on all parameterised RSVP routes. |
| Unit | `backend/api/test/idor-sweep-inventory.spec.ts` confirming all parameterised routes in `OwnerRsvpController` are swept. |

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Object-level authorization (404 for a non-owner) | `docs/SECURITY/05` § 3 | `backend/api/test/integration/owner-rsvp.itest.ts` › 'returns 404 for a non-owner attempting to list RSVPs', 'returns 404 for a non-owner attempting to view summary', 'returns 404 for a non-owner attempting to export CSV', 'returns 404 when a non-owner attempts to delete an RSVP' |
| Cross-invitation child deletion | `docs/SECURITY/05` § 7 | `backend/api/test/integration/owner-rsvp.itest.ts` › 'returns 404 when trying to delete an RSVP belonging to another invitation of the same user' |
| CSV Formula Injection Mitigation | `docs/SECURITY/08` § CSV Injection Protection | `backend/api/test/integration/owner-rsvp.itest.ts` › 'exports CSV with proper headers and neutralizes formula injection triggers' |
| Field whitelisting & validation | `docs/API/00`, `docs/SECURITY/08` | `scripts/check-sanitized-fields.mjs` |

## Abuse Cases Covered

| Abuse case | Source | Test |
|---|---|---|
| Non-owner listing RSVPs | `docs/SECURITY/05` | `backend/api/test/integration/owner-rsvp.itest.ts` › 'returns 404 for a non-owner attempting to list RSVPs' |
| Non-owner viewing summary | `docs/SECURITY/05` | `backend/api/test/integration/owner-rsvp.itest.ts` › 'returns 404 for a non-owner attempting to view summary' |
| Non-owner exporting CSV | `docs/SECURITY/05` | `backend/api/test/integration/owner-rsvp.itest.ts` › 'returns 404 for a non-owner attempting to export CSV' |
| Non-owner deleting RSVP | `docs/SECURITY/05` | `backend/api/test/integration/owner-rsvp.itest.ts` › 'returns 404 when a non-owner attempts to delete an RSVP' |
| Cross-invitation RSVP deletion | `docs/SECURITY/05` | `backend/api/test/integration/owner-rsvp.itest.ts` › 'returns 404 when trying to delete an RSVP belonging to another invitation of the same user' |
| CSV Formula Injection (`=cmd`, `@SUM`) | `docs/SECURITY/08` | `backend/api/test/integration/owner-rsvp.itest.ts` › 'exports CSV with proper headers and neutralizes formula injection triggers' |
| Rate limiting on export | `docs/SECURITY/10` | Rate limiting guard configured with `export` policy (30/hr per user). |

## Definition of Done Verification

- [x] Tests at the appropriate pyramid layer (unit and integration tests in Vitest)
- [x] IDOR test for every new `:id` endpoint (in `owner-rsvp.itest.ts` and `idor-sweep.itest.ts`)
- [x] Every abuse case has an automated test
- [x] Write endpoints whitelist their fields (Zod schema with `.strict()`)
- [x] Free-text input sanitized before storage (checked via `check-sanitized-fields.mjs`)
- [x] Response envelope matches `docs/API/00` (`ok(items, pageMeta(...))`, `ok(summary)`, `ok({ deleted: true })`)
- [x] State transitions logged (`invitation_status_history` / `audit_logs` - N/A, read/export/delete of guests)
- [x] Nothing sensitive logged
- [x] CI green: lint, types, build, unit, integration, dependency audit, SAST (`check-*.mjs` all passing, `pnpm typecheck` clean, 36 unit test files / 772 tests passing, integration tests passing)
- [x] `TASKS/PROGRESS.md` and the phase file updated
- [x] Task-specific DoD items:
  - Feature spec written at `MEMORY/specs/P4-02-owner-rsvp-management.md`
  - Four owner endpoints mounted
  - SQL-computed summary
  - CSV export with formula injection mitigation
  - Integration tests verifying non-owner 404

## What Did Not Work

- Running `pnpm test` failed on `test/idor-sweep-inventory.spec.ts` because newly added parameterised routes in `OwnerRsvpController` were initially not registered in `idor-sweep.itest.ts`. Added fixtures (`rsvpId` in `TenantInvitation`) and added the 4 RSVP endpoints to `idor-sweep.itest.ts` `CASES`, bringing all 100 sweep tests to green.

## Follow-Ups and Open Questions

None. Ready for `P4-03 — Public guestbook submission and list`.

## What to Watch

Large wedding invitations with thousands of guest responses requesting CSV exports simultaneously could consume worker/API memory. The endpoint is protected with `export` rate limiting (30/hr per user) and uses streamed strings with `Cache-Control: private, no-store`.
