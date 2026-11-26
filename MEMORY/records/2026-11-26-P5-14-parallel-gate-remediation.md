# P5-14 — Parallel gate remediation and rendered acceptance

| | |
|---|---|
| Date | 2026-11-26 |
| Task / phase | P5-14 acceptance continuation; Phase 5 |
| Surface | Dependency graph, admin layout, E2E fixtures, verification and records |
| Author | Coordinating implementation agent with three parallel lanes |
| Commits / PR | Existing shared working tree preserved; no commit, merge, deployment or production migration |
| Status | Maintenance and browser acceptance completed; overall Phase 5 remains incomplete |

## What Changed and Why

The owner requested parallel implementation. The active phase has no remaining unimplemented independent feature: P5-10–13 are REVIEW and P5-14 requires acceptance. Work therefore closes measured acceptance defects within Phase 5 rather than starting Phase 6. Installed same-major dependency updates reduce 32 production advisories to zero, 95 existing formatter failures are corrected mechanically, and the existing real browser flows now execute successfully on Node 24.

Visual inspection exposed a desktop navigation defect: the moderation table squeezed the sidebar from its normal width and clipped the brand. The sidebar now resists flex shrinking and the main area permits its existing table overflow container to shrink. The E2E checks that switching from the dashboard to moderation preserves sidebar width and does not introduce page-wide horizontal scrolling. The public assertion opens the invitation cover and scrolls the approved message into the viewport before taking its screenshot, so a hidden-below-cover DOM match is not treated as visual evidence.

## How

Three agents separately owned dependency manifests/lockfile, mechanical formatting, and real PostgreSQL integration verification. The coordinating lane owned rendered browser acceptance, a narrow layout repair, and shared records. No graph MCP/JevGraph tools were exposed in the available tool catalog, so discovery fell back to bounded local reads and literal searches. All terminal invocations used the requested RTK prefix.

The in-app browser tool still fails before connection because its sandbox metadata is missing. After reading its skill and attempting bootstrap, verification used the repository's existing Playwright CLI suite against production builds, not a personal browser session. The API and user/public/admin servers run locally, with a separate E2E database and Redis from the SQL lane. Test data is synthetic. The successful E2E runner and its API child use Node 24.22.3; the broader initial workspace unit/type/build runs use the host Node 26.10.0.

The full-stack E2E fixture now checks application-role connectivity before migrations and seeding. Invalid external test credentials therefore produce a direct configuration error before fixture writes, instead of a later unexplained registration 500. The pre-existing distinct-role/same-database URL checks remain intact.

## Files and Components Touched

| Path | Change |
|---|---|
| `admin/src/components/AdminLayout.tsx` | Add sidebar `shrink-0` and main `min-w-0`; no navigation/content redesign |
| `e2e/tests/admin-phase5.e2e.ts` | Stable sidebar/no page overflow assertions; open cover, scroll approved message and assert it is in viewport; focused screenshot |
| `e2e/fixtures/full-stack.ts` | Read-only application connection preflight before migrations/seed |
| `MEMORY/DECISIONS.md` | ADR-107 and annotation of ADR-008's superseded Zod minor selection |
| `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md` | Index completed lane records and describe current maintenance outcome |
| `TASKS/PROGRESS.md`, `TASKS/PHASE-5-ADMIN-PANEL.md`, `TASKS/BACKLOG.md` | Current evidence, completed bounded acceptance checks and explicit remaining gates |
| `.agents/ck/CONTEXT.md` | Durable continuation checkpoint, preserving earlier history |
| This record | Coordinated scope, named evidence and remaining limitations |

Exact dependency paths and installed versions are listed in [production dependency remediation](./2026-11-26-P5-14-production-dependency-remediation.md). Every mechanically formatted file is listed in [global format gate](./2026-11-26-P5-14-global-format-gate.md). The SQL lane's separate record lists its harness/assertion changes and final real-database evidence. Existing dirty files from earlier sessions were neither discarded nor represented as new work in this record.

## Decisions and Deviations

ADR-107 records security maintenance within the selected library major versions, Zod 4.6.x superseding the historical 4.5.x minor pin, and four exact Nest release-age exceptions while keeping global install protections. There is no new API, database, business-rule or product contract. No additional product decision was needed for preserving the existing sidebar width. P0-17 remains deferred; a locally green check is not an automated pipeline.

## Tests Added and Run

| Layer / command | Actual outcome |
|---|---|
| Full API unit suite | 56 files / 1,004 tests passed after final dependency install, threads/maxWorkers=1/hookTimeout=60000; 434.26 seconds |
| Full admin component suite | 15 files / 84 tests passed after final dependency install; 362.64 seconds. Layout-only correction followed and is exercised by final production build/E2E |
| Workspace typecheck | 19 tasks successful, 1 cached, after final dependency install |
| Workspace production build | 12 tasks successful, 1 cached, after final dependency install |
| Other workspace Turbo tests | 17 tasks successful, 7 cached. Includes existing placeholder tasks for config/E2E; this does not claim those placeholders are tests |
| Public production SSR | 37 tests passed against the rebuilt Next output |
| Final admin production build | Passed after the sidebar correction; existing >500 kB bundle warning remains |
| Final E2E package typecheck | Passed after the fixture and assertion updates |
| Real Chromium admin acceptance | 2 tests passed on Node 24.22.3, final run 1.1 minutes; no retry setting or skipped acceptance case |
| Visual inspection | Inspected moderation-pending, template-published and approved-public PNGs. Final public PNG visibly contains the approved message; final moderation PNG shows the restored sidebar |
| Static checks | All 17 `scripts/check-*.mjs` passed in a final rerun, including full-tree secret scan |
| Formatting | Global root `format:check` passed after fixing the final E2E line wrap; mechanical lane accounts for the original 95 failures |
| Production dependency audit | Zero advisories after actual installation; frozen-lockfile consistency, schema190, worker44 and native sharp roundtrip evidence in dependency record |
| Full SQL integration | Separately coordinated on isolated PostgreSQL/Redis; final totals and any residual failures are recorded by the SQL lane and summarized on the progress board |

The two real browser tests are `admin approves a pending guestbook message and the public page immediately displays it` and `admin authors and publishes a template in the browser and a user creates an invitation without deployment`. The latter authors and publishes through the admin browser UI, then uses the actual user API to create the invitation and checks the stored pinned version and three template audit actions. It does not claim that the full user editor/checkout journey was driven in that browser test.

## Security Verification

| Control | Named evidence and boundary |
|---|---|
| Ordinary-user/admin/MFA route separation | Full API run includes parameterized `METHOD path refuses ordinary users and unenforced MFA` in `admin-phase5-authorization.spec.ts`, covering all nine admin controllers |
| Step-up on damaging actions | `requires step-up for refund and suspension even with an MFA-authenticated session` passed in the full API run |
| No invitation content write surface | `has no invitation content write routes in the real admin module` passed in the full API run |
| Signed MFA proof and absolute lifetime | `accepts fresh signed proof and rejects proof at the absolute four-hour limit`, `records successful MFA in both access and refresh credentials`, and `preserves original proof when refreshing instead of renewing the MFA lifetime` passed |
| MFA through Google login | `requires MFA for a returning Google administrator before issuing any credentials` passed |
| Audited actual moderation/public effect | Real browser moderation test verifies the newly approved entry becomes visible in the public viewport and its exact resource has one `guestbook.moderate` audit |
| Template writes, pinning and no deploy | Real browser template test checks exactly create/version-create/version-publish audit actions, supplied reasons, and the invitation's stored new version ID |
| Disposable application permissions | SQL lane regression exercises compose-equivalent grants before migration restrictions; its record names the exact test and result |
| Payment sources, upload acceptance, field whitelisting and sanitizer policy | No source policy was changed here; dependencies in these paths were upgraded. Full existing unit/SQL regressions supply bounded evidence, not an assertion that CVE scanning or sharp smoke proves all controls |

No new `:id` route, accepted body field, free-text storage path, payment-state writer, authorization bypass or sensitive logging operation was added. Production authorization/payment/upload/input-sanitization source policies were preserved; their changed dependency subtrees still deserve security review. No production security certification is inferred from a zero-advisory result.

## Abuse Cases Covered

Existing named authorization/MFA tests cover ordinary-user escalation, missing/expired MFA proof, missing step-up and forbidden content editing. The browser tests cover unapproved guestbook exclusion, visible approval effects and reasoned audit writes; template creation checks pinning and write audit identity. The new layout assertion detects navigation compression/page overflow. These are bounded Phase 5 regressions, not a substitute for the full pre-launch IDOR/upload/payment/XSS matrix.

## Definition of Done Verification

The implemented maintenance corrections have executable checks at their relevant layers, no new endpoint requires new IDOR coverage, and records/index/changelog/board are synchronized. Two P5-14 acceptance checks are now checked with exact evidence. P5-10–13 remain REVIEW; P5-14 is WIP and the phase is still 9/14 DONE. Effective lint/SAST, coverage and remaining final reviews/runtime release gates are not waived. A phase-completion summary must wait until those criteria are satisfied. Nothing was deployed or committed.

## What Did Not Work

The browser connector bootstrap failed before execution. Initial CLI E2E attempts reached registration 500 because the external container's application password differed from compose defaults; the first isolated database also lacked compose-equivalent grants. PostgreSQL diagnostics established the actual cause. A new isolated database received default grants before migrations and the runner used the correct local test-role URL; no external role password was altered. Those failed attempts are not passing evidence. The fixture preflight now exposes a wrong application credential early.

RTK's shorthand pnpm typecheck dispatch ignored a filter and invoked bare tsc; explicit `rtk proxy pnpm --filter ... run typecheck` passed. Nested PowerShell quoting failed several initial environment probes; direct native commands and ignored temporary runner files replaced them without production edits. A final formatter run caught the newly added long E2E button line; Prettier fixed it before the final passing check. The first public screenshot showed the cover instead of the message, leading to the stronger open-cover/in-viewport assertion and a new passing E2E run.

## Follow-Ups and What to Watch

Consult the latest SQL continuation record and progress board for broad integration totals. Effective lint/SAST/coverage remain real gaps; no placeholder is accepted as evidence. Node 24 now has executed browser/database acceptance evidence, but the entire production build/unit release matrix was not repeated on that runtime in this parent lane. Preserve migration 0018 deployment ordering from ADR-106. Native package installation must occur with the refreshed lockfile on deployment. Large moderation tables retain their existing internal horizontal scroll; this change prevents them from compressing navigation or overflowing the entire page.
