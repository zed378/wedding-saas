# P5-14 — MFA, template audit and notification failure coverage

| | |
|---|---|
| Date | 2026-11-26 |
| Task | `TASKS/PHASE-5-ADMIN-PANEL.md` § P5-14 |
| Phase | Phase 5 |
| Surface / author | Backend unit tests; parallel service-coverage lane |
| Commits / PR | Existing shared uncommitted tree preserved; no commit, merge or deployment |
| Status | Scoped tests and verification completed; overall Phase 5 acceptance remains parent-owned |

## What Changed

Extended MFA enrollment/challenge tests with missing and unconfirmed factors, valid encrypted enrollment, recovery-code hashing and consumption, expired credentials, wrong-purpose step-up tokens and truncated ciphertext. Added a standalone email-webhook service suite for recipient/event normalization, bounded suppression evidence, idempotent persistence and database-error propagation. Extended existing DLQ and template suites with cleanup-failure and fail-closed audit cases.

The existing untracked template and DLQ suites were already present when this lane started and were preserved. This record claims only the additions described here; their pre-existing coverage is included in the final focused measurement.

## Why

The preceding `2026-11-26-P5-14-full-sql-and-coverage.md` measured service branches below the unchanged 75% requirement and identified these services as gaps. P5-14 requires bounded administrative power and non-bypassable MFA; `docs/SECURITY/04-AUTHORIZATION-RBAC.md`, `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` § Special Case, and `docs/PLAN/17-ACCEPTANCE-CRITERIA.md` require attributable admin operations and meaningful security evidence. The DLQ cases protect delivery-monitoring failure handling rather than a new feature.

## How

Read the task/status board, MEMORY index and coverage record, PLAN/00, PLAN/16, PLAN/17, TESTING/03 and SECURITY/04, /05 and /07 before editing. No graph/JevGraph tools were exposed in the tool catalog, so bounded local reads were used. The requested antislop-code skill was absent at both `skills/antislop-code/SKILL.md` and `.agents/skills/antislop-code/SKILL.md`; no unavailable skill behavior is claimed.

Existing Drizzle-shaped test doubles exercise service branches without a database. MFA tests use real encryption, HMAC TOTP computation and signed JWTs; fake time controls expiry deterministically. The webhook suite mocks only metrics/logger and database persistence. Its subject is the currently unreferenced `EmailWebhookService`, not the mounted controller's separate `EmailBounceService`; these tests do not imply that this service receives production webhooks.

Every terminal command used RTK. Focused test execution uses the existing portable Node **24.18.0** at `C:/Users/Zed/AppData/Local/OpenClaw/deps/portable-node/node.exe`. No dependency installation, production source edit, exclusion or threshold change was performed.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/auth/mfa/mfa.service.spec.ts` | Ten enrollment/challenge/encryption/expiry/purpose scenarios with actual crypto |
| `backend/api/src/modules/notification/email-webhook.service.spec.ts` | New 17-case normalization, suppression and persistence-failure suite |
| `backend/api/src/modules/notification/dlq-monitor.service.spec.ts` | Two added post-count read/shutdown failure cases; existing cases preserved |
| `backend/api/src/modules/admin/admin-templates.service.spec.ts` | One added transactional audit-failure propagation and no-invalidation assertion |
| This record | Evidence and limits for the parallel service-coverage lane |

Ignored verification artifact: `tmp/p5-service-lane-coverage-20261126.json`. Parent owns shared index, changelog, board, phase checklist and global verification.

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Test meaningful security and failure boundaries using existing service APIs | Addresses measured gaps without altering application behavior or measurement rules | Not applicable; no architectural decision |
| Keep the unused webhook service in the coverage population | Removing it to improve a percentage would conceal its uncertain production ownership | No new ADR; previous record already identifies the follow-up |

## Deviations from `docs/`

None. No business rule, API, schema, authorization or operational contract was changed.

## Tests Added and Executed

The initial focused invocation passed **4 files / 72 tests**. After adding the final two DLQ cases and template-audit case, the final Node 24 focused invocation passed **4 files / 75 tests**, exit 0, in **22.93 seconds**. Its command was `node node_modules/vitest/vitest.mjs run src/modules/auth/mfa/mfa.service.spec.ts src/modules/notification/email-webhook.service.spec.ts src/modules/notification/dlq-monitor.service.spec.ts src/modules/admin/admin-templates.service.spec.ts --pool=threads --maxWorkers=1 --coverage` with four explicit `--coverage.include` service paths, `--coverage.reporter=json-summary` and a temporary report directory.

This measurement intentionally describes only those four services, not global acceptance. No checked-in coverage config was changed. The coordinator must run the existing combined unit/SQL configuration to determine the global gate.

| Layer / check | Observed result |
|---|---|
| Unit | Final 75 tests pass; 30 added cases across four files |
| Focused coverage | Lines 318/318 (100%); branches 195/199 (97.98%); statements 332/334 (99.4%); functions 45/46 (97.82%) |
| Template service branches | 82/84 (97.61%) |
| MFA service branches | 37/39 (94.87%) |
| DLQ monitor branches | 18/18 (100%) |
| Email webhook service branches | 58/58 (100%) |
| API TypeScript | `node node_modules/typescript/bin/tsc --noEmit -p backend/api/tsconfig.json` passes |
| Scoped Oxlint | Four changed specs, `--deny-warnings`, pass |
| Scoped Prettier | Four changed specs pass |
| Integration / E2E / complete combined coverage | Parent-owned; not executed by this lane |

## Security Verification

| Control | Named passing evidence and limits |
|---|---|
| Enrollment cannot confirm without an active factor or valid first code | `refuses absent enrollment or an invalid first code without confirming factors` asserts no updates/inserts |
| Encrypted enrollment storage | `stores an encrypted unconfirmed setup and returns a scannable URI with encoded email` decrypts stored ciphertext to the returned secret |
| Recovery material hashed at rest | `confirms a valid setup and persists only hashed replacement recovery codes` checks exact stored hashes |
| Unconfirmed factors cannot authenticate | `rejects empty challenges and missing or unconfirmed factors without writes` |
| TOTP success does not unnecessarily consume recovery credentials | `records last use for valid TOTP and does not consume a supplied recovery code` |
| Recovery fallback marks a matched code consumed | `falls back from invalid TOTP to an unused recovery code and marks it consumed`; a unit test does not establish concurrent single-use atomicity |
| Expiry and purpose boundaries | `rejects expired MFA and step-up credentials and forged token text`; `rejects correctly signed step-up tokens carrying the wrong purpose` |
| Admin mutation audit failure propagates | `does not return a published version or invalidate cache when its transactional audit fails`; database rollback is separately covered by SQL tests, not established by this double |
| Endpoint ownership / payment signatures / uploads / stored-input sanitization | Not applicable to this test-only edit; no new endpoint or production path changed and no new verification of these controls is claimed |

## Abuse Cases Covered

Expired or wrong-purpose credentials, malformed challenge text, absent/unconfirmed factors, unprotected recovery storage and publishing while audit persistence fails have named evidence above. Notification tests additionally cover malformed payloads, missing recipients, address normalization, oversized diagnostic messages, failed suppression persistence and queue shutdown errors. These do not replace endpoint authentication, provider-signature validation or real delivery integration tests.

## Definition of Done Verification

Appropriate unit tests, deterministic crypto/time evidence, scoped lint/format and API types pass. New `:id` endpoint, mass assignment, response envelope, new stored input, payment processing and upload controls are not applicable because production behavior did not change. No sensitive real credential or personal data was introduced; synthetic addresses and a test signing key are used.

This record fulfills the lane's MEMORY requirement. Shared board/index/changelog and complete suite verification are assigned to the coordinator. The overall P5-14 gate, independent reviews and phase-summary completion are not certified or waived here. Phase 6 was not started.

## What Did Not Work

The first broad parallel source read exceeded the output budget; subsequent reads were bounded per service. The pre-existing suites proved much more complete than the historical combined coverage suggested, so they were retained rather than rewritten. The temporary focused coverage directory initially appeared as an untracked path; its JSON evidence was moved to ignored `tmp/` and the now-empty directory removed.

No test failed in either focused invocation. No production change was needed to make the added cases pass.

## Follow-Ups and Open Questions

Run the unmodified full combined unit/SQL service coverage gate after parallel changes settle; the focused percentages must not be presented as the global result. The previously recorded question about the unused `EmailWebhookService` remains: determine intended ownership in a separately reviewed functional change rather than removing or wiring it merely for coverage. Parent maintains existing coverage/ownership follow-ups on the board/backlog.

## What to Watch

No production runtime behavior changed. Keep the separate webhook services distinguishable in future work. If MFA recovery logic changes, complement these deterministic unit tests with real database concurrency checks; current test doubles cannot establish transactional single-use guarantees. A failed audit must continue propagating before public cache invalidation is reported successful.
