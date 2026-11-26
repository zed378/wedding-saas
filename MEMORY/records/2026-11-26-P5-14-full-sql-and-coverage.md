# P5-14 — Complete Node 24 SQL acceptance and measured coverage gap

| | |
|---|---|
| Date | 2026-11-26 |
| Task / phase | `TASKS/PHASE-5-ADMIN-PANEL.md` § P5-14; Phase 5 |
| Surface / author | Backend integration tests; parallel SQL acceptance lane |
| Commits / PR | Existing shared uncommitted tree preserved; no commit, merge or deployment |
| Status | Complete SQL/unit execution and audit assertion improvement; coverage gate remains failed |

## What Changed

The existing template-authoring SQL acceptance test now reconciles exact action, resource-type and resource-ID tuples for all eight successful writes. It previously compared action names and only checked that each resource ID belonged to one of three permitted resources, allowing a correctly named audit to identify the wrong template or version.

A complete Node 24 combined API unit/integration invocation now passes every test, including all 59 SQL integration files after the earlier RSVP/settings fixture corrections. The command still exits 1 because measured service branch coverage is below its existing 75% threshold. No threshold, coverage exclusion or test selection was changed to obtain the result.

## Why

P5-14 requires complete administrative audit coverage by operation-count comparison. `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` § Special Case makes attributable administrative access essential; `docs/SECURITY/04-AUTHORIZATION-RBAC.md` requires meaningful permission tests. `docs/TESTING/02-INTEGRATION-TESTING.md` requires real database/cache dependencies and direct persisted-state assertions. `docs/BACKEND/09-TESTING.md` § Coverage sets an 80% service line target, and the repository additionally enforces 75% branches through its existing coverage configuration.

The previous full SQL run had three failures followed by a passing focused correction. This new complete invocation supplies the previously missing all-green full SQL execution while preserving that earlier record unchanged.

## How

No graph tools were available, so discovery used bounded source reads and literal searches. A dedicated local PostgreSQL 18 container, `wedding-p5-final-sql-20261126`, exposes port 60468. Its disposable application role/default grants were created before migration, matching the existing Compose bootstrap and the corrected harness. The existing dedicated integration Redis on 55501 was reused; no other lane used this SQL database. External test-role passwords and production resources were untouched.

Node 24.22.3 runs Vitest's existing `vitest.coverage.config.mts`, which includes unit and SQL tests in one process so coverage is measured over both. Invocation uses threads, one worker, disabled file parallelism and a 60-second hook timeout. Real SQL tests remain serial because their reset helpers truncate shared test tables. An ignored temporary runner captures output without flooding the conversation. Dependency installation had finished before invocation.

The lint lane made unused-import removals and unused-binding renames in several existing SQL files during the combined run. These are lexical cleanups with no assertion or called-operation change; the parent owns their diff and checks. The exact template-audit tuple improvement was present before the invocation began.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/test/integration/admin-phase5-template-flow.itest.ts` | Compare all eight exact audit action/type/ID tuples; select `resource_type` for the assertion |
| This record | Full execution result, unchanged failing threshold and bounded follow-ups |

Ignored artifacts: `tmp/run-p5-final-coverage-20261126.cjs`, `tmp/p5-final-coverage-20261126.log`, and `backend/api/coverage/coverage-summary.json`. These are local verification artifacts, not production implementation. The parent owns task board, phase checklist, index, changelog and backlog synchronization.

## Decisions Made

Strengthen the established acceptance test rather than create a duplicate harness. Preserve all coverage thresholds and report the genuine gap. No API, schema, product or architectural decision was made, so no ADR is required.

## Deviations from docs/

None. The full MVP release gate is not certified by this bounded acceptance run.

## Tests Added and Executed

| Layer / check | Actual result |
|---|---|
| Existing template SQL regression strengthened | Eight exact action/type/resource tuples are reconciled for create/update, version create/update/publish/deprecate, and disposable-template create/delete |
| Complete API unit + SQL invocation on Node 24.22.3 | **115 files / 2,174 tests passed**, 987.18 seconds; no skipped or failed test in final summary |
| Complete SQL inclusion | All **59 integration files**, alongside 56 unit files, are included by the combined configuration. Existing suite totals account for 1,170 SQL and 1,004 unit cases; the combined runner reports the 2,174 total |
| Service lines | **82.73%**, 1,921 / 2,322; exceeds unchanged 80% threshold |
| Service statements | **81.72%**, 2,039 / 2,495; exceeds unchanged 80% threshold |
| Service functions | **89.67%**, 417 / 465; exceeds unchanged 80% threshold |
| Service branches | **69.82%**, 1,164 / 1,667; **fails unchanged 75% threshold** |
| Overall command exit | **1**, solely the branch-coverage threshold; passing tests do not make this a passing coverage command |
| Scoped formatting | Prettier check passed for the changed template-flow integration file before invocation |
| Types / build / browser / non-API suites | Parent-owned separate verification; not claimed as executed by this lane |

The complete result supersedes the previous failed full SQL invocation only as the latest execution evidence; it does not erase that earlier failure or its diagnosis.

## Security Verification

| Control | Named executable evidence in the passing combined run |
|---|---|
| Full template-write audit count and attribution | `BR-3.1 authors and publishes data without restart, immediately exposes catalog, locks user version and audits every successful template action`: exact eight action/type/ID tuples, reasons and nonempty state snapshots |
| Support/moderation/refund/blocklist audit completeness | `persists exactly one reasoned before/after audit per successful write and invalidates public effects`: all nine actor rows, exact tuples and real state transitions |
| Concurrent moderation snapshots | `records the actual preceding status for two concurrent moderation decisions`: locked real PostgreSQL operations identify the preceding committed status |
| Audited export and unchanged source evidence | `commits export evidence before returning and never changes source audit rows`: exact persisted export record plus redacted response and untouched original snapshot |
| MFA provenance and absolute lifetime | `preserves the original MFA proof and expiry through two real database rotations`, `cannot promote a pre-MFA user session through access or refresh`, `rejects legacy administrator refresh rows without MFA provenance` |
| Administrative read minimization and audit | `filters by slug and owner, audits every returned ID and returns only operational detail`, `audits nonexistent detail probes before returning 404` |
| Ownership isolation | `returns 404 for a non-owner attempting to list RSVPs` and `returns 404 for a non-owner attempting to view summary` execute with the corrected explicit count fixtures |
| Invalid payment evidence has no state effect | `a forged success changes nothing, answers 401, is recorded and counted`, `a notification without a signature is refused the same way`, `a genuine notification tampered to a success changes nothing` |
| Effective application database restrictions | `bootstraps disposable application privileges before migration restrictions`: ordinary grants work; audit/invoice/raw-payment/region restrictions and unprivileged role flags remain checked |
| Blocklist writes and protected routes | `rolls back a mutation if its audit insert fails`, `cannot remove or rename an exact public route reservation` |

No production authorization, payment writer, upload pipeline, sanitization path or request schema changed in this lane. The existing payment tests are regression evidence, not live-provider certification. This lane does not claim that its audit assertion edit verifies all upload vectors or public stored-XSS behavior.

## Abuse Cases Covered

The stronger test detects missing or extra template audit rows and correct action names attached to the wrong permitted template/version. Existing named passing tests above exercise stale concurrent snapshots, MFA promotion/legacy credentials, audit-failure rollback, invalid payment evidence and non-owner access. No new endpoint, accepted input, log field or owner-query bypass exists.

## Definition of Done Verification

The scoped test improvement has real SQL execution and formatting evidence. All 115 API unit/integration files pass, and the administrative write-count acceptance now has complete executed evidence across the eight template and nine support/moderation/refund/blocklist operations, with bulk-export evidence separately asserted. Parent determines the task checklist status after reviewing the whole inventory.

Coverage remains failed and is not waived. No CI-green, Phase 5 DONE, release-ready or phase-summary-complete claim follows from this record. New endpoint IDOR, new stored-input sanitation, response contract and lifecycle implementation requirements are not applicable to this test-only edit. Existing named regressions remain executed. Nothing sensitive from a production environment was introduced into the synthetic test evidence. Parent owns shared board/index/changelog/backlog updates.

## What Did Not Work

The first bounded read guessed `.ts` instead of the repository's `.mts` integration config, and guessed a shorter authorization document filename; the actual filenames were located and read. A literal Windows wildcard argument was rejected by ripgrep; subsequent bounded searches used real paths. These read-only mistakes changed no source.

The completed combined invocation did not meet branch coverage. It must not be described as a green coverage run simply because every test passes. No retries, reduced thresholds or additional exclusions were used.

## Follow-Ups and Open Questions

The existing P5-14 coverage gate remains open. At the same branch denominator, at least **87 more covered branches** are needed to meet 75% (1,251 / 1,667). The largest measured gaps are:

| Service | Lines | Branches | Missing branches |
|---|---|---|---|
| `admin-orders.service.ts` | 30.37% | 11.62% (10/86) | 76 |
| `email-webhook.service.ts` | 0% | 0% (0/58) | 58 |
| `admin-moderation.service.ts` | 42.69% | 29.48% (23/78) | 55 |
| `admin-templates.service.ts` | 62.68% | 42.85% (36/84) | 48 |
| `admin-users.service.ts` | 28.84% | 6.25% (2/32) | 30 |
| `order.service.ts` | 87.76% | 75.83% (91/120) | 29 |
| `auth/mfa/mfa.service.ts` | 66.14% | 48.71% (19/39) | 20 |
| `dlq-monitor.service.ts` | 9.09% | 0% (0/18) | 18 |

Useful follow-ups are tests of actual admin search/filter/date/order/refund guards, moderation validation/missing/deleted entries and audit rollback, and template invalid/immutable/in-use state branches. These require scenario-focused work, not artificial calls to raise a percentage.

Literal source/test reference search found `EmailWebhookService` only at its class definition. The mounted controller's existing tests exercise `EmailBounceService`; this explains why the similarly named file is unexecuted. Determine its intended ownership and whether it is obsolete in a separately reviewed change. Do not remove or exclude it merely to improve coverage. `DlqMonitorService` is registered by `NotificationModule`, so its zero branch result is a real monitoring-test gap. Parent records these specific gaps under the existing coverage follow-up; no new product decision is needed.

For context, P5-10 invitations have 100% lines / 87.5% branches, P5-11 dashboard 100% / 100%, P5-12 audit logs 100% / 90.9%, and P5-13 blocklist 83.33% / 77.5%. Global coverage still measures the full included service layer, not only those four features.

## What to Watch

No production runtime behavior changed. Future mutation additions must enter the counted audit inventory and identify the exact resource, rather than merely an allowed ID set. Keep real SQL files serial and preserve pre-migration role grants. A green test footer must remain distinguishable from an exit-1 coverage threshold failure in release evidence.
