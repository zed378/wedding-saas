# P5-13 — Bind blocklist cache entries to their actual database snapshot

| | |
|---|---|
| Date | 2026-11-26 |
| Task / phase | `TASKS/PHASE-5-ADMIN-PANEL.md` § P5-13; Phase 5 |
| Surface / author | Backend slug validation; parallel final-review correction lane |
| Commits / PR | Shared uncommitted tree preserved; no commit, merge, deployment or migration |
| Status | Correction and focused verification completed; full combined SQL execution remains coordinator-owned |

## What Changed

Slug validation now computes a cache-miss key from the exact rows fetched by that miss, using the same canonical SHA-256 fingerprint as PostgreSQL. A list read during a concurrent edit cannot be cached under an earlier state's fingerprint. Added a deterministic unit regression and a real-PostgreSQL fingerprint-compatibility integration case.

## Why

Final P5-13 review found an ABA cache race violating `MEMORY/specs/P5-13-slug-blocklist.md` § Transactions and Side Effects, `docs/DATABASE/12-PLATFORM-CONFIG.md` § Seeding and Caching, and `docs/SECURITY/10-ABUSE-PREVENTION.md` § Slug Blocklist. The earlier implementation fingerprinted the database and read rows in two separate statements, then stored the second statement's rows under the first statement's key.

For example, A contains an exact or substring term `bad`. A validator reads fingerprint A; an admin changes that same row to `good` (B); the validator fetches B; the admin restores `bad` (A) and invalidates Redis; the validator then writes B into cache[A]. Later validation sees authoritative fingerprint A but incorrectly approves `bad` until expiry. No Redis outage is required: the late cache write can follow both successful invalidations.

The must-fix finding was reported before production edits. The coordinator explicitly assigned this localized security correction and the corresponding regression.

## How

The cache hit still uses one authoritative aggregate query. A cache miss now selects `id`, `term` and `match_type` together. It serializes `id:term:matchType`, sorts by the unique canonical UUID prefix, joins with commas and hashes that precise list. PostgreSQL uses matching ordered aggregation and UTF-8 SHA-256. Only the returned term/match-type pairs are cached; IDs are used internally for version identity.

The key digest changed from MD5 to SHA-256 in both database and JavaScript. This keeps the existing strict `weak-md5-digest` SAST rule effective without a suppression or scanner change. PostgreSQL 18 provides the required `sha256(bytea)` and `convert_to` built-ins; no extension, migration or dependency is required. Existing ephemeral MD5-keyed entries are naturally bypassed and expire under their prior TTL. Match semantics, TTL, route protections, tenant read/audit rules and invalidation behavior remain unchanged.

No graph tools were exposed; bounded reads and literal searches were used. Mandatory task/spec/security/MEMORY reading occurred during the immediately preceding final review. Shell commands were prefixed with RTK. Node execution uses portable Node 24.18.0.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/invitation/slug.service.ts` | Matching SHA-256 SQL/JavaScript fingerprint; fetched-list-derived cache-miss key |
| `backend/api/test/admin-slug-blocklist.spec.ts` | Deterministic intermediate-list/restored-fingerprint regression; existing miss fixture includes row ID |
| `backend/api/test/integration/admin-slug-blocklist.itest.ts` | Verify the generated multi-row cache key equals PostgreSQL's fingerprint |
| This record | Cause, correction, executed evidence and outstanding verification |

Parent owns shared TASKS/MEMORY index/changelog and complete combined verification.

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Derive miss keys from the fetched row snapshot | Removes the mismatch without another transaction/query or weakening cache authority | Not required; correction within the approved cache contract |
| Use SHA-256 in both fingerprint implementations | Maintains the strict existing SAST policy and uses PostgreSQL built-ins | No architectural/product deviation |

## Deviations from `docs/`

None. The feature spec requires database-authoritative cache behavior; this corrects its implementation. No policy, endpoint, schema or business-rule change was introduced.

## Tests Added and Executed

| Check | Actual evidence |
|---|---|
| Negative regression before correction | `cannot cache a concurrent intermediate list under a restored blocklist fingerprint` **fails** on prior source: expected `bad`, received `undefined`; one selected failure, 15 unrelated cases not selected |
| Positive regression after correction | The same regression passes inside final full selected files |
| Final focused Node 24 unit/HTTP regression | `test/admin-audit-logs.spec.ts`, `test/admin-slug-blocklist.spec.ts`, `test/public-route-reservations.spec.ts`, `test/invitation-http.spec.ts`: **4 files / 184 tests passed**, exit 0, 25.52 seconds |
| New SQL case | `keys a fetched blocklist snapshot with the same fingerprint as PostgreSQL`; added for coordinator's combined suite, not executed by this lane |
| PostgreSQL built-in availability | Read-only query in disposable `wedding-p5-final-sql-20261126`, PostgreSQL **18.7**, successfully executes `encode(sha256(convert_to('fingerprint-probe','UTF8')),'hex')` |
| API TypeScript | `tsc --noEmit -p backend/api/tsconfig.json` passes |
| Scoped lint/format | Oxlint `--deny-warnings` and Prettier check pass for all three changed source/test files |
| Strict SAST | **7/7 rule suites**, **425 production files**, **zero findings and zero analysis errors** after final SHA-256 correction |
| Static guards | Tenant scope **211 files** passes; public route reservations passes; ID-endpoint guard reports no new ID routes |
| Full combined coverage / real SQL assertions | Coordinator-owned and explicitly pending at this record's creation |

The initial post-fix command included a guessed nonexistent `test/invitation.spec.ts` path; Vitest selected only the other two files and passed 17 tests. The final command uses the actual `test/invitation-http.spec.ts` and supplies the 184-test result above. An intermediate three-file run passed 30 tests. These are separate invocations, not summed into an invented suite total.

## Security Verification

| Control | Named evidence / limits |
|---|---|
| Concurrent edits cannot poison a restored blocklist version's cache | Negative-before/positive-after `cannot cache a concurrent intermediate list under a restored blocklist fingerprint` |
| Exact/substring behavior and false positives remain bounded | Existing `uses only exact matches for reserved words and folds case for substring terms` passes in final focused run |
| Cache misses cannot silently use obsolete list versions | Existing `uses DB fingerprint so stale Redis data cannot approve a newly blocked slug` passes |
| Authoritative database failures fail closed | Existing `does not approve a slug when authoritative DB read fails` passes |
| Wrong-role/mass-assigned writes remain denied | Existing `ordinary user cannot %s platform configuration or reveal its contents` and `rejects client actor/status/owner_id mass assignment before service` pass |
| SQL/JavaScript hash equivalence | New SQL test is written but requires coordinator execution; the independent read-only built-in probe alone is not that assertion |
| Payment / upload / user-input storage / new ownership endpoint | Not applicable; these paths did not change and no new verification claim is made |

The deterministic unit regression models the exact observed statement interleaving with an in-memory cache. It does not claim a stress test of real Redis scheduling or a real infrastructure outage. Existing cache-port failure policy is unchanged; real database integration remains necessary and assigned.

## Abuse Cases Covered

The new case rejects reuse of an intermediate administrative configuration under a restored authoritative fingerprint. Existing cases retained and executed cover wrong roles, forged actor/owner fields, invalid configuration IDs, all-script reasons, exact-match false positives, folded substring evasion, failed authoritative reads and protected public-route fixtures. This fix creates no invitation content mutation, payment writer or endpoint.

## Definition of Done Verification

The bounded correction has a demonstrated failing-before/passing-after regression, focused API tests, types, lint, format, strict SAST and applicable static guards. The new SQL case is ready for the coordinator's complete combined invocation; this record does not claim that invocation has passed. No global threshold or scanner rule was reduced. Endpoint ownership, response shape, new stored input and lifecycle logging requirements are unchanged/not applicable to this source-local correction.

The coordinator owns index/changelog/task closure and final acceptance. P5-13 and Phase 5 are not declared DONE here. No requirement is waived.

## What Did Not Work

The first implementation matched the existing MD5 key format in JavaScript. Inspecting the checked-in SAST rules showed that this would violate the generic weak-digest rule, so both implementations were changed to SHA-256 before final validation; no suppression was added. The negative regression intentionally failed prior source and is retained as meaningful failure evidence. A literal Windows wildcard path was rejected by ripgrep; the subsequent bounded `-g '*.spec.ts'` search located the actual invitation test file.

## Follow-Ups and Open Questions

Coordinator must run the complete combined API SQL/unit coverage suite after this final source settles, including the new fingerprint-compatibility SQL assertion. No new product or contract question exists. Existing P5-14 global acceptance/review follow-ups remain under the coordinator's board/backlog discipline.

## What to Watch

Mixed old/new application instances during rollout may temporarily populate separate MD5/SHA-256 namespaces; the corrected instance trusts only SHA-256 keys. The old code's race is corrected only where this version runs, so deploy consistently when release is authorized. Watch authoritative fingerprint query/cache latency and validation failures; TTL remains 60 seconds and no secrets or personal content enter the key.
