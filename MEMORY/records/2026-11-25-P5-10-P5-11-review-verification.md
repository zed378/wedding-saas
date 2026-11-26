# P5-10 / P5-11 — Review verification and invitation transport repair

| | |
|---|---|
| Date | 2026-11-25 |
| Tasks | TASKS/PHASE-5-ADMIN-PANEL.md § P5-10 and P5-11 |
| Phase / surface | Phase 5 / admin and backend verification |
| Author | Coding agent |
| Commits / PR | Shared uncommitted continuation |
| Status | Focused verification complete; coordinated global verification pending |

## What Changed

Fixed the invitation overview's API origin. It previously constructed `ApiClient` with an empty base URL, while the real client constructs an absolute `URL`; every live request therefore failed before fetch. The existing workflow tests replaced the entire client and could not detect this defect. A new transport test exercises the real client for both list and detail, checking absolute URLs and bearer authentication.

## Why

P5-10 and API/09 Invitation Overview require a usable authenticated support interface. This continuation verifies existing REVIEW work instead of advancing to Phase 6. Mandatory reading included TASKS/PROGRESS and the phase cards, MEMORY index and prior task records, PLAN/00, PLAN/16, PLAN/12, PLAN/14, API/09, SECURITY/05 and SECURITY/07, and the P5-10 feature spec.

## How

The page now follows the existing dashboard origin convention: localhost API on port 3000 and same origin on the deployed admin host. The transport regression stubs fetch, preserving the production URL building and token store. No service, endpoint, schema or business rule changed.

## Files and Components Touched

| Path | Change |
|---|---|
| admin/src/pages/InvitationsPage.tsx | Supply absolute API origin |
| admin/src/pages/InvitationsPage.transport.spec.tsx | Real-client authenticated list/detail regression |
| backend/api/test/integration/admin-invitations.itest.ts | Correct incomplete factory expectation; add actual missing-to-complete content regression |
| MEMORY/records/2026-11-25-P5-10-P5-11-review-verification.md | This follow-up evidence |

## Decisions Made

Reuse the established dashboard routing convention; no new architectural choice or ADR. Historical records remain unchanged.

## Deviations from docs/

None. Anti-slop skill files referenced by repository instructions are absent from `skills/` and `.agents/skills`; this bounded request transport repair does not add design or copy conventions. Semantic graph tools were unavailable, so bounded source reads and searches were used.

## Tests Added and Run

| Layer | Result |
|---|---|
| API unit/controller | admin-invitations.spec.ts, admin-invitations-audit.spec.ts and admin-dashboard.spec.ts: 25 passed |
| Admin component/transport | InvitationsPage.spec.tsx, InvitationsPage.transport.spec.tsx and DashboardPage.spec.tsx: 8 passed |
| Integration | Root's final serialized admin SQL run: four files / 12 tests passed, including all three invitation cases and both dashboard cases |
| E2E / visual | Not performed in this subtask; root coordinates phase acceptance |
| Formatting | Prettier succeeded on the two changed source/test files |
| Types | Admin TypeScript `--noEmit -p admin/tsconfig.json` passed |
| Other workspace regression | Sequential nine-target runner: 70 files / 1,277 tests passed (worker 44, api-client 31, logging 49, schema 190, storage 47, template-renderer 125, ui 149, public-invite 133, web-app 409); logs in tmp/verify-*.log |
| Other workspace builds | Seven shared packages (config, logging, schema, storage, api-client, template-renderer, ui) and worker passed; public-invite and web-app production builds both passed on approved sandbox-external retries |

The existing dashboard SQL suite includes `keeps a 10,000-order operational dataset below a two-second warm query budget`, using cache misses for both warm-up and measured SQL execution. It also compares seeded revenue with a direct paid-order query, verifies refund exclusion, deduplicates renewal funnel membership, excludes deleted/trial-only invitations, and checks UTC zero filling. These are meaningful existing checks, not newly claimed passes.

Root's initial coordinated SQL run found an incorrect invitation fixture expectation: the factory creates a hero requiring two nicknames but no people rows, so readiness must be false. The expectation now reflects those two missing fields. A separate `updates operational completeness from missing fields to complete without exposing content` test inserts actual groom/bride rows, checks false-to-true readiness, asserts private names stay absent, and counts both read audits. Root confirmed its final serialized rerun passed all three invitation cases and both dashboard cases (four admin SQL files, 12 tests total).

## Security Verification

| Control | Source | Named test / evidence |
|---|---|---|
| List/detail bearer transport | SECURITY/03 | `sends authenticated list and detail requests through the real API client` passed |
| Admin-only operational API | SECURITY/04, API/09 | `rejects regular users with 403`, `rejects regular user detail request with 403`, `denies regular users without disclosing aggregates` passed in focused run |
| Audited cross-tenant list | SECURITY/05 Special Case | `audits the admin identity and every listed invitation before returning`, `records even an empty search so enumeration remains detectable`, `fails closed when the list audit insert fails` passed |
| Content minimization | API/09 | `uses the audited invitation owner for completeness and exposes no field values` and `shows operational histories and exposes no edit action` passed |
| Read-only content surface | API/09 | `provides no invitation-content mutation endpoint` passed |
| Enumeration throttling | SECURITY/10 | `rate limits repeated admin enumeration before exposing any invitation` passed |
| Owner IDOR | SECURITY/05 | No new owner endpoint; deliberate admin bypass remains separately named and audited |
| Payments, uploads, sanitization | SECURITY/06–08 | Not applicable to this transport repair; no state mutation, upload or input storage added |

Manual source review found list audits in the same transaction as selected rows, a detail audit completed before deriving its owner scope for completeness, explicit operational DTOs, and an aggregate-only dashboard cached behind its role-gated controller. Manual review alone is not additional automated verification of MFA or database security.

## Abuse Cases Covered

The new test catches mocked-client false confidence, invalid relative URL construction, and accidentally missing bearer credentials on either request. Existing focused tests cover unauthenticated/ordinary-user reads, invalid query/UUID, enumeration, audit failure and absent mutation routes. No new abuse surface was added.

## Definition of Done Verification

- [x] Focused backend and frontend tests passed after the repair.
- [x] Request transport uses the real shared client in regression coverage.
- [x] Source review confirms operational projections and existing audited bypass boundaries.
- [x] No endpoint/schema/state transition or docs deviation introduced.
- [ ] Root completes serialized SQL integration and repository-wide tests/types/build/security checks.
- [ ] Root updates shared TASKS/MEMORY indexes and determines final REVIEW status from collected evidence.
- [ ] Phase acceptance browser/E2E and MFA proof remain coordinated P5-14 work.

No unchecked item is waived. This record does not supersede earlier incomplete verification claims with an unsupported DONE status.

## What Did Not Work

The existing mock-based invitation tests passed over a broken production transport. Keeping the mock-based workflows and adding one real-client boundary test addresses the missing layer without replacing useful workflow coverage. The root SQL run also disproved the older unexecuted readiness assertion; correcting the actual fixture and adding both readiness states prevents an empty factory from masquerading as complete content.

Both Next production builds initially compiled, typechecked and generated pages successfully inside the sandbox but failed final standalone symlink creation with Windows EPERM. Required approval retries outside the sandbox completed both exact `next build` commands with exit zero. No configuration change or replacement packaging strategy was needed. Initial failure logs remain in tmp/build-frontend-*.log and are not evidence that final approved retries failed.

## Follow-Ups and Open Questions

Root owns global acceptance and shared task closure. No new product question. The localhost port convention already exists across admin pages; changing deployment/API origin policy would be a separate coordinated task.

## What to Watch

Support list/detail errors should now represent actual network/API failures instead of URL construction exceptions. Dashboard aggregates still scan historical orders; monitor API latency and database CPU beyond the existing 10,000-order fixture scale. Invitation list searches generate one search audit plus one audit per returned ID, which increases audit write volume intentionally.
