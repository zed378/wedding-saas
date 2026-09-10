/**
 * Roll back the most recently applied migration. `pnpm --filter @wi/api db:rollback`.
 *
 * READ THIS BEFORE REACHING FOR IT IN PRODUCTION.
 *
 * This is a development and pre-production tool. It is not the production recovery
 * mechanism, and docs/DEVOPS/08-ROLLBACK.md does not treat it as one: the database
 * story there is expand-contract, where a *code* rollback stays safe precisely
 * because the old schema has not been dropped yet. Rolling a schema change backwards
 * over live data is lossy by nature -- dropping a column drops what was written to it
 * since the deploy, and no `.down.sql` can give that back.
 *
 * What it is good for is the loop this repository actually needs: apply a migration,
 * find it wrong, undo it, edit it, apply it again, without recreating the container
 * and losing the rest of the local database.
 *
 * Drizzle has no down migrations, so the bookkeeping below is ours (ADR-030):
 *   - Drizzle records applied migrations in drizzle.__drizzle_migrations as
 *     (id, hash, created_at), where created_at is the `when` field of the matching
 *     entry in migrations/meta/_journal.json.
 *   - We map that timestamp back to the journal entry to find the tag, then run
 *     migrations/<tag>.down.sql and delete the row, in one transaction.
 *
 * That couples us to Drizzle's internal table. The coupling is deliberate and
 * narrow -- one table, three columns -- and the alternative was a second source of
 * truth about which migrations are applied, which is worse. It is pinned by
 * test/db-rollback.spec.mts, so a Drizzle upgrade that changes the shape fails a test
 * rather than corrupting the record of what has run.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

import { loadMigrationEnv } from "./env.mts";
import { MIGRATIONS_FOLDER, assertMigrationsFolder } from "./paths.mts";

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

export function readJournal(
  folder: string = MIGRATIONS_FOLDER,
): JournalEntry[] {
  const raw = fs.readFileSync(
    path.join(folder, "meta", "_journal.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as { entries: JournalEntry[] };
  return parsed.entries;
}

export function downFilePath(
  tag: string,
  folder: string = MIGRATIONS_FOLDER,
): string {
  return path.join(folder, `${tag}.down.sql`);
}

async function main(): Promise<void> {
  assertMigrationsFolder();
  const env = loadMigrationEnv();
  const pool = new Pool({
    connectionString: env.MIGRATION_DATABASE_URL,
    max: 1,
  });

  try {
    const present = await pool.query<{ exists: boolean }>(
      "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists",
    );
    if (!present.rows[0]?.exists) {
      console.log(
        "nothing to roll back: no migrations have ever been applied here.",
      );
      return;
    }

    const last = await pool.query<{ id: number; created_at: string }>(
      "SELECT id, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 1",
    );
    const row = last.rows[0];
    if (!row) {
      console.log("nothing to roll back: the migrations table is empty.");
      return;
    }

    const entry = readJournal().find((e) => String(e.when) === row.created_at);
    if (!entry) {
      // The applied migration has no journal entry. Almost always a checkout that
      // does not contain the migration the database has run -- rolling back the
      // "latest" file here would run the wrong down script against the wrong schema.
      console.error(
        [
          `The most recently applied migration (created_at=${row.created_at}) has no entry`,
          "in migrations/meta/_journal.json.",
          "",
          "This database has run a migration that this checkout does not contain. Check",
          "out the branch that produced it before rolling back -- guessing which file to",
          "reverse would run the wrong SQL against a schema it was not written for.",
          "",
        ].join("\n"),
      );
      process.exit(1);
    }

    const downFile = downFilePath(entry.tag);
    if (!fs.existsSync(downFile)) {
      console.error(
        [
          `No down migration for "${entry.tag}".`,
          "",
          `Expected: ${path.relative(process.cwd(), downFile)}`,
          "",
          "Every migration ships with one. If reversing it is genuinely impossible --",
          "a destructive change, a data migration that loses information -- the file",
          "must still exist and say so, and raise an error explaining what to restore",
          "from instead. An absent file is indistinguishable from a forgotten one.",
          "",
          "See backend/api/migrations/README.md.",
          "",
        ].join("\n"),
      );
      process.exit(1);
    }

    const sql = fs.readFileSync(downFile, "utf8");
    console.log(`rolling back ${entry.tag}`);

    const client = await pool.connect();
    try {
      // One transaction: the SQL and the bookkeeping row succeed together or not at
      // all. Otherwise a failure halfway leaves the table claiming a migration is
      // applied when its objects are gone, and the next `db:migrate` skips it.
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "DELETE FROM drizzle.__drizzle_migrations WHERE id = $1",
        [row.id],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    console.log(`ok - ${entry.tag} rolled back`);
  } finally {
    await pool.end();
  }
}

// Only run when invoked directly, so the helpers above stay importable from tests.
// pathToFileURL rather than string concatenation: on Windows argv[1] is
// C:\...\rollback.mts, and `file://C:\...` is not the URL Node reports for it.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err: unknown) => {
    console.error("\nrollback failed:\n");
    console.error(err);
    process.exit(1);
  });
}
