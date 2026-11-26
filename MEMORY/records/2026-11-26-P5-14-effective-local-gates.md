# P5-14 — Effective local acceptance gates and Node 24 regression

| | |
|---|---|
| Date | 2026-11-26 |
| Task / phase | P5-14 acceptance continuation; Phase 5 |
| Surface / author | Workspace verification, documentation and coordinated parallel lanes |
| Commits / PR | Existing shared uncommitted working tree preserved; no commit, merge, deployment or production migration |
| Status | Local gate implementation completed; Phase 5 acceptance remains incomplete |

## What Changed and Why

The owner requested parallel implementation. Phase 5 has four implemented features in REVIEW and acceptance in WIP, so this continuation addresses measured acceptance gaps instead of starting Phase 6. Root and thirteen workspace lint commands now run a real correctness checker. Full local verification invokes workspace integration tests, the existing combined API service-coverage thresholds, an all-dependency audit and checked-in Semgrep rules. Fast verification explicitly reports what it omits.

`docs/DEVOPS/01-CI-CD.md`, `docs/BACKEND/09-TESTING.md`, `docs/SECURITY/11-SECURITY-TESTING.md` and global DoD item 9 require these checks. ADR-028 defers hosted CI rather than waiving verification. Mandatory task/spec/security/memory reading preceded changes. The exposed tool catalog contained no code graph/JevGraph tools, so discovery used bounded local reads and literal/config searches. Shell calls used RTK.

## How

Three parallel lanes own effective lint, Semgrep and actual PostgreSQL/Redis coverage acceptance. The coordinating lane owns verifier wiring, supported-runtime workspace regression and shared records. Dependency installation was exclusive to the lint lane and finished before the SQL/coverage run began. Later lexical lint cleanup overlapped the early regression run; final type/build checks and the SQL lane's exact timing distinguish executed evidence from assumptions.

The existing coverage configuration still includes unit plus integration tests and enforces lines/statements/functions 80% and branches 75%. No threshold, production source inclusion or failure result was reduced. SAST uses a digest-pinned Docker image and local rule fixtures; scanner findings/errors or an empty analysis fail. Tests and security-tool fixtures retain their separate execution paths. No hosted pipeline was added.

Root workspace integration uses Turbo concurrency one: API `resetDatabase` truncates the shared schema, while worker media integration may use the same migration URL. Running those workspaces concurrently would invalidate each other's fixtures. The combined API coverage suite already disables file parallelism; no assertion or test was skipped.
Turbo's strict environment filtering also previously omitted the supplied test connection URLs. Integration tasks now explicitly pass only their named database/Redis/storage/ClamAV/Docker connection variables; other tasks retain strict filtering. Values are not printed or added to the cache key.

## Files and Components Touched

| Path | Change |
|---|---|
| `scripts/verify.sh` | Full integration/coverage/audit/SAST invocation, service prerequisites and accurate fast/full completion wording |
| `package.json` | Expose `check:sast`, serialize workspace integration; root lint/dependency changes are detailed in the lint record |
| `turbo.json` | Scoped integration connection-variable passthrough under the existing strict environment mode |
| `backend/api/vitest.coverage.config.mts` | Correct its stale comment to describe local gate enforcement; coverage settings unchanged |
| `backend/api/test/README.md`, `README.md` | Explain real lint/SAST/full verification and prerequisites |
| `MEMORY/DECISIONS.md` | ADR-108 records tooling compatibility, local enforcement and unchanged CI deferral |
| `TASKS/{PROGRESS,PHASE-5-ADMIN-PANEL,BACKLOG}.md` | Current executed evidence and unwaived remaining gates |
| `MEMORY/{MEMORY-INDEX,CHANGELOG}.md`, `.agents/ck/CONTEXT.md` | Discoverable records and durable continuation checkpoint |
| This record | Coordinated verification evidence and limits |

The [lint lane record](./2026-11-26-P5-14-effective-lint-gate.md) lists its manifests/config and forty cleanup files. The [SAST record](./2026-11-26-P5-14-effective-sast-gate.md) lists its rules/runner and display-preserving JSX changes. The [full SQL and coverage record](./2026-11-26-P5-14-full-sql-and-coverage.md) details exact audit-test assertions, complete suite results and uncovered services. Ignored `tmp/` runners/logs are local verification artifacts, not production implementation. Previously dirty files were preserved.

## Decisions and Deviations

ADR-108 chooses a TypeScript-independent correctness linter after the ESLint/typescript-eslint trial proved incompatible with pinned TypeScript 7. It retains unused-name checks and targeted intentional exceptions. Checked-in Semgrep rules supplement dedicated runtime security tests. Auditing includes development tooling, so a production-only clean result cannot make the full gate green. No API, schema, business-rule or authorization-policy deviation; no gate waived.

## Tests Added and Run

- Root real lint passes. The lint lane proved a duplicate-key probe fails with exit 1, then removed it; all thirteen workspace lint commands execute real checks.
- All seventeen existing static guard scripts pass on Node 24.22.3, including the full-tree secret check. Results are in ignored `tmp/p5-static-gates-20261126.json`.
- Root global `format:check` passes after the new tooling and cleanup.
- Final forced Node 24.22.3 production build passes all twelve tasks with zero cache hits. The earlier invocation failed on an intermediate underscore destructure rename; the corrected final build is recorded in `tmp/p5-final-build-20261126.log`.
- Forced Node 24.22.3 workspace typecheck passes all nineteen tasks. The lint lane also ran affected typechecks after correcting the destructures.
- Node 24.22.3 non-API unit suites all pass: worker 44, api-client 33, logging 49, schema 190, storage 47, renderer 125, UI 149, public invitation 133, web app 409 and admin 84 — 85 files / 1,263 tests. Public production SSR separately passes one file / 37 tests. These are summed from actual per-suite footers, not an inherited aggregate. The multi-command runner exits 1 because it retains the initial build failure; its subsequent types/unit/SSR results are separately passing and the corrected full build has its own exit-zero invocation.
- Strict SAST passes 425 production source files with zero findings and zero parser/analysis errors; all seven positive/negative rule suites pass. `bash -n scripts/verify.sh` passes inside the pinned scanner container. Final admin build/typecheck passes after display-preserving JSX entity corrections; that combined late focused invocation uses the host Node 26, and the final Vite-only production build was also repeated successfully on Node 24. Full workspace build and all unit/SSR suites above use Node 24.
- Production dependency audit reports zero advisories; all-dependency audit exits 1 with 43 advisories: 15 high, 24 moderate, four low, zero critical. This is the actual registry result, not an accepted risk or a claim of overall security.

The combined API SQL/coverage totals are recorded in the final evidence addendum below and the SQL lane record. The existing browser acceptance is historical evidence from the prior indexed continuation; it was not repeated for this tooling-only continuation. Full root `verify` is not claimed green: its dependency audit already fails, and worker/storage integration service prerequisites were not provisioned by this parent lane.

## Security Verification

No new endpoint, input field, payment-state writer, upload policy, stored text path or ownership bypass was introduced. Therefore no new endpoint IDOR/whitelisting/envelope or upload regression is applicable. Existing named authorization, payment and sanitizer cases execute in the combined API suite; the SQL lane records their actual outcome. No blanket security certification follows from lint, SAST or dependency auditing.

The SAST lane's positive/negative fixtures establish its documented AST/taint rule behavior. Dedicated `admin-phase5-write-audit.itest.ts` and `admin-phase5-template-flow.itest.ts` reconcile actual actor action/resource tuples with audit rows. Template assertions now compare exact action/type/id tuples instead of merely permitting any of several resource IDs. Neither a static scan nor a tuple test replaces the separate MFA, ownership or payment-signature regressions.

## Abuse Cases Covered

The lint negative probe detects real correctness failure rather than echo-success. SAST fixtures exercise dangerous execution, disabled TLS, unsigned JWT, weak hashing and request-input injection sinks with negative controls. Existing SQL acceptance includes ordinary-user escalation, unauthorized cross-tenant access, expired/missing MFA proof, invalid webhook signatures and audit-count failures. See the lane records for named tests and observed results; no new public abuse surface was created.

## Definition of Done Verification

This bounded tooling change has actual failure probes, scoped checks, final types/build, records/index/changelog/board updates and documented prerequisites. Endpoint-specific DoD items are not applicable because no endpoint changed. Existing coverage thresholds and dependency findings remain enforced. Hosted CI, independent reviewer approval, development dependency remediation, final P5-10–13 reviews and phase-completion sign-off remain open. Phase 5 stays 9/14 DONE; no Phase 6 feature was started and no completed-phase summary is asserted.

## What Did Not Work

The ESLint parser rejected the selected compiler version, so its trial dependencies were removed. Initial lexical cleanup changed destructured property names instead of aliasing bindings; Node 24 build caught this immediately. Unused destructures were removed, accepted interfaces preserved, and final types/build reran successfully. Nested PowerShell/native quoting caused a few read-only probes to fail; ignored standalone Node runners avoided further command interpolation. The host's `bash` points to WSL rather than a native Node-capable environment; syntax verification is performed in the pinned Docker image, while substantive Node 24 checks execute natively. None of these failed attempts is passing evidence.

## Follow-Ups and Open Questions

The all-dependency audit's 43 findings require remediation. Read-only analysis identifies compatible direct updates for Vite, Vitest/coverage and Nest CLI/schematics plus transitive refreshes. Some chains require separate compatibility review (Drizzle loader/esbuild and Testcontainers' uuid/glob/minimatch). No unsafe major override was installed during active regression, no advisory was ignored and no expected advisory reduction is represented as measured. Follow-up is on BACKLOG and the progress board.

## What to Watch

Full local verification now intentionally fails when services are missing, thresholds are unmet, the scanner fails or any audited dependency has an advisory. Fast mode success is narrower. Keep the pinned scanner, fixtures and TypeScript-aware lint tooling maintained together; retain independent runtime tenant/payment/upload checks. Local commands remain bypassable without the deferred hosted pipeline.

## Final Combined API Evidence

The complete combined Node 24.22.3 run passes all 115 files / 2,174 tests: 56 unit files / 1,004 tests and 59 real PostgreSQL/Redis integration files / 1,170 tests, in 987.18 seconds. This supplies the previously missing single all-green full SQL invocation after the RSVP fixture correction. The process exits 1 solely because the existing branch-coverage threshold is unmet: branches 69.82% (1,164/1,667) versus 75%. Lines pass at 82.73% (1,921/2,322), statements at 81.72% (2,039/2,495), and functions at 89.67% (417/465). The failing gate is retained and no source was excluded.

The two named audit suites pass exact complete-session reconciliation for nine support/moderation/refund/blocklist writes and eight template writes, including actor identity, reason and resource association. P5-14's count-comparison checklist item is now checked with this evidence; overall acceptance remains WIP. Across the combined API run, other workspace unit runs and public SSR, 3,474 executed tests pass; this aggregate does not imply that coverage or the dependency gate passes.

The remaining coverage work is now measurable rather than unexecuted. Large missing-branch contributors include admin orders (10/86), users (2/32), moderation (23/78), templates (36/84), DLQ monitoring (0/18) and MFA (19/39). `EmailWebhookService` is defined but unreferenced by application/tests; existing webhook tests target `EmailBounceService`, so the zero result is not evidence of an instrumentation defect. Review unused code on functional grounds; it was not removed to inflate coverage. Full worker/storage integration, development dependency remediation, independent review and the final phase summary remain open. The Turbo integration dry-run separately confirms only the three real integration workspaces (API, worker, storage), strict scoped environment passthrough and disabled integration caching; it is not represented as an executed worker/storage suite.
