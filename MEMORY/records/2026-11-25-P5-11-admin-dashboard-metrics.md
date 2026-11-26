# P5-11 — Admin Dashboard Metrics

| | |
|---|---|
| **Date** | 2026-11-25 |
| **Task** | `TASKS/PHASE-5-ADMIN-PANEL.md` § P5-11 |
| **Phase** | Phase 5 |
| **Surface** | backend, admin |
| **Author** | Coding agent |
| **Commits / PR** | Included in the parent Phase 5 implementation change; no independent commit |
| **Status** | Implemented; focused tests passed, repository-wide verification coordinated by parent |

## What Changed

Replaced the unfinished dashboard service and placeholder page with live operational aggregates, invitation status counts, 30-day order chart, six-month revenue chart, and an explicit cumulative created/paid/published funnel. The API caches one consistent database snapshot for 30 seconds; the panel sends its access token through the shared API client and polls every minute.

## Why

Implements `docs/API/09-ADMIN-API.md` § Dashboard, `docs/PLAN/12-ADMIN-PANEL.md` § Dashboard, `docs/PLAN/14-ANALYTICS.md` § Phase 2 funnel, and P5-11. The prior scaffold accepted date filters it never applied, grouped whichever six months had orders instead of six calendar months, returned customer identities unnecessarily, and had no connected UI.

## How

A single PostgreSQL statement uses aggregate CTEs and generated UTC calendar periods. Missing days/months are zero-filled. The established CachePort supplies fail-open Redis caching. Paid-only sums exclude refunded rows once, avoiding subtraction of refunds twice after an order changes from paid to refunded. Currency stays a decimal integer string over HTTP and is formatted with BigInt in the browser; only chart geometry converts values to Number.

Total users counts registered accounts; invitations exclude soft-deleted rows. Revenue periods follow order created_at because the schema has no unambiguous paid_at field. All lifetime, daily, monthly and chart revenue uses currently paid orders, before provider fees. Orders chart counts all statuses by creation date.

The cumulative funnel counts non-deleted invitations, invitations with a paid or refunded order, and those same invitations with non-null published_at. Renewal orders count once per invitation. Trial-only publication is excluded. The label explicitly avoids claiming this proves the chronological order of payment and publication. This is the extent of available durable data, not step-by-step attribution.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/admin/admin-dashboard.service.ts` | Snapshot SQL, aggregate DTO, brief cache |
| `backend/api/src/modules/admin/schemas/admin-dashboard.schema.ts` | Reject undocumented filters instead of silently ignoring them |
| `backend/api/test/admin-dashboard.spec.ts` | Cache, HTTP authorization, response and validation tests |
| `backend/api/test/integration/admin-dashboard.itest.ts` | Real PostgreSQL fixture correctness and 10,000-order query budget |
| `admin/src/pages/DashboardPage.tsx` | Live API, states, refresh, cards, status counts, funnel and accessible SVG charts with data tables |
| `admin/src/pages/dashboard-model.ts` | Wire DTO and precise money/percentage formatting |
| `admin/src/pages/DashboardPage.spec.tsx` | Live response rendering, bearer header, failure/retry and formatting |
| This record | Implementation evidence and limitations |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| UTC buckets; order-created revenue; currently paid rows only | Reproducible calendar semantics and the columns already present in the schema | Parent change records the contract clarification |
| Cumulative paid/published funnel excludes trials and deduplicates renewals | A current status distribution is not a conversion funnel; trial publication must not inflate the paid stage | Parent change records the metric definition |
| Strict empty summary query | API/09 defines no filters; silently ignoring scaffold filters misleads clients | Contract clarification, no supported filter removed |
| No chart dependency | Four operational series need only SVG and native table accessibility | None |

## Deviations from docs/

No endpoint or database schema changes. Dashboard response detail and funnel/revenue interpretation fill unspecified semantics and must be documented in API/09 and DECISIONS by the parent integration change. Original undocumented scaffold camelCase output is replaced by snake_case per API conventions.

## Tests Added

| Layer | What it covers |
|---|---|
| Unit | Cache hit avoids SQL, cache miss stores 30-second aggregate; BigInt formatting and zero denominator |
| HTTP component | Real Nest guards with stub session, 401 anonymous, 403 regular user, standard envelope, query whitelist |
| Integration | Real PostgreSQL direct paid-order query comparison, refund exclusion, duplicates, deletion, trial exclusion, UTC zero-fill, 10,000 paid orders under two-second warm query budget |
| UI component | Live aggregate rendering, bearer header, accessible chart data, honest labels, retry without fabricated values |
| Browser E2E | No new browser suite in this subtask; parent coordinates visual verification and full regression |
| Security | Named tests below; shared authorization/MFA boundary remains existing project infrastructure |

Focused results: `admin-dashboard.spec.ts` 6/6 passed; `DashboardPage.spec.tsx` 3/3 passed; `admin-dashboard.itest.ts` 2/2 passed against a dedicated PostgreSQL 18 container using existing project migrations. Admin typecheck passed. Parent owns final API typecheck and repository-wide results.

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Admin aggregate is unavailable to regular users | SECURITY/04 and API/09 | `admin-dashboard.spec.ts`: “denies regular users without disclosing aggregates” |
| Authentication required | SECURITY/03 | `admin-dashboard.spec.ts`: “denies unauthenticated access” |
| Bearer token actually sent by panel | SECURITY/03 | `DashboardPage.spec.tsx`: “renders live aggregates, labelled revenue, funnel and accessible chart data” checks Authorization |
| No arbitrary fields accepted | API/00 | `admin-dashboard.spec.ts`: “rejects undocumented query fields” |
| Personal identity not returned by aggregate SQL | SECURITY/09 | `admin-dashboard.itest.ts`: “matches direct SQL totals…” checks owner email absent and aggregate-only fields |
| Object ownership | SECURITY/05 | No :id endpoint; intentional admin aggregate is role-gated. No new tenant detail read |
| Free-text sanitization, payment state mutation, uploads | SECURITY/06–08 | Not applicable: no writes or uploaded/free-text content in this endpoint; payment state remains untouched |

## Abuse Cases Covered

| Abuse case | Source | Test |
|---|---|---|
| Anonymous or ordinary customer reads admin aggregate | Admin trust boundary | Named HTTP denial tests above |
| Query fields silently alter assumptions | Scaffold defect | Undocumented query field rejection |
| Refunds or renewal orders inflate revenue/funnel | P5-11 | Seeded SQL test compares paid sums and deduplicated funnel |
| UI invents successful metrics during outage | Operational reliability | UI failure/retry test verifies no metric cards before data |

## Definition of Done Verification

- [x] Focused tests at unit, HTTP, SQL integration and UI layers
- [x] No new :id endpoint, no writes, no state transitions or input storage
- [x] Documented abuse cases have focused tests
- [x] Response envelope verified
- [x] No credentials or customer content logged by this feature
- [x] Seeded SQL matches direct paid-order totals and expected status/funnel fixture
- [x] Funnel visible and explicitly labelled
- [x] Revenue basis visible and excludes refunded orders
- [x] Warm query below two seconds for 10,000 seeded orders
- [ ] Repository-wide lint/types/build/unit/integration/security gates: parent integration responsibility; focused success is not a claim these all passed
- [ ] TASKS board, phase checkbox, index, changelog, API contract and ADR: parent integration responsibility

No unmet item is waived by this record.

## What Did Not Work

Default shell profile stalled. Commands were run with cmd and login disabled. pnpm was absent from PATH despite installed workspace dependencies; checks used local TypeScript/Vitest binaries through Node. An apply_patch delete operation hung and was terminated before writing; verified targets and used narrow Node filesystem writes. Initial UI test exposed that ApiClient requires an absolute base URL; fixed production origin and localhost API routing. Sandbox could not access Docker; an elevated Testcontainers run timed out. A fresh dedicated PostgreSQL container from the already-present postgres:18-bookworm image plus the required wedding_app role let the integration harness run successfully without pulling images.

## Follow-Ups and Open Questions

Parent owns full Phase 5 verification and shared documentation integration. Event-level conversion timing is beyond this durable funnel; do not interpret these aggregates as payment-to-publication chronology. Larger production volumes need continued query latency monitoring; the seeded performance result covers 10,000 orders, not an unlimited dataset.

## What to Watch

Redis failure increases query frequency; polling is one request per minute per open panel, and warm database aggregation scans historical data. Monitor dashboard request latency and database CPU as order volume grows. Order-created revenue is not settlement-date accounting and must keep its visible basis label. Refunds can revise earlier creation-period totals. The funnel excludes deleted invitations; published trials do not become paid conversions without a paid/refunded order.

## Parallel continuation evidence — 2026-11-25

A backend review found no additional dashboard change necessary. The combined focused admin backend run passed 42 tests across five files, including all six `admin-dashboard.spec.ts` tests. A later rerun hit a 10-second HTTP setup timeout under severe host slowdown and was canceled; it is not additional passing evidence. A new isolated `wedding_core_review` database was used for the combined invitation/dashboard/audit integration retry, but the run remained at the RUN banner for several minutes and was canceled at the coordinator's request. No new SQL/performance success is claimed. The coordinator owns sequential final verification and global task closure.
