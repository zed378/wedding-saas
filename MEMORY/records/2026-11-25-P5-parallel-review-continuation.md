# P5-10–14 — Parallel review continuation

| | |
|---|---|
| Date | 2026-11-25 |
| Tasks / phase | P5-10–14, Phase 5 |
| Surface / author | API, admin, API client, tests and documentation; parallel coding agents requested by the owner |
| Commits / PR | Working-tree continuation; no commit, merge or deployment performed |
| Status | Corrections implemented; acceptance remains incomplete |

## What Changed

The invitation overview now supplies an absolute API origin. The shared client also resolves same-origin relative API URLs in the browser, fixing other administrative callers. Blocklist pagination clears stale rows after a failed page request and returns to the preceding page after removing its final item.

Suspending a user now requires the existing step-up guard, and the UI obtains proof through the existing MFA modal. Failed suspension requests no longer turn into simulated success during tests. New acceptance coverage discovers mounted administrative routes and exercises hostile sessions across the complete discovered inventory.

## Why

The owner requested continued parallel implementation. TASKS/PROGRESS.md identified P5-10–13 as REVIEW and P5-14 acceptance as outstanding. SECURITY/03 requires fresh authentication for suspension; SECURITY/04 and SECURITY/05 require bounded administrative access. Existing mocked client tests had hidden a production URL failure.

## How

Three agents reviewed disjoint invitation/dashboard, audit/blocklist, and authentication/acceptance areas. The parent coordinated sequential database suites against the dedicated `wedding-p5-admin-tests-20261125` container, preserving other projects' containers and existing uncommitted work. Graph discovery tools were absent from ALL_TOOLS, so targeted source reads/searches were used.

## Files and Components Touched

| Files | Change |
|---|---|
| `admin/src/pages/InvitationsPage.tsx`, `InvitationsPage.transport.spec.tsx` | Absolute API origin and actual-client authenticated transport coverage |
| `admin/src/pages/SlugBlocklistPage.tsx`, `slug-blocklist.spec.tsx` | Failed-page and delete-last-page behavior |
| `packages/api-client/src/client.ts` and client tests | Browser-relative URL resolution, preserved absolute origins |
| `admin/src/pages/UsersPage.tsx`, user tests, StepUpModal tests | Mandatory MFA confirmation and realistic failure handling |
| `backend/api/src/modules/admin/admin-users.controller.ts`, `backend/api/test/admin-users.spec.ts` | Suspension step-up guard and existing HTTP fixtures |
| `backend/api/test/admin-phase5-authorization.spec.ts` | Discovered route denial inventory, step-up and absent-content write checks |
| `backend/api/test/integration/admin-invitations.itest.ts` | Incomplete and complete real-content fixtures, private-content exclusion and audited reads |
| `backend/api/test/integration/admin-mfa-session.itest.ts` | Complete Google identity fixture for type safety |
| `admin/src/pages/orders.spec.tsx` | Correct API success envelope and resolved URL expectation |
| `docs/API/09-ADMIN-API.md` | Document existing step-up header contract |
| `MEMORY/records/2026-11-25-P5-10-P5-11-review-verification.md`, `2026-11-25-P5-12-P5-13-review-followup.md` | Focused lane evidence |
| `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, `TASKS/PROGRESS.md`, `TASKS/PHASE-5-ADMIN-PANEL.md`, `TASKS/BACKLOG.md`, `.agents/ck/` | Current verification results and remaining gates |

## Decisions Made

No new architecture or product decision. These changes restore specified behavior and reuse the existing step-up mechanism; no ADR is necessary. No new runtime dependency or payment-state mutation was introduced.

## Deviations from docs/

None. API/09 now explicitly names the existing SECURITY/03 step-up requirement. Windows native equivalents were used because the existing verification shell selects WSL without node; this is not certification of `pnpm verify`.

## Tests Added and Executed

- Focused invitation/dashboard: 25 backend and 8 admin cases passed, including the actual-client transport test.
- Focused audit/blocklist: 27 backend and 13 admin cases passed.
- MFA provenance: 18 unit cases passed. Auth/token/order focused regressions: 74 passed. Administrative sweep/user HTTP: 46 passed. User/StepUpModal UI: 10 passed.
- Real PostgreSQL: `admin-dashboard`, `admin-invitations`, `admin-audit-logs`, `admin-slug-blocklist`: 12 passed across four files; dashboard includes 10,000 orders. `admin-mfa-session`, `auth-session`, `google-oauth`: 67 passed across three files.
- Nine other workspaces: 1,277 tests passed across 70 files. Shared API client then passed 33 cases after its URL correction.
- Static checks: all `scripts/check-*.mjs` passed, including the 1,229-file secret scan, tenant scope, status writer, reserved public routes, sanitization and migration pairs.
- API typecheck/build passed; other workspace typechecks passed in the sequential runner after the Google fixture correction was identified. Final build and broad-suite outcomes are recorded below before handoff.
- The initial invitation SQL test failed because its factory lacked required hero names; the corrected suite now checks both incomplete and complete invitations rather than weakening production validation. The broad API run hit a user HTTP setup hook timeout; the isolated 38-case rerun with a 60-second setup limit passed.

## Security Verification

| Control | Named evidence |
|---|---|
| Current database role outranks JWT role | `admin-phase5-authorization.spec.ts` sends an ordinary user's signed token claiming super_admin to every discovered endpoint |
| MFA provenance required | Same route inventory rejects an administrator without proof; `admin-mfa-session.itest.ts` verifies Google challenge, legacy refresh, role promotion and absolute rotation expiry |
| Suspension / refund need step-up | `admin-phase5-authorization.spec.ts` and `admin-users.spec.ts`; missing proof returns `MFA_STEP_UP_REQUIRED` before mutation |
| No invitation content write surface | Inventory test tries POST/PATCH/PUT/DELETE against invitation content paths and expects absence |
| Audited operational reads without private names | `admin-invitations.itest.ts`, including real groom/bride fixtures and audit assertions |
| Audit/export and blocklist transactions | `admin-audit-logs.itest.ts`, `admin-slug-blocklist.itest.ts` |
| Payment decisions / upload validation / stored text | Not changed in this continuation; passing static checks do not replace their independent security suites |

## Abuse Cases Covered

Anonymous administrative access, forged JWT role, an administrator session without MFA, missing step-up, attempted content writes, stale pagination after failed fetch, and incorrect client URL construction have named regressions above. This does not certify all administrative writes by comparing a complete scripted session's action and audit counts.

## Definition of Done Verification

P5-10–13 remain REVIEW because the complete global gates and browser acceptance have not all passed. P5-14 remains incomplete; no-deploy template browser flow, moderation browser flow, and exhaustive write/audit reconciliation still need evidence. No unmet criterion was waived and no Phase 6 feature was started. Existing records are preserved; this follow-up records new outcomes.

## What Did Not Work

Sandboxed integration could not connect to localhost or the Docker runtime; the same runner passed against the dedicated database with approved escalation. Browser skill bootstrap fails before execution because sandbox metadata lacks `sandboxPolicy`, preventing rendered QA. Native Next builds reached compilation, types and static generation but encountered Windows symlink EPERM during standalone packaging; final retry results must be read before release. Host Node is 26.10.0 while the project targets Node 24; this run is not proof on the supported runtime.

## Follow-Ups and Open Questions

See TASKS/BACKLOG.md's Phase 5 follow-up section for supported-runtime verification, rendered acceptance, full-suite/build results, and remaining audit-count reconciliation. Migration 0018 remains required for deployment and old admin sessions must authenticate again. No production migration was run.

## What to Watch

Administrative suspension now requires MFA proof, so clients using only their ordinary bearer token receive a step-up error. Browser requests resolve against the page origin unless an explicit API origin is configured. A Next standalone packaging failure must not be reported as a successful build merely because compilation passed.
