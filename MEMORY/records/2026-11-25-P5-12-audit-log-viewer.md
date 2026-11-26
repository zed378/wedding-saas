# P5-12 — Audit Log Viewer and Audited Investigation Export

| | |
|---|---|
| **Date** | 2026-11-25 |
| **Task** | `TASKS/PHASE-5-ADMIN-PANEL.md` § P5-12 |
| **Phase** | Phase 5 |
| **Surface** | backend, admin |
| **Author** | Coding agent |
| **Commits / PR** | Uncommitted implementation on the shared Phase 5 working branch |
| **Status** | REVIEW — implemented; global verification and Phase 5 security acceptance remain open |

## What Changed

Replaced the admin audit placeholder with an authenticated API-backed viewer, actor/resource/date filters, pagination, readable changed-field before/after snapshots, loading/empty/error states, and a JSON export action. The existing API now also accepts `resource_id`, rejects reversed date ranges, orders equal timestamps consistently by UUID, and redacts historical sensitive snapshot fields on both list and export responses.

`GET /api/v1/admin/audit-logs/export` exports all filtered rows, independently of the currently displayed page, up to 10,000 rows. Larger results fail with a validation error rather than silently truncating investigation evidence. The export reads a repeatable PostgreSQL snapshot and commits an `audit_log.export` record naming the acting admin, generated export ID, applied filters, and row count before returning data. Failure to write that record prevents an export response.

## Why

Implements `TASKS/PHASE-5-ADMIN-PANEL.md` § P5-12, `docs/API/09-ADMIN-API.md` § Audit Log, `docs/DATABASE/10-AUDIT-LOGS.md` § Policy, and `docs/SECURITY/12-INCIDENT-RESPONSE.md` § Evidence Preservation. The interface explicitly states append-only behavior and **minimum** two-year retention; it does not imply a maximum retention period or implement deletion.

## How

The UI uses `ApiClient` and its in-memory bearer token store; it does not substitute mock data after failures. Native controls submit filter parameters to SQL rather than filtering a single page in the browser. React renders snapshot values as text, so stored markup is escaped. The diff identifies top-level added, removed, and changed fields, with expandable full JSON snapshots for nested data.

The list and export share one explicitly selected DTO mapping and filter builder. Existing `@wi/logging` redaction runs again at read time to protect historical rows that may predate writer redaction. The export audit insertion uses `AuditLogService.record` inside the same database transaction as its repeatable read. There is no audit-row mutation endpoint and no change to database grants.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/admin/schemas/admin-action.schema.ts` | Resource UUID filter and chronological date-range validation |
| `backend/api/src/modules/admin/audit-logs.controller.ts` | Authenticated, role-gated JSON export endpoint |
| `backend/api/src/modules/admin/audit-logs.service.ts` | Shared query, deterministic ordering, read-time redaction, transactional audited export |
| `backend/api/test/admin-audit-logs.spec.ts` | SQL construction, export, redaction, validation, HTTP authorization, append-only surface tests |
| `backend/api/test/integration/admin-audit-logs.itest.ts` | Real PostgreSQL filter/pagination/export/source-preservation tests |
| `admin/src/pages/AuditLogsPage.tsx` | API-backed investigation viewer and JSON download |
| `admin/src/pages/audit-logs.spec.tsx` | UI data loading, filters, pagination, diff escaping, export, and failure states |
| `admin/src/App.phase5.spec.tsx` | Focused invitation/blocklist URL, sidebar-navigation and role-boundary integration tests |
| `MEMORY/records/2026-11-25-P5-12-audit-log-viewer.md` | This record |

Shared API documentation, ADR, task-board, index, and changelog changes are coordinated by the parent implementation task rather than edited by parallel agents.

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| JSON export limited to 10,000 rows, with an error above the cap | Bounded application memory without silently losing incident evidence; investigators narrow filters for larger sets | Shared API completion ADR |
| `audit_log.export` audit row references a generated export UUID | A bulk read represents one export, not one arbitrary source row; actor/filter/count metadata identifies what was accessed | Shared API completion ADR |
| Repeatable-read transaction for export count, rows, and audit insertion | Ensures one consistent export snapshot and no successfully returned export without its audit event | Implementation detail |
| Reuse existing redactor at response time | Historical snapshots may contain secrets even though current writers already redact them | Existing DATABASE/10 policy |

These complete the task card's explicit export/resource-filter requirements. The associated API documentation and ADR are maintained in the shared change.

## Deviations from `docs/`

API/09 originally listed neither the task-required `resource_id` filter nor the bulk-export route. The shared documentation change records these additive contract details. Retention remains the documented minimum of two years; no retention policy is weakened.

## Tests Added and Run

| Layer | Evidence |
|---|---|
| Backend unit/HTTP | `test/admin-audit-logs.spec.ts` plus existing `test/admin-http.spec.ts`: **18 passed**, of which 11 are new P5-12 tests |
| UI | `src/pages/audit-logs.spec.tsx`: **5 passed** |
| Full admin regression suite | `node node_modules/vitest/vitest.mjs run` in `admin/`: **11 files / 59 tests passed** before adding the separate Phase 5 routing suite |
| Real database integration | `test/integration/admin-audit-logs.itest.ts`: 2 tests added. First sandbox attempt could not access a Docker runtime. Escalated isolated Testcontainers attempt started PostgreSQL but failed migrations because the harness did not create the `wedding_app` role before migration `0006` grants; neither audit test body ran. Coordinated shared-container verification is pending |
| TypeScript | Admin `tsc --noEmit -p admin/tsconfig.json` passed. API check reported only concurrent `admin-dashboard.spec.ts` fixture errors at this checkpoint; no P5-12 diagnostics |
| Formatting | Local Prettier ran successfully on every changed P5-12 TypeScript/TSX file |
| Visual browser QA | Browser skill read and bootstrap attempted, but the browser execution tool rejected missing `sandboxPolicy` metadata before connection. No screenshots or visual-layout verification claimed |
| Full suite / build / SAST | Parent task coordinates these checks; no claim of completion in this record |

Commands used local dependency entrypoints through `rtk proxy node ...`, because pnpm was absent from the terminal PATH. Calling the filtered `rtk pnpm` also failed due to missing Claude configuration; no dependency installation or package change was needed.

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Anonymous and non-admin access denied for list and export | SECURITY/04, API/09 | `admin-audit-logs.spec.ts`: `rejects anonymous and regular user reads at %s` |
| Export audit bound to authenticated actor | DATABASE/10 | `passes authenticated actor and validated filters to audited export`; `exports every matching page and audits the actor, filters and row count before returning` |
| No export when audit insertion fails | DATABASE/10, SECURITY/12 | `returns no export if writing its audit trail fails` |
| Historical credential and callback privacy | DATABASE/10, SECURITY/07 | `redacts historical credentials and callback data on both list and export` |
| Stored markup rendered as text | SECURITY/08 | `audit-logs.spec.tsx`: `shows changed, added and removed fields while escaping stored HTML` |
| Read-only audit API surface | DATABASE/10 | `provides no creation, update or delete endpoint for audit rows` |
| Parameterized resource/date filters and bounded page size | API/09 | `applies every filter in SQL and paginates in stable newest-first order`; `rejects invalid IDs, dates, reversed ranges and unbounded pagination` |
| Ownership/IDOR | SECURITY/05 | No new `:id` endpoint or customer resource mutation; administrative log collection is role gated by the named HTTP tests above |
| Payment-status integrity / upload validation | SECURITY/07, SECURITY/06 | Not applicable: no payment or upload write path touched |
| MFA session enforcement | SECURITY/03 | Not verified by this task. Existing authentication/role guards remain unchanged; the broader MFA token-issuance enforcement gap discovered during parallel review remains a Phase 5 acceptance gate |

## Abuse Cases Covered

| Abuse case | Test |
|---|---|
| Regular customer exports administrative evidence | `rejects anonymous and regular user reads at %s` |
| Invalid UUID/date filters reach database | `rejects malformed filters before reading or exporting` |
| Bulk export bypasses auditing or truncates evidence silently | `returns no export if writing its audit trail fails`; `rejects oversized export instead of silently truncating evidence` |
| Credential-containing historical snapshots escape through JSON export | `redacts historical credentials and callback data on both list and export` |
| Stored script becomes executable during snapshot inspection | `shows changed, added and removed fields while escaping stored HTML` |
| Admin edits/deletes audit evidence through a newly added route | `provides no creation, update or delete endpoint for audit rows` |

## Definition of Done Verification

- [x] Appropriate backend and UI tests added and focused tests passed.
- [x] No new `:id` endpoint; ownership endpoint inventory is unchanged.
- [x] Task abuse cases have named tests above.
- [x] Export accepts only validated query fields; no customer write/body mass assignment.
- [x] No new stored user free text; export reason is an internal constant and snapshot redaction is tested.
- [x] Existing `ok(...)` response envelope is preserved for list and export.
- [x] Export access is logged transactionally; no invitation state transition exists here.
- [x] Snapshot credential and callback values are redacted; no new runtime data logging.
- [ ] Global lint/build/full unit/full integration/dependency audit/SAST verification remains coordinated by parent task.
- [ ] Shared TASKS/MEMORY index/changelog closure remains coordinated by parent task.
- [x] All requested filters, pagination, readable before/after diff, append-only interface and audited bulk export implemented.
- [ ] Real-database integration proof awaits the coordinated working harness described above.

No global requirement is silently waived and the task is not declared DONE here.

## What Did Not Work

The initial patch attempted delete-and-add of the same file in one operation; the tool rejected the duplicate target, so the existing placeholder was replaced with one update operation. Several tool calls initially waited for shell/approval processing; writes were read back before any retry. Direct pnpm commands were unavailable, so existing local Node package entrypoints were used.

The standalone Testcontainers harness starts an owner role but migration `0006` expects `wedding_app` already to exist. This is a harness/environment bootstrap failure, not an audit feature test failure, and is recorded rather than reported as passed coverage.

## Follow-Ups and Open Questions

`P5-14` owns end-to-end Phase 5 acceptance, including broader MFA session enforcement and complete admin-write audit coverage. The parent task owns the coordinated database verification and global verification results before task closure. API/09/shared ADR/index/board changes must be included with this implementation.

## What to Watch

Export failures above 10,000 matching rows should prompt narrower investigation filters, not a larger unbounded payload. Monitor audit-export volume and database latency; each successful export creates one additional immutable audit event. Snapshot redaction intentionally replaces secrets in returned evidence while retaining the original stored audit row; restricted database forensics may still be required to preserve originals under the incident-response process.

## Parallel continuation evidence — 2026-11-25

A backend review found no additional audit-viewer change necessary. Five focused admin backend files passed all 42 tests, including `admin-audit-logs.spec.ts` and `admin-http.spec.ts`. A later concurrent rerun hit a 10-second HTTP setup timeout under severe host slowdown and was canceled. A fresh isolated `wedding_core_review` database avoided conflicting with other lanes, but the combined three-file SQL retry remained at its RUN banner for several minutes and was canceled at the coordinator's request. No audit SQL test or final global-check success is claimed by this continuation. The coordinator owns process cleanup, sequential final verification and task closure.
