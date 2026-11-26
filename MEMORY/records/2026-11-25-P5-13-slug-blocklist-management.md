# P5-13 — Slug Blocklist Management

| | |
|---|---|
| Date | 2026-11-25 |
| Task | TASKS/PHASE-5-ADMIN-PANEL.md § P5-13 |
| Phase / surface | Phase 5; backend, admin, verification |
| Author | Coding agent |
| Commits / PR | Uncommitted implementation on feat/P5-10-admin-completion |
| Status | Implementation complete; REVIEW pending global/Phase 5 acceptance gates |

## What Changed
Added API-backed slug term administration and candidate testing. Changes are audited atomically, report up to 100 operational existing matches with an accurate total, and never change existing invitations. The editor's slug checks cache term data under an authoritative DB fingerprint; failed Redis invalidation cannot conceal newly blocked terms.

## Why
Implements SECURITY/10 § Slug Blocklist, DATABASE/12 match/governance rules, PLAN/10 root-path collision safety and PLAN/18 R7/R15. The task required a feature spec; MEMORY/specs/P5-13-slug-blocklist.md was written before implementation. The owner explicitly approved the missing API contract in conversation.

## How
Strict Zod write schemas normalize terms and sanitize reasons. Controller uses existing authentication, admin-role and per-user rate guards; configuration IDs are not tenant resources. A separate administrative repository performs operational invitation matching and audits each exposed invitation inside the mutation transaction. Database constraints arbitrate duplicate terms. Exact seeded system reservations and public/preview routes cannot lose exact protection. Redis caches are invalidated after commit; slug validation reads a DB fingerprint before trusting a cached term list, falling back to direct reads on cache misses. Existing no-cache callers retain prior SQL behavior.

## Files and Components Touched
| Path | Change |
|---|---|
| backend/api/src/modules/admin/admin-slug-blocklist.controller.ts | CRUD/test HTTP routes and validation |
| backend/api/src/modules/admin/admin-slug-blocklist.service.ts | Atomic writes, explicit DTOs, conflicts, route protection |
| backend/api/src/modules/admin/admin-slug-blocklist.repository.ts | Pagination and audited operational impact matching |
| backend/api/src/modules/admin/schemas/admin-slug-blocklist.schema.ts | Strict fields and sanitized reason |
| backend/api/src/modules/admin/admin.module.ts | Controller/providers and InvitationModule wiring |
| backend/api/src/modules/invitation/slug.service.ts | Authoritatively versioned term cache |
| admin/src/pages/SlugBlocklistPage.tsx | CRUD, reason form, candidate test, existing-match notice and pagination |
| admin/src/App.tsx; admin/src/components/AdminLayout.tsx | New invitation/blocklist routes and navigation |
| backend/api/test/admin-slug-blocklist.spec.ts | HTTP/schema/cache tests |
| backend/api/test/integration/admin-slug-blocklist.itest.ts | Real PostgreSQL governance tests |
| backend/api/test/public-route-reservations.spec.ts | Negative/positive route gate fixture |
| backend/api/test/idor-sweep-inventory.spec.ts | Named admin configuration/invitation access-test inventory |
| admin/src/pages/slug-blocklist.spec.tsx | Five UI tests |
| admin/src/App.phase5.spec.tsx | Shared routing/role regression coverage from parallel P5-12 work |
| scripts/check-public-route-reservations.mjs; scripts/verify.sh; package.json | Route reservation verification entry point |
| docs/API/09-ADMIN-API.md; MEMORY/DECISIONS.md | Owner-approved contract; ADR-105 |
| MEMORY/specs/P5-13-slug-blocklist.md; MEMORY/records/2026-11-25-P5-13-slug-blocklist-management.md | Spec and evidence |
| TASKS/PROGRESS.md; TASKS/PHASE-5-ADMIN-PANEL.md; TASKS/BACKLOG.md; MEMORY/MEMORY-INDEX.md; MEMORY/CHANGELOG.md | Shared integration status and follow-ups |

## Decisions Made
ADR-105: explicit CRUD/test contract, immutable exact system reservations, DB-fingerprinted Redis entries and audited impact inspection. No migration/new dependency. Caching intentionally retains one DB fingerprint query rather than risking stale acceptance. The existing seed already includes required system words and initial profanity; no duplicate seed list was added.

## Deviations from docs/
API/09 originally omitted this task's required API. The project owner approved the proposed extension, now documented with ADR-105. No lifecycle, payment or schema deviation. Existing shared authentication has an unresolved session-level MFA provenance gap; no factor-existence-only guard was represented as proof of MFA.

## Tests Added and Results
| Layer | Evidence |
|---|---|
| HTTP/unit | admin-slug-blocklist.spec.ts: 15 passed; auth, role, strict bodies, sanitization, missing IDs, test box, exact/substring cache behavior and DB failure |
| Route gate | public-route-reservations.spec.ts: one passed; a new static route fails until an exact seed is added |
| PostgreSQL | admin-slug-blocklist.itest.ts: five passed as part of four admin suites / 11 passed using a dedicated PostgreSQL 18 database |
| UI | slug-blocklist.spec.tsx: five passed; API list, candidate result, update with impact, reason-gated delete, network failure |
| Types/build/global | See shared verification addendum below; global green is not claimed |

## Security Verification
| Control | Requirement | Named test |
|---|---|---|
| Admin-only configuration IDs | SECURITY/05 special case | admin-slug-blocklist.spec.ts: ordinary user cannot post/patch/delete platform configuration or reveal its contents |
| Missing ID 404 | API/00 | admin-slug-blocklist.spec.ts: patch/delete missing configuration returns identical 404 |
| No mass assignment | SECURITY/08 | rejects client actor/status/owner_id mass assignment before service |
| Sanitized reasons | SECURITY/08 | sanitizes script reason before service and normalizes uppercase term; rejects an all-script reason after sanitization |
| Auditable tenancy bypass | SECURITY/05 | integration: creates audited data and reports matching existing invitations without changing them |
| Atomic mutation/audit | DATABASE/10 | integration: rolls back a mutation if its audit insert fails |
| Exact and leetspeak correctness | DATABASE/12 | integration: folded substring impact matches enforcement checker including padding; unit: exact matches for reserved words and folded case for substrings |
| Public route safety | SECURITY/10 | integration: cannot remove or rename an exact public route reservation; public-route-reservations.spec.ts |
| Fresh cache enforcement | SECURITY/00 fail closed | uses DB fingerprint so stale Redis data cannot approve a newly blocked slug; does not approve when authoritative DB read fails |
| Payment/upload | SECURITY/07 and 06 | Not applicable: no payment state or uploaded file changes |

## Abuse Cases Covered
Wrong-role reads/writes, forged mutable fields, malformed/missing IDs, missing/all-script reasons, duplicate case-insensitive terms, leetspeak padding, reserved-route removal and deletion, mutation without audit, existing invitation takedown and stale-cache acceptance are covered by the named tests above. Actual Redis outages are covered by existing CachePort tests; this task's cache tests use the port stub and authoritative DB.

## Definition of Done Verification
Task DoD implementation and focused tests are present: mutable data without deploy; matching/false-positive tests; atomic audits; existing-slug report. HTTP success/error envelopes are asserted. Seed data was already present. No tenant content mutation or payment status write exists. Checks on new code do not waive global DoD: full repository gates, MFA provenance and visual acceptance remain unresolved in BACKLOG and P5-14. Boards retain REVIEW and no completed-task count is incremented.

## What Did Not Work
The default PowerShell profile stalled commands; explicit cmd/no-profile child invocation worked. Some pending patch calls had to be read back before switching approach. pnpm was absent from PATH, so equivalent installed Node/Vitest/TypeScript binaries were used. Default full-suite worker counts caused startup/password-test timeouts; bounded retries distinguish resource contention from the pre-existing payment provider boundary failure. Fresh Testcontainers failed before assertions because migration 0006 grants to an absent wedding_app role; the dedicated DB was explicitly bootstrapped, then all four new admin suites passed sequentially.

## Follow-Ups and Open Questions
P5-14: session-level MFA issuance/refresh verification and visual QA. P0-17: deferred CI/SAST/dependency scanning. BACKLOG records existing payment-boundary/mock-price gate failures and shared harness bootstrap. No feature-contract decision remains unanswered.

## What to Watch
Term changes can produce up to 100 per-invitation read audits plus the configuration audit. The fingerprint query scans a small configuration table on validation; watch latency as list size grows. Cache mutations happen after commit under a fail-open cache port, but validation remains DB-authoritative. Existing matched invitations remain accessible by design and require separate moderation decisions.

## Continuation review — 2026-11-25

The route reservation scanner now treats Next.js parallel route slots (`@modal`) as URL-transparent, like route groups. Previously a static route inside a slot could evade the reservation gate because its apparent first segment started with `@`. `public-route-reservations.spec.ts` now includes `@modal/(group)/support`, rejects it without an exact reservation, and accepts it once the exact seed exists. The route gate CLI passed against the current repository. The first focused run passed the route fixture and four schema/cache checks; its HTTP setup exceeded the default ten-second hook timeout under concurrent machine load, so that run is not evidence of HTTP success. A retry with a sixty-second hook timeout and a later combined threads-pool run stalled without assertion results; both were stopped to release resources before root-level sequential verification. This continuation does not claim a new PostgreSQL run.
