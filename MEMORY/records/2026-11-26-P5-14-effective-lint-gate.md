# P5-14 — Effective workspace lint gate

| | |
|---|---|
| Date | 2026-11-26 |
| Task / phase | P5-14 acceptance continuation; Phase 5 |
| Surface / author | Workspace tooling and unused-code cleanup; parallel lint lane |
| Commits / PR | Existing shared working tree preserved; no commit, merge or deployment |
| Status | Effective lint gate implemented and verified; overall Phase 5 remains parent-owned |

## What Changed and Why

All 13 workspace lint commands previously echoed that lint was not wired and returned success. They now invoke Oxlint. The root `lint` command checks the complete repository directly, including root scripts, rather than relying on Turbo task caching. This supplies the real local lint check required by `docs/DEVOPS/01-CI-CD.md` and global DoD item 9 while P0-17 automation remains deferred.

## How

Oxlint parses TypeScript independently of the TypeScript compiler API. The initial ESLint/typescript-eslint installation was incompatible with the repository's TypeScript 7: typescript-eslint explicitly refused to load and required TypeScript below 6.1. Those trial dependencies and configuration were removed before installing Oxlint 1.95.0. The final peer check reports no issues.

The configuration promotes correctness findings to errors, retains unused-variable checking, and fails warnings. Only two unrelated style preferences (`unicorn/no-useless-spread` and `unicorn/prefer-string-starts-ends-with`) are disabled. Generated/build/test-output directories and intentionally insecure Semgrep self-test fixtures are excluded. `safe-next.ts` has one documented inline exception for the control-character regex that deliberately rejects unsafe redirect characters.

Unused imports were removed, intentional unused fixture/parameter bindings receive an underscore, unused prop destructures were removed, and an obsolete, unreferenced preview placeholder was deleted. Existing awaited operations remain present. This is lexical cleanup; authorization, payment, upload, sanitization and query behavior were not intentionally changed.

Graph MCP tools were absent from the exposed tool catalog, so bounded searches and reads were used. All shell invocations used the requested RTK prefix. Existing dirty changes were preserved.

## Files and Components Touched

| Paths | Change |
|---|---|
| `.oxlintrc.json` | Correctness configuration, generated-directory and intentional SAST-fixture exclusions |
| `package.json`, `pnpm-lock.yaml` | Root real lint command and locked Oxlint development dependency |
| `admin/package.json`, `e2e/package.json`, `backend/{api,worker}/package.json`, `frontend/{web-app,public-invite}/package.json`, `packages/{schema,template-renderer,ui,storage,config,logging,api-client}/package.json` | Replace 13 echo-only lint placeholders |
| `backend/api/src/modules/auth/mfa/{step-up.guard,mfa.service}.ts` | Remove unused imports; retain existing awaited factor queries and mark unused local result |
| `backend/api/src/modules/invitation/{invitation.controller,slug.service}.ts` | Remove unused imports |
| `backend/api/src/modules/guestbook/guestbook.service.ts`, `backend/api/src/modules/rsvp/rsvp.service.ts` | Remove unused row-type imports |
| `backend/api/src/shared/tenancy/analytics-repository.ts` | Remove unused schema imports |
| `backend/api/src/modules/admin/{admin-slug-blocklist.repository,admin-templates.service,admin-orders.service}.ts` | Remove unused ORM imports |
| `backend/api/src/modules/publishing/invitation-reminder.service.ts`, `backend/api/src/modules/notification/email-webhook.service.ts`, `backend/api/src/infra/storage/storage.module.ts` | Remove unused imports |
| `backend/api/test/{admin-users,admin-templates,admin-orders,phase-4-acceptance,singleflight}.spec.ts` | Unused imports and intentional unused test bindings |
| `backend/api/test/integration/{tenancy,registration,order-expiry,abuse-controls,auth-session}.itest.ts` | Unused imports/bindings; preserve fixture creation and login operations |
| `backend/worker/test/{notification-send.itest,email-adapters.spec}.ts` | Unused imports and fixture helper binding |
| `admin/src/pages/{TemplatesPage,ModerationPage,LoginPage}.tsx`, `admin/src/components/templates/SectionEditor.tsx`, `admin/src/pages/users.spec.tsx` | Unused imports/state-result/mock-argument bindings |
| `frontend/web-app/src/editor/EditorScreen.tsx` | Remove obsolete unused preview placeholder |
| `frontend/web-app/src/components/{RsvpTable,GuestbookModerationList}.tsx` | Stop destructuring an unused prop; accepted prop interfaces unchanged |
| `frontend/web-app/src/lib/safe-next.ts` | Narrow documented linter suppression; regex unchanged |
| `frontend/web-app/test/{analytics-dashboard,rsvp-dashboard,publish-success-modal,publish-flow}.spec.tsx` | Unused imports and fixture binding |
| `frontend/public-invite/src/components/{PublicRsvpForm,PublicGuestbookWall}.tsx` | Stop destructuring unused section data; accepted prop interfaces unchanged |
| `scripts/check-storage-paths.mjs` | Remove unused path import |
| This record | Evidence, unsuccessful attempts and limits |

The root manifests and lockfile were exclusively owned during installation, then released to the coordinating lane before its gate-script changes. Other contemporaneous edits to those files are owned by that lane, not attributed here.

## Decisions and Deviations

Use an independent TypeScript parser rather than downgrading the project's selected compiler or retaining an unsupported parser. No API, schema, product contract or library-major decision changed. The specification requires effective lint but does not prescribe its engine. No deviation from `docs/` was necessary. P0-17 remains deferred; local lint is not an automated pipeline or reviewer approval.

## Tests Added and Run

| Check | Actual result |
|---|---|
| Root `pnpm run lint` | Passed after final edits; complete repository checked, 94 enabled rules |
| Workspace lint via Turbo | 13 effective lint tasks passed; this run preceded switching the root command to a direct repository check |
| Negative lint probe | Temporary `scripts/lint-gate-probe.ts` with a duplicate object key was rejected with exit 1 by `eslint/no-dupe-keys`; probe removed in `finally` |
| Workspace typecheck after prop-destructure corrections | 19 tasks passed, 14 cached; all five affected app/API/worker typecheck tasks executed |
| Formatting | All changed TypeScript files formatted; final focused check of configuration, root manifest, analytics repository, redirect helper and editor passed |
| Dependency peers | `pnpm peers check`: no peer issues after final Oxlint installation |
| Full build, unit, real PostgreSQL/Redis, coverage, browser | Coordinating and SQL lanes own these runs; this record does not claim their results |

The lint probe proves failure behavior for an actual correctness defect and the clean run proves the probe was removed. A permanent test that merely repeats the linter implementation was not added.

## Security Verification

No endpoint, input field, payment-state source, uploaded-file policy, response envelope, ownership bypass or stored-text path was added. The `safeNext` control-character rejection remains byte-for-byte identical; only a linter comment was added. No security-control certification is inferred from a clean lint result. The parent regression suites remain the named evidence for authorization/payment/upload/sanitization behavior.

The Semgrep fixture exclusion applies only to deliberate insecure scanner test cases under `security/semgrep-tests/`; production security source is included. No blanket unused-variable or security-rule suppression was introduced.

## Abuse Cases Covered

The negative duplicate-key probe detects the original failure mode of a gate returning success while performing no useful check. Business abuse cases, tenant isolation and signed payment verification remain covered by their existing named application tests and are not re-certified by lint.

## Definition of Done Verification

This lane closes the effective lint placeholder gap. Local lint, negative failure behavior, affected TypeScript checks and formatting have executed. No new resource endpoint needs IDOR coverage; accepted fields, public contracts, lifecycle writers and sensitive logging are unchanged. Parent owns synchronized index, changelog, task-board and phase-card updates. Global tests, coverage, SAST, dependency advisories and final reviews must be evaluated separately; no unmet item is waived and Phase 5 is not declared complete here.

## What Did Not Work

ESLint/typescript-eslint could not run against the pinned TypeScript 7 and was removed, as described above. Initial nested PowerShell probes had quoting errors and made no source changes. A mechanical unused-binding pass briefly renamed destructured field names; targeted review corrected these to removed unused destructures before the passing typecheck. The parent's concurrent build saw the intermediate prop-field errors; its final rerun supersedes that attempt. One Prettier write encountered a transient file-open failure on the analytics repository; a targeted retry completed and its final check passed. No failed attempt is counted as passing evidence.

## Follow-Ups and What to Watch

The parent owns final release-runtime regression and global gate results. Root lint deliberately runs directly rather than being cached by Turbo. Keep generated outputs and intentionally insecure scanner fixtures out of lint, and keep application source in scope. Do not relax unused-variable checking globally to avoid maintaining imports. The pre-existing unused MFA query result was underscored without removing its awaited operation; reducing that query belongs to a separately reviewed authentication change.
