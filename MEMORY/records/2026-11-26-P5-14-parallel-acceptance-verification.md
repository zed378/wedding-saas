# P5-14 — Parallel acceptance verification

| | |
|---|---|
| Date | 2026-11-26 |
| Task / phase | P5-14 continuation; Phase 5, P5-10–13 remain REVIEW |
| Surface / author | API, admin, tests and operational documentation; parent coordinating three user-requested parallel agents |
| Commits / PR | Existing uncommitted working tree preserved; no commit, merge or deployment |
| Status | Corrections and bounded verification completed; phase acceptance incomplete |

## What Changed

The admin Vite server now forwards `/api` to the API on localhost:3000. Authentication and same-origin admin requests therefore reach the backend during development. The admin README documents both local ports. Template and shell UI tests now await API-backed rendering with explicit fixtures instead of assuming fabricated synchronous data.

Moderation now reads its audit snapshot under `FOR UPDATE OF invitation_guestbook` inside the mutation/audit transaction. Concurrent decisions record their actual preceding status; competing deletes create one success/audit and one 404. Added deterministic database contention tests, a detail audit-failure regression, and stronger complete-actor audit/resource reconciliation.

## Why

The owner requested continued parallel implementation. TASKS/PROGRESS and Phase 5 cards identified operational admin work as REVIEW, with P5-14 acceptance incomplete. SECURITY/05 Special Case requires auditable administrative bypasses; DATABASE/10 and P5-03 require accurate transactional audit state. PLAN/00 and TESTING/03 require working administrative flows without advancing to Phase 6.

## How

Three agents reviewed invitation/dashboard APIs, admin UI, and audit/blocklist acceptance separately. Parent serialized all real database suites against the existing dedicated `wedding-p5-admin-tests-20261125` PostgreSQL and `wedding-p5-review-redis-20261125` Redis; other projects' containers were left untouched. Semantic graph tools were unavailable, so discovery used bounded searches/reads. Referenced anti-slop skills are absent; no new UI design language was introduced.

## Files and Components Touched

| Path | Change |
|---|---|
| `admin/vite.config.ts`, `admin/README.md` | Local API proxy and development instructions |
| `admin/src/App.spec.tsx`, `admin/src/pages/templates.spec.tsx` | Real API fixtures and async rendering assertions |
| `backend/api/src/modules/admin/admin-moderation.service.ts` | Locked transactional snapshots for moderation/deletion |
| `backend/api/test/admin-invitations-audit.spec.ts` | Failed detail audit prevents detail/completeness queries |
| `backend/api/test/integration/admin-phase5-write-audit.itest.ts` | Every actor audit row, exact resource tuples, real before/after states |
| `backend/api/test/integration/admin-moderation-audit.itest.ts` | Contended update and delete regression tests |
| Four other `2026-11-26` records linked from MEMORY-INDEX | Lane findings and evidence |
| `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md` | Indexed records and operational summary |
| `TASKS/PROGRESS.md`, `TASKS/PHASE-5-ADMIN-PANEL.md`, `TASKS/BACKLOG.md` | Verification status and remaining gates |
| `.agents/ck/CONTEXT.md`, `.agents/ck/context.json` | Durable continuation checkpoint |

## Decisions Made

Reuse the documented localhost API port and Vite's built-in development proxy. Lock the existing guestbook row rather than introduce a new lock or audit abstraction. These restore specified behavior; no new product/architecture choice, dependency or ADR. No schema migration was added this session; earlier MFA provenance changes still require migration 0018 before deployment.

## Deviations from docs/

None. Direct native commands were used for Windows verification; this is not a claim that `pnpm verify` succeeded. Existing CI deferral is not treated as a waiver of global DoD.

## Tests Added and Run

| Layer | Evidence |
|---|---|
| API focused | Invitation/dashboard 25 passed; final invitation audit file including new failure case 6 passed; audit/blocklist 27 passed; moderation HTTP 18 passed |
| Admin | Final full suite: 15 files, 82 tests passed, threads/maxWorkers=1. Initial full run had three obsolete synchronous fixture failures; affected files then passed 12 tests before final full rerun |
| Other workspaces | Turbo test excluding API/admin: 17 tasks successful, 11 cached. This includes cached results; not a fresh execution claim for every workspace |
| SQL auth/admin | Nine serialized files, 82 tests passed: admin-invitations, admin-dashboard, admin-audit-logs, admin-slug-blocklist, admin-mfa-session, auth-session, google-oauth, admin-phase5-write-audit, admin-phase5-template-flow |
| Final SQL after concurrency correction | admin-moderation-audit + admin-phase5-write-audit: 2 files, 4 tests passed |
| Types / builds | Workspace typecheck: 19 tasks successful, 12 cached. Workspace build: 12 tasks successful, 7 cached. API types and final production build separately passed after moderation edit |
| Public SSR | 37 tests passed against production build |
| Static security gates | All scripts/check-*.mjs passed; explicit --all secret scan checked 1,229 files |
| Formatting | Eight changed code/test/README/config files passed Prettier. Global format:check failed on 100 files, including historical unrelated files; no blanket pass claimed |
| Lint | Root command exited zero, but every workspace script is a placeholder; no effective lint certification |
| API full unit suite | 56 files / 1,004 tests passed, threads/maxWorkers=1/hookTimeout=60000, 578.99 seconds. Moderation-focused HTTP and SQL suites separately passed after final correction |
| E2E / visual | Browser connection failed before execution: missing sandboxPolicy metadata. No browser action/screenshot or visual QA claimed |

## Security Verification

| Control | Named evidence |
|---|---|
| Accurate concurrent moderation snapshots | `records the actual preceding status for two concurrent moderation decisions` passed against PostgreSQL |
| No duplicate deletion audit | `records only one successful deletion when two admins delete the same entry concurrently` passed; loser receives 404 |
| Every scripted support write has exact audit resource | `persists exactly one reasoned before/after audit per successful write and invalidates public effects` passed, counting all actor rows rather than a filtered action subset |
| Invalid write changes neither state nor audit | `rejects missing or sanitized-away service reasons before any write or audit` passed in final counted-write file |
| Detail bypass fails closed on audit rejection | New admin-invitations-audit failure case passed; no detail SQL or completeness service call follows failure |
| MFA and auth provenance | admin-mfa-session, auth-session and google-oauth SQL files passed within nine-file run; no new authentication production edit this session |
| Owner isolation / mass assignment | No new endpoint or accepted write field; existing focused role/404 regressions passed. No phase-wide security certification inferred |
| Payments / uploads / sanitization | No payment-state source, pricing, upload pipeline or sanitization behavior changed. Counted refund checks exercise existing behavior, not provider money movement |

## Abuse Cases Covered

Concurrent conflicting moderation, double deletion, unlogged/extra administrative writes, wrong audit resource IDs, failed audit reads, and misleading template tests have concrete regressions above. SQL fixtures include published invitation continuity after suspension and existing refund cache/history effects. Coverage is bounded to these tests; browser flows and complete security scans remain required.

## Definition of Done Verification

Appropriate full unit/UI and bounded real SQL tests passed; no new :id route, write-field shape, response envelope or stored text input was introduced. Moderation retains the existing admin-only path and audit transaction. Records/index/changelog/task board are updated. Global formatting, effective lint/SAST/dependency checks, supported Node 24 verification, unexecuted integration suites and browser acceptance remain outstanding; none is waived. P5-10–13 remain REVIEW and P5-14 remains incomplete. No phase summary falsely certifies completion.

## What Did Not Work

Default fork test starts stalled; controlled threads/maxWorkers=1 runs completed focused, admin and SQL tests. Initial API integration run without threads was canceled and is not evidence. An initial root test command incorrectly forwarded Turbo's concurrency option to Vitest; it failed before tests and was replaced by direct Turbo invocation with concurrency at the correct layer. RTK pnpm typecheck dispatch invoked bare tsc; explicit `pnpm run typecheck` succeeded. Nested PowerShell quoting caused failed read/gate attempts; final gates ran successfully. Global formatter found pre-existing drift; this task did not reformat unrelated modules. Browser bootstrap remains unavailable. Host is Node 26.10.0, not the project's Node 24 target.

## Follow-Ups and Open Questions

TASKS/BACKLOG tracks browser template/moderation acceptance, effective CI/security checks, formatting drift and supported-runtime verification. P5-14 remains the next acceptance work; Phase 6 has not started. Existing MFA migration 0018 still precedes deployment. No new product question.

## What to Watch

Moderation operations on the same entry now wait for one another; inspect database lock waits if moderation latency grows. Audit integrity is proven for the tested guestbook operations, not every concurrent admin workflow. Vite's proxy applies only in development; deployed origin routing remains deployment configuration. The admin bundle still emits the existing >500 kB chunk warning.
