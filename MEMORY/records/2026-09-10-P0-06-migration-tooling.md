# P0-06 — Migration tooling, the baseline, and PostgreSQL 18

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-06 |
| **Phase** | Phase 0 |
| **Surface** | backend, infra |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-06-migration-tooling` |
| **Status** | Completed |

---

## What Changed

Schema changes are now versioned files applied by a separate command, as the owner role, never on startup. `0000_baseline.sql` creates one thing: the `set_updated_at()` trigger function. Down migrations exist, are written by hand, and are checked for. Two gates block a push, and `scripts/db-roundtrip.sh` proves up/down/up against a real database.

The project also moved from PostgreSQL 16 to 18 at the owner's request, which turned out to carry a non-obvious change to the compose volume mount.

## Why

`P0-06` is the last thing between the project and its schema: `P0-07` through `P0-10` write twenty-odd tables on top of this, and every mistake here is one that gets multiplied by four tasks and then lived with.

## How

**Two roles, two URLs.** `MIGRATION_DATABASE_URL` connects as `wedding_owner` and can alter schema; `DATABASE_URL` connects as `wedding_app` and cannot. `P0-05` created that split and this is the task that would have quietly thrown it away — the easy thing is one URL that works for everything. It matters before row-level policies exist rather than after: an owner or superuser connection bypasses every policy silently, and no test fails when it does. Verified from the other side, which is the direction that actually proves it: `CREATE TABLE` as `wedding_app` returns `permission denied for schema public`.

The migration commands validate their own environment (`src/infra/db/env.mts`) rather than reusing the API's startup schema. A migration in a release pipeline has no business needing a CORS allowlist to be present before it can add a column.

**Migrations never run on startup.** `src/main.ts` does not call the migrator and nothing in the application imports it. During a rolling deploy every replica would race to alter the schema, and a failed migration would become an outage instead of a stopped pipeline.

**`drizzle-kit push` is not used and will not be.** It diffs and applies against a live database in one step with no file to review, which is exactly the "manual schema change in production" `docs/ARCHITECTURE/04` forbids. `db:generate` writes SQL to read first.

**The baseline creates no tables.** Just `set_updated_at()`. Almost every table in `docs/DATABASE/` carries `updated_at ... DEFAULT NOW()`, and a default fires only on `INSERT` — without a trigger the column records creation time forever and quietly lies on every row that has ever been edited. It is in the database rather than the service layer because the guarantee must survive writes that bypass the service: a backfill, a hand-run fix during an incident, an admin correction.

The `WHEN (OLD.* IS DISTINCT FROM NEW.*)` clause on the trigger is the detail worth keeping. Without it an `UPDATE` that changes nothing still bumps the timestamp, and `updated_at` stops meaning what it says.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/drizzle.config.ts` | drizzle-kit config; read by the CLI only |
| `backend/api/migrations/0000_baseline.sql` | `set_updated_at()`; no extensions, deliberately |
| `backend/api/migrations/0000_baseline.down.sql` | Reverses it |
| `backend/api/migrations/README.md` | Commands, the two roles, expand-contract in four phases, the down-file rule |
| `backend/api/src/infra/db/env.mts` | Migration environment contract, exits 78 |
| `backend/api/src/infra/db/paths.mts` | Migrations folder, asserted to exist |
| `backend/api/src/infra/db/migrate.mts` | Apply pending migrations |
| `backend/api/src/infra/db/rollback.mts` | Reverse the most recent one |
| `backend/api/src/infra/db/seed.mts` | Development data, with two guards |
| `backend/api/src/infra/db/schema/index.ts` | Empty barrel; `P0-07`..`P0-10` fill it |
| `backend/api/src/config/env.schema.ts` | `DATABASE_URL` now required |
| `backend/api/tsconfig.json` | `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` |
| `backend/api/test/db-migrations.spec.ts` | 6 tests pinning the file and bookkeeping assumptions |
| `backend/api/test/{config.spec.ts,env.setup.ts}` | Fixtures gain `DATABASE_URL` |
| `scripts/check-destructive-migration.mjs` | Expand-contract gate |
| `scripts/check-migration-pairs.mjs` | Every migration has a down file |
| `scripts/db-roundtrip.sh` | up → down → up, 9 assertions |
| `scripts/verify.sh`, `.githooks/pre-push` | Both gates wired in |
| `deploy/docker-compose.yml` | `postgres:18-alpine`, volume mount moved, `DATABASE_URL` set |
| `.env.example` | Both URLs, with the reason for the split |
| `CLAUDE.md`, `AGENTS.md` | PostgreSQL 18; db commands |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| PostgreSQL 18 | Owner's request, taken at the cheapest possible moment | ADR-029 |
| Compose volume moved to `/var/lib/postgresql` | PG18 moved `PGDATA`; the old mount fails silently | ADR-029 |
| Hand-written down migrations, Drizzle's own bookkeeping table | Drizzle generates none; a second state table could disagree with the first | ADR-030 |
| `db:rollback` is a development tool, not production recovery | Reversing schema over live data is lossy; `docs/DEVOPS/08` relies on expand-contract | ADR-030 |
| No `CREATE EXTENSION` | `gen_random_uuid()` is core since PG13; `CREATE EXTENSION` needs superuser | — |
| `.mts` for the db CLI scripts | Unambiguous ESM; `.ts` made Node reparse with a warning | — |
| Migration env validated separately from the API's | A migration should not need a CORS allowlist to add a column | — |

## Deviations from `docs/`

**No `CREATE EXTENSION pgcrypto`**, which step 2 of the task card expected. Correct for PostgreSQL 12 and earlier; the function has been core since 13. Verified on the running image rather than from memory.

**Two DoD items say "in CI"**, and there is no CI — `P0-17` is deferred (ADR-028). Both moved to local gates. Weaker, and named as weaker on the task card rather than ticked off as if equivalent.

`docs/DEVOPS/02-CONTAINERIZATION.md` still shows `postgres:16-alpine`, left unamended under ADR-027.

## Tests Added

`backend/api/test/db-migrations.spec.ts` — 6 tests, no database required:

| Test | What it protects |
|---|---|
| Every journal migration has a down file | Drizzle generates none; the gap only surfaces at rollback time |
| No orphaned down file | The reverse mistake — migration deleted, its down left behind |
| Baseline creates `set_updated_at`, down removes it | The pair actually matches |
| Baseline creates no extension | Keeps the superuser-free property from drifting back |
| Journal entry shape | `rollback.mts` maps `created_at` → `String(when)`; pins that it survives the trip |
| Drizzle still writes the table we read | Reads the DDL out of the installed package, so an upgrade fails here |

24 tests pass across the API package.

The round trip needs a live database and so is a script, not a test — `P0-19` brings Testcontainers and it should move then.

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| Application role cannot alter schema | `docs/SECURITY/05` (precondition for RLS) | `CREATE TABLE` as `wedding_app` → `permission denied for schema public`. Asserted in `db-roundtrip.sh` |
| Migrations cannot run from the API | `docs/ARCHITECTURE/04` | Nothing in `src/` imports the migrator; the API's `DATABASE_URL` is the unprivileged role |
| Destructive schema change cannot ship unnoticed | `docs/DEVOPS/08` expand-contract | Gate blocks unjustified `DROP`; four cases exercised including a false-positive case |
| Seeds cannot reach production | `P0-06` DoD | `NODE_ENV=production` refused; non-local URL refused. Both triggered |
| No superuser-only step in the migration path | least privilege | No `CREATE EXTENSION`; pinned by a test |

## Definition of Done Verification

- [x] Migrations run as their own command, never on startup
- [x] up/down/up round trip passes against a fresh database — 9 assertions, real PG18 container
- [x] A destructive migration without justification fails — blocking, 4 cases exercised
- [x] Seed and migration are separate commands, production refused

## What Did Not Work

**The PostgreSQL 18 volume trap.** The official PG18 image moved `PGDATA` from `/var/lib/postgresql/data` to `/var/lib/postgresql/18/docker`, and moved its declared `VOLUME` to `/var/lib/postgresql`. Our compose file mounted the old path.

The reason this is worth a paragraph is that it does not error. The named volume mounts and stays empty, the real data goes to an anonymous volume Docker creates for the declared path, and the stack works perfectly — until the first `docker compose down`, when the database comes back empty with the named volume still sitting there looking correct. The natural conclusion is "the volume is broken", which is the wrong place to look.

Caught by checking `docker image inspect` on both tags before switching, rather than after. Verified the fix by writing a row, running `down`, running `up`, and reading it back.

**`.ts` for the CLI scripts made Node reparse them.** The package is CommonJS (NestJS), so a `.ts` file containing `import` statements triggers `MODULE_TYPELESS_PACKAGE_JSON` and a reparse-as-ESM warning on every run. Renaming to `.mts` makes it unambiguous — but then TypeScript rejected the `./env.mts` specifiers, because Node needs the real extension while `tsc` wants to rewrite it. `allowImportingTsExtensions` plus `rewriteRelativeImportExtensions` resolves both: `dist/` comes out importing `./env.mjs`. Verified the compiled output runs, not just that it compiles.

**Making `DATABASE_URL` required broke three existing tests**, which is the schema working. Fixed the fixtures, not the constraint.

**Two of my own test-resolution attempts were wrong.** `drizzle-orm`'s `exports` map exposes neither `pg-core/dialect.js` nor `package.json`, so both attempts to locate the internal file failed. Resolving the public `drizzle-orm/pg-core` entry and walking sideways works.

**A vacuous assertion, caught on re-reading.** The first trigger test compared a single row's `updated_at` to `max(updated_at)` over the same single row — true regardless of whether the trigger fired. Replaced with a captured baseline, then tested both directions: a no-op `UPDATE` leaves the timestamp alone, a real change bumps it.

**Port 5432 was already taken** on this machine, exactly the collision `P0-05` parameterised host ports for. `POSTGRES_PORT=55432` was all it took, which is the parameterisation paying for itself.

**esbuild's install script.** pnpm blocks build scripts by default and left a placeholder in `pnpm-workspace.yaml` demanding a decision. Denied it, then verified drizzle-kit still works by running a command that actually needs esbuild — reading the TypeScript config — rather than by `--version`, which would have proved nothing.

## Follow-Ups and Open Questions

- **The round trip should become a test when `P0-19` brings Testcontainers.** As a script it only runs when someone runs it.
- **`db:rollback` reverses exactly one migration per invocation.** Fine at one migration; `db-roundtrip.sh` loops. If a chain ever needs unwinding by hand this will feel clumsy, and a `--to <tag>` argument is the obvious answer.
- **Nothing connects to the database from the application yet.** `DATABASE_URL` is required and validated but unused until `P0-11` builds the tenant-scoped repository layer. A pool that is configured and never opened is not proof the credentials work.
- **`docs/DEVOPS/02` shows `postgres:16-alpine`.** Left unamended under ADR-027; two divergences now sit in that file.

## What to Watch

**The first real migration is where the expand-contract gate gets tested for real.** `P0-07` through `P0-10` are all additive, so the destructive check will pass without anyone thinking about it. The first time it fires will be a rename in the schema file that `drizzle-kit generate` turns into `DROP COLUMN` + `ADD COLUMN` — which is data loss written as routine SQL. That is the case the gate exists for, and the temptation will be to add the `CONTRACT-PHASE:` marker to make it quiet.

**Down migrations rot faster than up migrations** because nothing runs them. `check-migration-pairs.mjs` proves a file exists; it cannot prove the file is correct. `scripts/db-roundtrip.sh` is what actually proves it, and it only runs when invoked — so a down migration that no longer matches its up will sit undetected until someone needs it.

**The Drizzle bookkeeping coupling.** `rollback.mts` reads `drizzle.__drizzle_migrations` directly. A Drizzle upgrade that renames that table or changes its columns fails `db-migrations.spec.ts` — provided the test is still there. If someone deletes that test as "testing the library", the coupling goes silent and the next rollback reverses the wrong file.
