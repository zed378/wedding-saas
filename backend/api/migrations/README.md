# Migrations

Schema changes are versioned files that run as a deliberate step. Nothing here runs on service startup, and nothing here runs as the application's database role.

## Commands

All from the repository root.

```bash
pnpm --filter @wi/api db:generate    # diff the schema, emit SQL to review
pnpm --filter @wi/api db:migrate     # apply pending migrations
pnpm --filter @wi/api db:rollback    # reverse the most recent one (development)
pnpm --filter @wi/api db:seed        # development data only, never production
```

`db:generate` writes SQL for you to read before it ever touches a database. `drizzle-kit push` is deliberately never used: it diffs and applies against a live database in one step with no file to review, which is the "manual schema change in production" `docs/ARCHITECTURE/04` forbids.

## Two roles, and why

| Variable                 | Role            | Can                            |
| ------------------------ | --------------- | ------------------------------ |
| `MIGRATION_DATABASE_URL` | `wedding_owner` | create and alter tables        |
| `DATABASE_URL`           | `wedding_app`   | select, insert, update, delete |

The application role does not own its tables and holds neither `SUPERUSER` nor `BYPASSRLS`. That is a precondition for row-level security: an owner or superuser connection silently bypasses every policy, and no test fails when it does. Verified — `CREATE TABLE` as `wedding_app` returns `permission denied for schema public`.

Migrations therefore need their own URL. Giving the API the owner URL would hand every request the privileges of a migration.

## Migrations never run on startup

`src/main.ts` does not call the migrator and nothing in the application imports it. During a rolling deploy every replica would race to alter the schema, and a failed migration would become an outage instead of a stopped pipeline.

## The baseline

`0000_baseline.sql` creates no tables. It has one job: `set_updated_at()`.

Almost every table in `docs/DATABASE/` carries `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. A default fires only on `INSERT`, so without a trigger the column records creation time forever and quietly lies on every row that has ever been edited. It lives in the database rather than the service layer because the guarantee has to survive writes that bypass the service: a backfill, a hand-run data fix during an incident, an admin correction.

Attach it in the migration that creates each table:

```sql
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
```

The `WHEN` clause matters. Without it, an `UPDATE` that changes nothing still bumps the timestamp, and `updated_at` stops meaning "when this row last changed". Both directions are verified: a real change bumps it, a genuine no-op leaves it untouched.

**There is no `CREATE EXTENSION`.** The task card expected `pgcrypto` for `gen_random_uuid()`, which was right for PostgreSQL 12 and earlier. Since 13 the function is in core. Verified on the actual image: `gen_random_uuid()` works on `postgres:18-alpine` with `pg_extension` holding nothing but `plpgsql`. Skipping it is better than merely equivalent — `CREATE EXTENSION` needs superuser, and this project works to keep the roles touching the database as unprivileged as the job allows.

## Expand-contract

`docs/DEVOPS/08-ROLLBACK.md`. A destructive change must never ship in the same deploy as the code that stops using it, because then a **code** rollback lands on a schema that no longer has the column it reads.

| Phase            | What happens                                                                          | Ships in           |
| ---------------- | ------------------------------------------------------------------------------------- | ------------------ |
| **1 — Expand**   | Add the new column or table. The deployed code reads and writes **both** old and new. | Migration + deploy |
| **2 — Backfill** | Copy data across, as a background job for anything large enough to lock.              | Job                |
| **3 — Switch**   | Deploy code that uses only the new schema. The old column still exists, untouched.    | Deploy only        |
| **4 — Contract** | Days later, once confident, drop the old column in its own migration.                 | Migration          |

The gap between 3 and 4 is the whole point: while the old column is still there, rolling the code back is safe. Collapsing 1 and 4 into one migration is what turns a bad deploy into data loss.

### The gate

A migration containing `DROP TABLE`, `DROP COLUMN`, `DROP SCHEMA` or `TRUNCATE` fails the local checks unless the file carries a justification:

```sql
-- CONTRACT-PHASE: nickname unused since v1.2 (deployed 21 days ago),
-- confirmed zero reads in the query logs over 14 days.
ALTER TABLE users DROP COLUMN nickname;
```

The comment is the point. It forces the author to state which phase this is and what confirmed the column is unused, while they still know. The dangerous drop is not the considered one — it is the `DROP COLUMN` that `drizzle-kit generate` emitted because a field was renamed in the schema file, which reads as routine in a diff.

Comments are stripped before matching, so the word `DROP TABLE` inside a comment does not trip it.

## Every migration needs a down file

Drizzle does not generate them (ADR-030), so write `<tag>.down.sql` by hand next to each migration. `scripts/check-migration-pairs.mjs` fails if one is missing, and also if a `.down.sql` is left behind after its migration is deleted.

**`db:rollback` is a development tool, not the production recovery mechanism.** `docs/DEVOPS/08` never treats down migrations as one: its database story is expand-contract, where safety comes from the old schema still being there. Reversing a schema change over live data is lossy by nature — dropping a column drops everything written to it since the deploy, and no `.down.sql` gives that back. Production recovery is expand-contract, roll-forward, and point-in-time restore.

What `db:rollback` is genuinely good for is the local loop: apply, find it wrong, undo, edit, apply again, without recreating the container.

When a change truly cannot be reversed, the file still has to exist and say so:

```sql
-- Not reversible: the up migration merges two columns and discards the originals.
DO $$ BEGIN
  RAISE EXCEPTION 'Not reversible. Restore from PITR (docs/ARCHITECTURE/09).';
END $$;
```

An absent file and a deliberate refusal look identical from the outside. Only one of them is a decision.

## How rollback bookkeeping works

Drizzle records applied migrations in `drizzle.__drizzle_migrations` as `(id, hash, created_at)`, where `created_at` is the `when` field of the matching entry in `meta/_journal.json`. `db:rollback` maps that timestamp back to the journal entry, finds the tag, runs `<tag>.down.sql` and deletes the row — in **one transaction**, so a half-failure cannot leave the table claiming a migration is applied when its objects are gone.

This couples us to Drizzle's internal table. The coupling is deliberate and narrow: the alternative was a second source of truth about which migrations have run, which is worse. `test/db-migrations.spec.ts` pins the assumption, so a Drizzle upgrade that changes the shape fails a test instead of corrupting the record.

If `db:rollback` reports that the applied migration has no journal entry, the database has run a migration this checkout does not contain. Check out the branch that produced it — guessing which file to reverse would run the wrong SQL against a schema it was not written for.

## Verifying a round trip

```bash
docker compose -f deploy/docker-compose.yml up -d postgres
scripts/db-roundtrip.sh
```

Applies every migration from empty, rolls back to empty, and applies them again, asserting the database state at each step. Run it after writing a migration — an up that works and a down that does not is the normal way this breaks.
