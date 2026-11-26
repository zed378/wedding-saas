# P5-14 — Administrative audit failure and optional cache regressions

| | |
|---|---|
| Date | 2026-11-26 |
| Task | `TASKS/PHASE-5-ADMIN-PANEL.md` § P5-14 |
| Phase | Phase 5 |
| Surface | Backend unit tests |
| Author | Parallel administrative service test lane |
| Commits / PR | Existing uncommitted shared tree preserved; no commit, merge or deployment |
| Status | Scoped regression tests complete; full phase acceptance remains parent-owned |

## What Changed

Seven unit cases now cover administrative refund, suspension, unsuspension and guestbook deletion audit failures, plus successful refund/moderation/deletion when optional cache adapters are absent. Existing broad read-model and mutation tests were preserved. No production service, coverage threshold or inclusion setting changed.

## Why

The owner requested parallel implementation; P5-14 remains the active acceptance task. The preceding full coverage record identified orders, users and moderation as missing-branch contributors. `docs/PLAN/17-ACCEPTANCE-CRITERIA.md` § Functional requires audited administrator mutations; `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` § Special Case requires attributable administrative bypasses; `docs/SECURITY/07-PAYMENT-SECURITY.md` § Refund constrains refunds to the manual administrative path. The tests establish failure propagation and prevent outward cache effects before a successful audit transaction callback.

## How

Read the progress board, phase card, memory index and relevant coverage record, PLAN/00 and PLAN/16, mandatory SECURITY/05 and SECURITY/07, and P5-14 acceptance/E2E/RBAC references before changes. No semantic graph or JevGraph tools were exposed, so discovery used bounded local reads; the requested local anti-slop skill paths were absent. All terminal commands used RTK.

First measured the existing three test files: 32 tests passed, with already substantially higher target coverage than the preceding historical combined result. This prevented duplicating existing scenarios or attributing their effect to this lane. Added seven missing behavioral cases to the current helpers, then reran unit tests, target coverage, API types and scoped lint/format checks on portable Node 24.18.0.

The transaction mocks execute callbacks and expose rejection behavior; they do not simulate PostgreSQL rollback. The new tests assert only rejection, audit association and cache-call boundaries. Real transaction atomicity remains the responsibility of existing SQL acceptance suites and the parent's combined run.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/admin/admin-orders.service.spec.ts` | Two cases: published manual refund without optional cache adapters; no cache effects after audit insertion failure |
| `backend/api/src/modules/admin/admin-users.service.spec.ts` | Two parameterized cases: suspend and unsuspend reject when attributable auditing fails |
| `backend/api/src/modules/admin/admin-moderation.service.spec.ts` | Three cases: moderation/deletion without optional adapters; deletion audit failure prevents cache effects and success |
| This record | Executed evidence, existing baseline distinction and verification limits |

Ignored artifacts `tmp/admin-branch-coverage-before/coverage-summary.json` and `tmp/admin-branch-coverage-after/coverage-summary.json` are diagnostic reports. The parent owns shared index/changelog/progress/checkpoint updates.

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Add behavior-focused tests around audit failure and optional dependencies | These gaps matter operationally and were not covered by the existing broad cases | Not applicable; no product or architecture decision |
| Keep full service coverage denominator and thresholds | A three-file diagnostic must not masquerade as the global acceptance gate | Not applicable; existing policy preserved |

## Deviations from `docs/`

None. No endpoint contract, database schema, lifecycle rule or security policy changed.

## Tests Added and Executed

| Layer / check | Actual result |
|---|---|
| Existing focused baseline | Three files / 32 tests passed on Node 24.18.0 |
| Final focused unit regression | Three files / 39 tests passed; exit 0 |
| Final focused diagnostic coverage | Three files / 39 tests passed; process exits 1 because the unchanged global coverage thresholds count every service while this diagnostic runs only three files |
| Orders service diagnostic coverage | Lines 79/79 = 100%; branches 86/86 = 100%, versus 84/86 before the new cases |
| Users service diagnostic coverage | Lines 52/52 = 100%; branches 32/32 = 100%, unchanged from the measured existing baseline |
| Moderation service diagnostic coverage | Lines 89/89 = 100%; branches 76/78 = 97.43%, versus 72/78 before the new cases |
| API typecheck | `tsc --noEmit -p backend/api/tsconfig.json` passes on Node 24.18.0 |
| Scoped lint | Oxlint `--deny-warnings` over the three edited test files passes |
| Scoped formatting | Prettier write over the three files completes; explicit final check below also passes |
| Integration / E2E / full workspace gates | No new cases or execution by this lane; parent performs combined acceptance |

The final focused unit command, from `backend/api`, is `rtk proxy C:/Users/Zed/AppData/Local/OpenClaw/deps/portable-node/node.exe node_modules/vitest/vitest.mjs run src/modules/admin/admin-orders.service.spec.ts src/modules/admin/admin-users.service.spec.ts src/modules/admin/admin-moderation.service.spec.ts --pool=threads --maxWorkers=1 --no-file-parallelism`. The diagnostic adds `--config vitest.coverage.config.mts --coverage.reportsDirectory=../../tmp/admin-branch-coverage-after --coverage.reporter=json-summary`. No threshold was overridden or excluded source added. The focused global branch figure is 11.63% and is intentionally not a phase acceptance result.

## Security Verification

| Control | Requirement source | Named executable evidence |
|---|---|---|
| Refund audit failure must not acknowledge success or publish cache side effects | `docs/SECURITY/07` § Refund; P5-14 audit requirement | `does not publish cache side effects when the refund audit fails` |
| Suspension/unsuspension audit failure must propagate | P5-14 audit requirement | `%s rejects instead of acknowledging a change whose audit failed`, executed for `suspendUser` and `unsuspendUser`; asserts resource ID and after-state association |
| Guestbook deletion audit failure must prevent success and post-transaction cache effects | P5-14 audit requirement | `does not purge caches or return success when deletion auditing fails` |
| Object ownership / endpoint whitelist / stored text sanitation / upload validation | SECURITY/05, SECURITY/08, SECURITY/06 | Not applicable to new implementation: test-only change, no endpoint or input path created; no new blanket verification claim |
| Unsigned payment callback must not change state | SECURITY/07 | No callback implementation changed and this lane did not rerun callback suites; parent-owned full regression required |

## Abuse Cases Covered

| Abuse case | Source | Test |
|---|---|---|
| An unavailable audit writer is incorrectly treated as successful refund or deletion | P5-14 § Audit every write | Named refund/deletion failure cases above |
| A support account status mutation returns success despite missing audit evidence | P5-14 § Audit every write | Both parameterized user audit-failure cases above |
| Optional cache adapters cause otherwise audited administration to crash | Existing constructor optional dependency contract | `completes a published refund when optional cache adapters are absent` and `completes %s on a published invitation without optional cache adapters` |

No real-database rollback, HTTP role boundary, public XSS, upload or signed-webhook claim is inferred from these mocked service tests.

## Definition of Done Verification

Tests exist at the appropriate unit layer and pass. No new endpoint makes the per-ID ownership, request whitelist, response envelope and input sanitation items newly applicable. Existing production status/audit writers remain unchanged; named new tests verify failure propagation without claiming real SQL rollback. All fixtures are synthetic and contain no production secrets. Types, scoped lint and formatting pass; full integration, build, dependency audit and SAST remain coordinator-owned, so CI-green and overall P5-14 DONE are not asserted. The parent owns the shared board/index update. No DoD item or coverage gate is waived; no Phase 6 work was started.

## What Did Not Work

An initial PowerShell expression lost `$` variables through nested shell interpolation; it was read-only and replaced with a bounded Node JSON reader. Diagnostic coverage exits 1 under the deliberately unchanged global thresholds; it is not a failure of the 39 passing tests and is not reported as a passing global coverage gate. The initial missing anti-slop skill path check had no matching files; no skill instructions were inferred.

## Follow-Ups and Open Questions

Run the complete combined SQL/unit coverage suite after every lane finishes; the existing broad specs already cover many previously missing branches, so the historical 69.82% baseline is stale for the present tree. Parent coordinates this and the existing P5-14 dependency/review/phase-summary follow-ups. Two moderation branches remain uncovered in the focused diagnostic; do not distort tests merely to obtain 100%. No new product question arose.

## What to Watch

No production behavior changed. Service mocks can prove failure propagation but cannot prove transaction rollback or that public edge caches actually purge; retain real PostgreSQL/Redis and browser acceptance for those controls. Preserve separate diagnostic and combined coverage output directories when running lanes in parallel.
