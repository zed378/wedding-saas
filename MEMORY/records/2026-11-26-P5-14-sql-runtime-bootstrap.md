# P5-14 — Node 24 SQL acceptance and disposable role bootstrap

| | |
|---|---|
| Date | 2026-11-26 |
| Task / phase | P5-14 acceptance continuation; Phase 5 |
| Surface / author | API integration harness and tests; parallel SQL acceptance lane |
| Commits / PR | Shared uncommitted working tree; no commit, merge or deployment |
| Status | Harness and fixture corrections verified; overall phase acceptance remains parent-owned |

## What Changed

Disposable PostgreSQL testcontainers now receive the application-role defaults from the Compose bootstrap before migrations run. A new real-container regression checks ordinary access and the restrictions applied by later migrations. Two stale integration expectations were corrected: settings include the existing profanity-filter flag, and RSVP count tests remove only their own invitation's default fixture RSVP.

## Why

The owner requested parallel implementation. P5-14 requires real integration acceptance, rather than relying on the earlier bounded admin SQL run. `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` requires meaningful positive and negative authorization controls; a database that rejects every application query cannot prove the application works. `deploy/postgres/init/01-app-role.sh` defines the role bootstrap on which migrations' permission revocations depend.

## How

Graph tools were unavailable, so investigation used bounded reads and searches after checking exposed tool metadata. The initial dedicated database could authenticate its application role but lacked ordinary grants. PostgreSQL logs identified `permission denied for table invitations`; the harness had created a role without the default grants used by Compose. The correction is limited to harness-owned fresh containers. Externally supplied databases and their role passwords remain untouched.

The harness grants schema usage, database connection, default table DML and sequence access before applying migrations. This order preserves the later revocations for audit logs, invoices, payment notifications and region data. It does not apply broad grants after migrations.

Full SQL verification used a separate PostgreSQL 18 container, `wedding-p5-full-sql-20261126`, and the existing dedicated integration Redis on port 55501. The parent used a different E2E database and Redis. A temporary Node 24.22.3 executable was obtained through `pnpm --package=node@24 dlx node`; the machine-wide Node 26 installation was not replaced. Vitest ran with threads, one worker and file parallelism disabled.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/test/support/harness.ts` | Compose-equivalent role/default privilege bootstrap for fresh testcontainers only |
| `backend/api/test/integration/harness.itest.ts` | Disposable-container role and migration-restriction regression |
| `backend/api/test/integration/settings.itest.ts` | Expect existing `profanity_filter_enabled` field and its false default, per ADR-089 |
| `backend/api/test/integration/owner-rsvp.itest.ts` | Remove Alice's seeded fixture RSVP before creating counted test data; keep other invitations' rows |
| This record | Evidence, failed attempts and limits |

Ignored `tmp/` runner/log files are verification artifacts, not production implementation. The formatting lane also changed quote style in three pre-existing CSV assertions in the RSVP file; this lane did not change their meaning.

## Decisions Made

Mirror the existing Compose bootstrap rather than invent another test-role privilege model. Keep all later migration restrictions. Retain unrelated invitations' RSVP rows so a missing invitation filter still breaks count assertions. These are test-environment and fixture corrections within existing specifications; no architectural decision or ADR was needed.

## Deviations from docs/

None. The production runtime and database bootstrap are unchanged. No Phase 6 implementation was started.

## Tests Added and Run

| Layer / check | Exact result |
|---|---|
| New harness regression on Node 24 | Initial focused `harness.itest.ts` run: 1 file, 17 tests passed |
| Full API SQL suite on Node 24, PostgreSQL 18 and real Redis | 59 files: 58 passed, 1 failed; 1,167 tests passed and 3 failed of 1,170; 585.28 seconds |
| Full-run failures | Only the RSVP pagination, attendance filter and summary count assertions; shared fixture contributed one extra attending guest |
| Final focused SQL after all corrections | `owner-rsvp.itest.ts`, `settings.itest.ts`, `harness.itest.ts`: 3 files, 73 tests passed, 28.69 seconds |
| API typecheck after final edits | Passed |
| Scoped formatting | Four touched TypeScript files passed Prettier checks |
| Unit / browser / production build | Not repeated by this lane; parent owns the broader checks |

The complete 59-file invocation exited 1 before the RSVP fixture correction. The final 73-test run covers every modified integration file and all three earlier failures. No single all-green 59-file invocation is claimed. The full run and focused correction are separate evidence. Logs: `tmp/sql-acceptance-full-20261126.log` and `tmp/sql-acceptance-focused-20261126.log`.

## Security Verification

| Control | Named evidence |
|---|---|
| Fresh application role can perform ordinary work | `bootstraps disposable application privileges before migration restrictions`: application-role connection and SELECT succeed; INSERT, UPDATE and DELETE privileges on users are each checked |
| Audit remains append-only | Same named disposable-container test: INSERT permitted; UPDATE and DELETE denied by effective privileges |
| Issued invoices remain immutable | Same named test: UPDATE and DELETE denied |
| Payment notification payload cannot be rewritten | Same named test: processing-result update allowed; raw-payload update and notification deletion denied |
| Region data remains read-only | Same named test: SELECT permitted; INSERT, UPDATE and DELETE denied |
| No privileged application role | Same named test: superuser, create-database, create-role and bypass-RLS flags all false |
| RSVP tenant isolation remains meaningful | Final focused tests `returns 404 for a non-owner attempting to list RSVPs`, `returns 404 for a non-owner attempting to view summary`, and `computes accurate SQL aggregated numbers` passed; other invitations' RSVP rows remain in fixtures |
| Payment status source, uploads, sanitization | No production behavior changed in these areas. This lane's role bootstrap checks do not certify live-provider processing, upload scanning or public XSS protection |

## Abuse Cases Covered

The new named regression catches a fresh database that denies ordinary app access, a bootstrap that accidentally grants later-prohibited audit/invoice writes, a role that can rewrite raw payment evidence, writable region reference data, and an elevated application role. RSVP list/summary tests still include other invitations' data to expose a missing invitation filter. No new endpoint or accepted request field was introduced.

## Definition of Done Verification

The scoped corrections have real PostgreSQL regression coverage, final focused reruns, typechecking and formatting evidence. New endpoint IDOR checks, request-field whitelisting, stored-text sanitization, response-envelope changes and production lifecycle logging additions are not applicable because no endpoint, input contract, stored content or lifecycle behavior changed. No production credentials or payment payloads were added to logs. Test credentials are local defaults.

The global CI/lint/SAST and overall phase gates are not certified by this lane. Parent owns board, phase card, index and changelog updates alongside this record. No requirement was waived, no phase-summary completion is inferred, and the complete full-run failure result is preserved above.

## What Did Not Work

PowerShell's `pnpm.ps1` execution policy required invoking `pnpm.cmd`. An initial command forwarded a literal extra `--` before Vitest arguments and was stopped; it is not test evidence. Early schema probes ran before migrations and failed with missing-table messages, so those skipped tests are not counted as passes. A first dedicated-container attempt created the role but missed Compose's default privileges; PostgreSQL logs revealed the mistake. That incomplete Node 26 run was stopped and replaced with properly bootstrapped Node 24 verification.

The Node 24 full run exposed three RSVP count mismatches. The cause was the shared Phase 1 tenant fixture's RSVP, not SQL count behavior. Only that invitation's seeded row is removed; increasing expected totals would have hidden accidental fixture coupling. The settings key assertion likewise lagged the existing ADR-089 implementation. No failing test was deleted or skipped to produce the focused pass.

## Follow-Ups and Open Questions

No new product or architecture question. Parent must retain the distinction between the failed full invocation and passing final focused run when updating P5-14. Existing global gate and phase-acceptance follow-ups remain on the board/backlog. The new container test requires working Docker; external-database integration runs alone no longer avoid Docker for this regression.

## What to Watch

Keep fresh test-role defaults aligned with `deploy/postgres/init/01-app-role.sh`, and grant them before migrations so sensitive-table revocations remain effective. If later migrations add restricted tables, extend the named regression. Shared fixture expansion can change count-based integration tests; keep counted data explicit while retaining other tenants as negative controls.
