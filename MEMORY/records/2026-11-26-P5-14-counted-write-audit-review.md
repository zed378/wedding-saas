# P5-12–14 — Complete actor-session audit reconciliation

| | |
|---|---|
| Date | 2026-11-26 |
| Tasks / phase | P5-12, P5-13 review; P5-14 acceptance; Phase 5 |
| Surface / author | Backend tests; parallel audit/blocklist agent |
| Commits / PR | Shared uncommitted continuation; no commit or deployment |
| Status | Focused review complete; integration execution coordinated by parent |

## What Changed

The administrative write acceptance test now reconciles every audit row emitted for its actor, rather than selecting only expected action names. It compares the exact action/resource-type/resource-ID multiset for nine successful writes and checks meaningful before/after states for suspension, unsuspension, approval, rejection, refund and blocklist renaming.

## Why

P5-14 requires audit completeness by action-count comparison. An action-name SQL filter can hide an unexpected or mislabelled extra audit row and still pass. DATABASE/10 requires the correct actor, resource and state snapshots, so merely counting action names and nonempty snapshots leaves important attribution defects undetected.

The existing support session covers suspension/unsuspension, guestbook approve/reject/delete, refund, and blocklist create/update/delete. The separate `admin-phase5-template-flow.itest.ts` covers eight template writes across all seven template mutation handlers. Together these cover mounted administrative mutation categories; candidate-slug testing is a read operation. Audited bulk export has its independent `admin-audit-logs.itest.ts` case.

## How

Remove the expected-actions predicate from the actor-specific database query, select resource metadata, and compare the complete result against the scripted operations. Snapshot assertions prove the two identical `guestbook.moderate` action labels describe different actual transitions. No production behavior, schema or endpoint changed.

Mandatory task/memory/specification and security reading was completed using bounded file reads because graph tools were unavailable. Existing uncommitted work was preserved.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/test/integration/admin-phase5-write-audit.itest.ts` | Complete actor reconciliation and state-transition assertions |
| `MEMORY/records/2026-11-26-P5-14-counted-write-audit-review.md` | This evidence and limits |

## Decisions Made

No architectural or product decision. Strengthen the existing SQL integration test instead of adding a duplicate test harness. No ADR required.

## Deviations from docs/

None. No business rule, API contract or documented schema changed.

## Tests Added and Executed

| Layer | Evidence |
|---|---|
| Unit / HTTP regression | `admin-audit-logs.spec.ts`, `admin-slug-blocklist.spec.ts`, `public-route-reservations.spec.ts`: 3 files / 27 tests passed, 43.34 seconds |
| Types | API `tsc --noEmit -p backend/api/tsconfig.json` passed after final snapshot assertions |
| Formatting | Prettier check on the changed integration file passed |
| SQL integration | Stronger existing write-count case prepared; parent coordinates serialized execution against the dedicated test database to prevent destructive reset races |
| Browser / E2E | Not run by this lane; parent owns browser acceptance |

## Security Verification

The focused regression suite passed `ordinary user cannot %s platform configuration or reveal its contents`, `rejects client actor/status/owner_id mass assignment before service`, `sanitizes script reason before service and normalizes uppercase term`, `rejects anonymous and regular user reads at %s`, and `returns no export if writing its audit trail fails`. These are HTTP/unit evidence; they do not independently establish real database atomicity or MFA provenance.

The modified SQL case `persists exactly one reasoned before/after audit per successful write and invalidates public effects` exercises real persisted support/moderation/refund/blocklist changes. Its execution result must be reported by the parent before being counted as passed. No owner endpoint, payment webhook, uploaded file, stored-input or authorization implementation was changed; payment signature verification and upload validation are not applicable to this test-only edit.

## Abuse Cases Covered

The stronger reconciliation detects missing, duplicate or incorrectly attributed administrative audit rows, including an unexpected action that the former SQL filter could hide. State assertions detect approval/rejection audits with swapped or stale sequential state. Existing named focused tests above cover ordinary-user access, mass assignment, sanitized-away text and export-audit failure. Concurrent moderation races are not tested by this sequential session.

## Definition of Done Verification

Appropriate integration-layer assertions added; focused HTTP/unit regressions and formatting passed. No new ID endpoint, accepted input field, response envelope, logging implementation, storage path or production state transition exists. Repository-wide verification, final SQL result, shared task/index/changelog updates and rendered acceptance remain parent-coordinated. P5-12/P5-13 are not declared DONE here; P5-14 phase completion and its summary remain pending. No DoD item waived.

## What Did Not Work

A Windows wildcard supplied as a literal ripgrep path failed; glob filtering with `-g` succeeded. No test assertions were weakened. Existing SQL tests are deliberately not run concurrently because their common harness resets tenant data.

## Follow-Ups and Open Questions

Parent owns final SQL execution and phase acceptance status. Review observed that moderation reads its existing state before opening the mutation transaction; concurrent moderators could therefore record stale before-state. This predates the current test-only change, is outside this lane's file ownership, and was reported to the parent for explicit follow-up. The sequential test does not certify concurrency safety.

## What to Watch

No production runtime change. Future administrative handlers should enter the counted mutation inventory, and intentionally added read-audit events must be reconciled explicitly rather than hidden by action filters.
# Final SQL verification

Parent's serialized PostgreSQL/Redis run passed all nine auth/admin files, 82 cases. After the final moderation row-lock correction, parent reran `admin-phase5-write-audit.itest.ts` with `admin-moderation-audit.itest.ts`: 2 files / 4 tests passed. The strengthened full-actor count/resource assertions and before/after assertions executed successfully; browser acceptance remains outstanding.
