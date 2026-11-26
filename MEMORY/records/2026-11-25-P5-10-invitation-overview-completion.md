# P5-10 — Complete the operational invitation overview

| | |
|---|---|
| Date | 2026-11-25 |
| Task | TASKS/PHASE-5-ADMIN-PANEL.md § P5-10 |
| Phase | Phase 5 |
| Surface | backend, admin |
| Author | Coding agent |
| Commits / PR | Uncommitted shared parallel implementation |
| Status | Partially completed — integration and phase security review pending |

## What Changed

Completed the missing admin invitation search/detail UI and corrected the partial API. Every list result now produces an actor/resource audit row in the same transaction as the read, including a search audit event for empty searches. Detail returns template version, all order statuses, publication/expiry and status histories using snake_case and string amounts, without couple content.

## Why

API/09 Invitation Overview and PLAN/12 section 6 require support search without editing content. SECURITY/05 Special Case requires every deliberate ownership bypass to be auditable. The older 2026-10-21 record described only an API implementation; its completion claims do not establish UI completion or list audit coverage.

## How

The service exposes a separately named adminFindInvitationsBypassingOwnership path and a transaction that must successfully insert audit rows before returning data. Detail retains the existing audited repository bypass, including unknown-ID probes. The UI uses ApiClient with the in-memory token store, aborts superseded requests, has separate list/detail loading/error states, and never fills failures with demonstration customer data.

## Files and Components Touched

| Path | Change |
|---|---|
| backend/api/src/modules/admin/admin-invitations.service.ts | Audited list transaction, operational projections, complete order/template histories |
| backend/api/src/modules/admin/admin-invitations.controller.ts | Pass authenticated actor to list; UUID validation |
| backend/api/src/modules/admin/schemas/admin-invitation.schema.ts | Sanitize and validate stored audit reasons |
| backend/api/test/admin-invitations.spec.ts | Actor propagation, correct response fixtures, malformed input, read-only route absence, throttling |
| backend/api/test/admin-invitations-audit.spec.ts | Four service audit boundary tests |
| backend/api/test/integration/admin-invitations.itest.ts | Two real-database SQL/audit regression tests |
| admin/src/pages/InvitationsPage.tsx | Search, paging, read-only operational detail and error handling |
| admin/src/pages/InvitationsPage.spec.tsx | Three component workflow/error tests |
| MEMORY/specs/P5-10-admin-invitation-overview.md | Feature spec written before source changes |
| MEMORY/records/2026-11-25-P5-10-invitation-overview-completion.md | This record |

App route and sidebar wiring are performed by the coordinating agent. Shared TASKS/MEMORY indexes are also coordinated there.

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Per-result audit rows plus one search event | Identifies every exposed invitation and detects empty enumeration; fails closed on audit error | Existing SECURITY/05 requirement |
| Decimal amount strings on the wire | Drizzle returns bigint; JSON cannot serialize bigint directly | Existing API/00 convention |
| Do not add a factor-only MFA guard | Enrollment does not prove a session completed MFA; adding such a guard would overstate security | Escalated to coordinator for BACKLOG/P5-14 |

## Deviations from docs/

No new endpoint or schema deviation. The response corrects existing camelCase to API/00 snake_case. A pre-existing security gap remains: standard access JWTs have no verified-MFA session claim; SessionService rereads role but cannot distinguish an admin session that completed MFA from an ordinary session minted before role elevation. MFA tickets have a separate audience, but that alone does not resolve ordinary token/refresh issuance paths. This work makes no claim that MFA bypass is fixed.

## Tests Added

| Layer | Coverage / result |
|---|---|
| HTTP + unit | admin-invitations.spec.ts and admin-invitations-audit.spec.ts: 18 passed together |
| Component | InvitationsPage.spec.tsx: 3 passed |
| Integration | admin-invitations.itest.ts: two cases added; first sandbox run could not reach Docker; escalated auto-container run failed before cases because migration requires wedding_app role. Coordinator will rerun serially against bootstrapped PostgreSQL |
| Types | admin tsc passed; API tsc had only concurrent admin-dashboard test errors at that time |
| E2E / visual | Not run in this subtask; required review remains P5-14 |

## Security Verification

| Control | Source | Test that proves it |
|---|---|---|
| Every list result audited with actor | SECURITY/05 | audits the admin identity and every listed invitation before returning |
| Empty search detectability | P5-10 step 5 | records even an empty search so enumeration remains detectable |
| Audit fail closed | SECURITY/00 | fails closed when the list audit insert fails |
| Unknown detail audited 404 | SECURITY/05 | routes unknown detail reads through the audited bypass and returns 404 (unit); real-DB regression added, pending successful execution |
| Role restriction, no existence leak | API/09 | rejects regular users with 403; rejects regular user detail request with 403 |
| No unauthenticated enumeration | SECURITY/03 | rejects unauthenticated requests with 401; rejects unauthenticated detail request with 401 |
| Rate policy enforced | SECURITY/10 | rate limits repeated admin enumeration before exposing any invitation |
| Content mutation absent | API/09 | provides no invitation-content mutation endpoint |
| Stored audit reason sanitization | SECURITY/08 | rejects invalid pagination and sanitized-away audit reasons |
| Payment / upload mutation | SECURITY/07, SECURITY/06 | Not applicable: this surface has no mutation or upload |
| MFA session proof | SECURITY/03 | Not verified; unresolved broader issuance/session gap documented above |

## Abuse Cases Covered

Unauthenticated reads, ordinary-user enumeration, malformed UUID, oversized pagination, script-only audit reasons, write attempts against read-only detail, list-audit database failure, empty-result enumeration and rate-limited enumeration all have named tests above. Private title exclusion and per-ID audit persisted SQL assertions are in the added integration suite, awaiting coordinator run.

## Definition of Done Verification

- [x] Unit/controller/component tests at the relevant layers passed.
- [x] Admin-specific role denials tested for list/detail; owner API and its IDOR contracts unchanged.
- [x] Writes to invitation content are absent; endpoint attempts return 404.
- [x] API field names and bigint serialization corrected.
- [x] All exposed list IDs and unknown detail probes use audit boundaries.
- [x] No secrets, bank numbers, couple content or raw callbacks added to DTOs/logs.
- [ ] Real database regression run successful.
- [ ] Full suite, integration, security scans and browser QA green.
- [ ] MFA session issuance gap resolved or formally tracked before phase acceptance.
- [ ] Coordinator updates TASKS board and MEMORY index/changelog; task remains REVIEW rather than DONE pending evidence.

No unmet item was waived.

## What Did Not Work

Initial apply_patch took several minutes to finish, so subsequent writes used bounded base64 node commands. Windows command line size prevented a single large UI write; split writes worked. pnpm was not on the available PATH; local node_modules/vitest/vitest.mjs and TypeScript entry points worked. First service test stub returned a Promise too early in a Drizzle chain; corrected the stub so missing orderBy calls no longer mask the audit behavior. An initial order projection retained bigint and was corrected before delivery.

## Follow-Ups and Open Questions

Coordinator owns serial PostgreSQL run, full suite, route/sidebar integration, visual inspection and shared progress updates. P5-14 must cover the existing MFA issuance gap; no enrollment-only substitute was implemented. No new product question was introduced.

## What to Watch

List searches write one audit event plus one row per displayed invitation (maximum 100), so audit storage and query latency should be monitored. Detail order history is complete rather than only latest paid order; very large renewal histories may eventually need pagination. Current general-authenticated rate budget is shared with other admin reads.

## Parallel continuation evidence — 2026-11-25

The backend review added `validation_summary` to detail responses: required-content readiness, missing-field count, and incomplete section keys. `AdminInvitationsService` reuses the exported generic `PublishCheckService` in strict mode, deriving the owner scope only after the authenticated admin's audited bypass succeeds. It returns neither field values nor validator descriptions. This is content completeness, not payment/slug publish eligibility. The UI lane coordinated the same DTO; the coordinator owns shared API contract/index changes.

Additional files touched in this continuation: `backend/api/src/modules/admin/admin-invitations.service.ts`, `backend/api/test/admin-invitations-audit.spec.ts`, and `backend/api/test/integration/admin-invitations.itest.ts`. No schema, lifecycle, upload, or payment mutation changed. The added unit test is `uses the audited invitation owner for completeness and exposes no field values`; it asserts audit-before-check ordering, owner scope, strict mode, and omitted field descriptions. The SQL test also checks the completeness summary. These new assertions were written but were not successfully reverified in this continuation.

Before that final completeness delta, five focused backend files (`admin-invitations`, `admin-invitations-audit`, `admin-dashboard`, `admin-audit-logs`, `admin-http`) passed all 42 tests, and API TypeScript passed. The final typecheck reported only concurrent Google OAuth `LoginResult` union-narrowing errors, later assigned to the coordinator; no admin-core diagnostic appeared. Prettier completed on all three touched code files.

The final five-file unit rerun hit 10-second Nest HTTP `beforeAll` timeouts under severe host slowdown and was canceled. A separate three-file SQL run used the newly created `wedding_core_review` database inside the existing dedicated PostgreSQL container, avoiding shared-database truncation; it produced only the RUN banner for several minutes and was canceled at the coordinator's request. Neither attempt proves the final delta passed. A temporary runner was removed. The coordinator owns process cleanup, a sequential final retry, global checks and task closure; all existing unchecked DoD items remain open.
