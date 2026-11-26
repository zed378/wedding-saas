# P5-09 — Serialize moderation snapshots with audited mutations

| | |
|---|---|
| Date | 2026-11-26 |
| Task | TASKS/PHASE-5-ADMIN-PANEL.md § P5-09; discovered in P5-14 acceptance review |
| Phase / surface | Phase 5 / backend |
| Author | Coding agent |
| Commits / PR | Shared uncommitted continuation |
| Status | Fix implemented; focused HTTP/types passed; new SQL regression awaits parent verification |

## What Changed

Approval/rejection and deletion now read and lock the guestbook entry inside the same database transaction as their mutation and audit insertion. Concurrent decisions therefore record the state actually replaced, and a second concurrent delete returns 404 instead of writing an audit for a deletion that affected no row.

## Why

P5-09, PLAN/05 Admin Guestbook Moderation, PLAN/12 Mandatory Audit Trail and API/09 require an audit of each moderation decision. Existing code read the previous state outside its transaction: two concurrent decisions could both log `pending` as their previous state, and two concurrent deletes could both claim success. SECURITY/05 requires deliberate administrative access paths to remain auditable. Mandatory project overview, roadmap, security docs and earlier task records were read during this continuation.

## How

Both methods use `SELECT … FOR UPDATE OF invitation_guestbook` after entering the transaction. Locking only the guestbook table avoids PostgreSQL's restriction on locking the nullable side of the invitation left join. Missing entries throw before any mutation/audit. Existing cache/queue invalidation remains after the successful commit.

## Files and Components Touched

| Path | Change |
|---|---|
| backend/api/src/modules/admin/admin-moderation.service.ts | Transactional row-lock snapshot for both actions; remove unused sql import |
| backend/api/test/integration/admin-moderation-audit.itest.ts | Deterministic concurrent decision/deletion regressions |
| MEMORY/records/2026-11-26-P5-09-concurrent-moderation-audit.md | This evidence |

## Decisions Made

No new product or architectural decision. Row locking implements the existing atomic audit requirement and preserves the documented 404 for a missing resource. No new dependency or migration.

## Deviations from docs/

None. Graph tools and referenced anti-slop skills were unavailable; bounded source reads were used. Existing shared uncommitted changes were preserved.

## Tests Added and Run

| Layer | Evidence |
|---|---|
| SQL regression added | `records the actual preceding status for two concurrent moderation decisions`; `records only one successful deletion when two admins delete the same entry concurrently` |
| SQL execution | Not run by this lane because parent already owns serialized SQL verification; no SQL pass is claimed here |
| Existing HTTP | `admin-moderation.spec.ts`: 18/18 passed with threads, maxWorkers=1 and hookTimeout=30000 |
| Typecheck | API `tsc --noEmit -p tsconfig.json` passed |
| Formatting | Prettier completed for both changed source/test files |
| Full regression / E2E | Parent owns coordinated acceptance |

The new tests hold a row lock from an independent connection, start both competing service calls, and observe both waiting on database locks before releasing it. This forces the stale-read interleaving in the previous implementation. Decision assertions reconstruct the two-step audit chain and compare its final state to the row; delete assertions require one success, one 404 and exactly one audit. The helper drains pending calls before subsequent table truncation, even if synchronization fails.

## Security Verification

| Control | Named evidence |
|---|---|
| Correct concurrent before/after snapshots | New SQL tests named above; execution pending, not yet verified |
| Atomic mutation/audit | Same transaction in source; new SQL acceptance pending |
| Role and reason boundary | Existing `admin-moderation.spec.ts` HTTP suite passed; the suite mocks the service and does not prove database concurrency |
| Owner authorization | No owner route changed; admin-only deliberate platform moderation path retained |
| Payment state / uploads / free text | No payment/upload path changed; existing action schema validation and sanitization retained |

## Abuse Cases Covered

Two simultaneous decisions must not conceal one another's actual previous state. Two deletes must not inflate audit action counts. The added real-database tests assert these cases; they remain pending coordinated execution. Existing HTTP suite retains malformed-ID, ordinary-user/anonymous denial and invalid/missing reason checks.

## Definition of Done Verification

The fix, relevant SQL regressions, passing focused HTTP/types and this record exist. No new endpoint, accepted payload field, status transition kind or schema was added. Existing audit transaction and post-commit invalidation behavior are preserved. Parent must run the new SQL tests and global regression, update shared index/boards, and determine task/phase acceptance. No requirement is waived and pending SQL proof is explicit.

## What Did Not Work

No failed implementation attempt. The pre-existing service lacked a real concurrency test; HTTP service mocks cannot reveal this race. The referenced anti-slop skill paths do not exist, so no skill approval or invented workflow was introduced.

## Follow-Ups and Open Questions

Parent owns serialized SQL run and acceptance. No new product question. No Phase 6 feature was started.

## What to Watch

Competing moderation actions now wait on one entry's row lock. Watch transaction duration and deadlock/lock-wait telemetry under administrative contention; cache invalidation still occurs after commit and remains subject to its existing retry path.
# Final SQL verification

Parent's serialized PostgreSQL run on 2026-11-26 passed `admin-moderation-audit.itest.ts` and `admin-phase5-write-audit.itest.ts`: 2 files / 4 tests. This includes both contended decisions and contended deletions under a deliberately held row lock. Final API production TypeScript build also passed. This evidence completes the bounded concurrency correction, not Phase 5 browser acceptance.
