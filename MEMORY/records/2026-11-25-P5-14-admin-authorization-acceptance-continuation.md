# P5-14 — Authorization acceptance and suspension step-up correction

Date: 2026-11-25. Phase 5 continuation; acceptance remains incomplete. Existing uncommitted P5-10–13 and MFA provenance work preserved. No deployment, migration execution or commit performed by this agent.

## What changed and why

The acceptance review found `AdminUsersController.suspend` lacked `StepUpGuard`, despite SECURITY/03 and P5-02 requiring fresh verification for suspension. Refund already used the guard. Suspension now requires the existing guard; `UsersPage` opens the existing `StepUpModal` and transmits its server-issued proof with the access token. Failed suspension no longer fabricates success in test mode. These changes restore the existing contract and do not add a permission or endpoint.

The new `admin-phase5-authorization.spec.ts` discovers every controller mounted by `AdminModule`, uses signed access tokens and the real SessionService with a stubbed user lookup, and checks all 30 endpoints against anonymous users, ordinary users with a signed super-admin role claim, and admins without signed MFA provenance. It also checks missing/invalid step-up proof on refund and suspension and verifies 24 attempted invitation content write routes are absent from the complete controller module.

The new real PostgreSQL/Redis `admin-phase5-template-flow.itest.ts` authors template data through actual admin services, primes an empty catalog cache, publishes, immediately discovers the template and creates a user's invitation on its concrete version without restarting services. It verifies immutable published definitions, protected in-use deletion, deprecation without changing the invitation's locked version, and unused-template deletion. Every successful template action in this scripted session is compared against complete audit row counts, actor, reason, resource and nonempty snapshots. This is not exhaustive coverage of every admin write category or browser acceptance.

## Files touched

- `backend/api/src/modules/admin/admin-users.controller.ts`: enforce existing step-up guard.
- `admin/src/pages/UsersPage.tsx`: step-up confirmation, access/proof headers, remove fabricated test success.
- `backend/api/test/admin-users.spec.ts`: valid step-up fixture for suspension regression tests.
- `backend/api/test/admin-phase5-authorization.spec.ts`: complete mounted admin endpoint denial sweep and content boundary.
- `backend/api/test/integration/admin-phase5-template-flow.itest.ts`: real data-driven template flow and scripted audit count.
- `backend/api/test/integration/admin-mfa-session.itest.ts`: supply the required Google identity fixture name.
- `admin/src/pages/users.spec.tsx`: real suspension step-up flow regression.
- `admin/src/components/StepUpModal.spec.tsx`: accessible-label selectors include the required-field suffix.
- This record; parent agent maintains shared index, task board and changelog.

## Decisions and deviations

No new architecture or business rule decision; no deviation from docs. API/09's missing step-up header description is being updated by the parent. No payment-state, pricing, upload or stored free-text behavior changes. A previous record was initially appended during this turn; its historical contents were restored and continuation evidence moved here.

## Test evidence

- `admin-mfa-session.spec.ts`: 18/18 passed.
- `access-token.spec.ts`, `auth-http.spec.ts`, `admin-orders.spec.ts`: 74/74 passed.
- `admin-phase5-authorization.spec.ts` and `admin-users.spec.ts`: 46/46 passed before the additional invalid-proof assertion; parent coordinates final rerun.
- `users.spec.tsx` plus `StepUpModal.spec.tsx`: 10/10 passed after adding the real suspension factor flow.
- Final `admin-phase5-authorization.spec.ts` rerun: 33/33 passed including invalid proof rejection. API `tsc --noEmit` passed with the new integration file. Final `users.spec.tsx` rerun: 8/8 passed, including the added API-rejection case; the previously passing StepUpModal file was unchanged after its 3/3 pass.
- New real database template integration: execution delegated to parent, result pending when this record was authored.
- Full API, workspace types/builds, gates and integration suites are coordinated by parent; no blanket passing claim here.

## Security verification and abuse cases

SECURITY/03: `requires step-up for refund and suspension even with an MFA-authenticated session` proves authenticated sessions cannot omit a fresh proof; invalid-proof assertion added for final execution. `requires fresh MFA before sending authenticated suspension with its audit reason` proves the UI sends no suspension before factor verification and includes the returned proof afterward. StepUpModal's three fail-closed cases prove missing sessions and failed factor requests cannot fabricate authorization.

The final sweep also passed invalid-proof rejection. `keeps suspension uncommitted and displays an API rejection after verified MFA` passed: a 403 response after successful factor verification leaves the suspension dialog open and displays the API error, rather than falsely closing it as success.

SECURITY/04–05: every generated endpoint case in `P5-14 every mounted admin route rejects privilege escalation` checks signed-token role manipulation, absent MFA and anonymous access. `has no invitation content write routes in the real admin module` proves absent content editing paths. The template integration compares scripted template writes to real audit rows; it does not certify every admin action's audit completeness. Cross-tenant resource suites remain independently required. Payment signature and upload spoofing controls are not touched by this correction.

## What failed and remaining work

The first sweep used non-UUID fixture IDs and failed in tenant-scope validation; UUID fixtures corrected it. UI tests initially matched exact labels excluding required-field text; regex label matching fixed selectors. A focused run overlapped an import edit and briefly saw undefined StepUpGuard; final focused API run passed after the import was present. No assertions were weakened to accept a rejected action.

P5-14 remains incomplete pending real template/moderation browser flows, audit count coverage beyond template actions and remaining global checks. Browser visual QA is not claimed. Suspension now depends on the existing factor-verification endpoint and users must complete it before retrying; monitor missing-proof denials after rollout. No new migration is needed for the suspension correction; prior MFA migration 0018 still must precede deployment of its provenance changes.

## Authentication UI continuation

The browser lane found further production simulations: LoginPage invented MFA tickets after rejected credentials/network failures; MFA verify without a ticket fabricated an admin token; enrollment displayed a fixed shared secret and recovery codes and could fabricate a session. These paths are removed. Login displays API/network errors, follows only server-returned challenge tickets, and includes credentials. Verification requires a real ticket. Enrollment starts empty, displays setup errors, and remains disabled without real setup data. The provider rejects malformed session responses, uses the current origin, and reads `/auth/me`'s actual `{ data: { user } }` envelope instead of treating the wrapper as a user. No backend authorization change or new permission was introduced.

Additional files: `admin/src/pages/LoginPage.tsx`, `MfaVerifyPage.tsx`, `MfaEnrollPage.tsx`, `admin/src/auth/admin-auth.tsx`, `admin/src/pages/mfa.spec.tsx`, and new `admin/src/pages/auth-fail-closed.spec.tsx`. The existing enrollment test now requires a server setup response before its checkbox can enable activation.

Executed `auth-fail-closed.spec.tsx`, `mfa.spec.tsx`, and `admin-auth.spec.tsx`: **17/17 passed**; admin `tsc --noEmit` passed. The six new fail-closed cases cover network and credential login failures without invented challenges, server-ticket-only navigation, missing-ticket verification without requests or tokens, rejected setup without fabricated secrets, and the real nested same-origin `/auth/me` response. These named cases verify the SECURITY/03 boundary in the component integration layer. No browser or full-stack acceptance claim follows from them.

The template integration initially searched a slug with hyphens while the real catalog searches names/categories. Changing the fixture query to `Acceptance Live` restores the documented search contract; production catalog logic was unchanged. Parent owns the real PostgreSQL/Redis rerun and its outcome.

Parent's final PostgreSQL/Redis rerun (`tmp/phase5-integration.log`, 19:11 local) passed both template/support integration files, 3/3 cases. This includes the named no-restart template author/publish/catalog/user-create/deprecate case and its eight-write audit reconciliation. The initial missing Redis and search-fixture failures are resolved; this service integration pass still does not substitute for browser acceptance.
