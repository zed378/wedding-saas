import { Pool } from "pg";

/**
 * Shared setup for the schema integration suites.
 *
 * The rule these helpers exist to enforce: **these tests fail when the database is
 * missing, they never skip**. A schema suite that skips reports green for constraints
 * nobody verified, which is worse than having no suite — the board says it passed.
 *
 * `P0-19` replaces the "start compose first" precondition with Testcontainers. When it
 * does, only `connect()` changes.
 */

export const DATABASE_URL =
  process.env["MIGRATION_DATABASE_URL"] ??
  "postgres://wedding_owner:wedding_owner_dev@localhost:5432/wedding";

/** Unique per call, so a row left by a failed run cannot make a later one pass. */
export const tag = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const redact = (url: string): string => url.replace(/:[^:@]*@/, ":***@");

/**
 * Open a pool and prove the schema is actually there.
 *
 * `requiredTables` is not ceremony: an empty database answers `SELECT 1` perfectly
 * well, and every constraint test would then fail with "relation does not exist" —
 * twenty confusing failures instead of one clear message naming the command to run.
 */
export async function connect(requiredTables: string[] = []): Promise<Pool> {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });

  try {
    await pool.query("SELECT 1");
  } catch (cause) {
    await pool.end().catch(() => {});
    throw new Error(
      [
        `Cannot reach PostgreSQL at ${redact(DATABASE_URL)}`,
        "",
        "These tests do not skip when the database is missing, on purpose.",
        "",
        "  docker compose -f deploy/docker-compose.yml up -d postgres",
        "  pnpm --filter @wi/api db:migrate",
        "",
      ].join("\n"),
      { cause },
    );
  }

  if (requiredTables.length > 0) {
    const { rows } = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)",
      [requiredTables],
    );
    const present = new Set(rows.map((r) => r.table_name));
    const missing = requiredTables.filter((t) => !present.has(t));

    if (missing.length > 0) {
      await pool.end().catch(() => {});
      throw new Error(
        [
          `Missing table(s): ${missing.join(", ")}`,
          "",
          "The database is reachable but has not been migrated to this revision.",
          "",
          "  pnpm --filter @wi/api db:migrate",
          "",
        ].join("\n"),
      );
    }
  }

  return pool;
}

/** Alias kept for readability at call sites that do not need table checks. */
export const freshPool = (): Promise<Pool> => connect();

/**
 * Clear every tenant-owned table, in one statement.
 *
 * Each suite used to delete the tables it knew about, in the order it believed correct.
 * That worked until `P0-11` added a suite whose leftovers a *different* suite's cleanup
 * could not remove: `invitations` RESTRICTs `template_versions`, so the templates suite
 * -- written before `invitations` existed -- could no longer clear its own tables once
 * another suite had run first. Twenty failures, none of them in the code under test.
 *
 * TRUNCATE ... CASCADE removes the ordering question entirely: name the three roots and
 * PostgreSQL works out the dependents. `packages` and `addons` are deliberately absent,
 * because nothing cascades upward into them and the seed must survive (`P0-10`).
 *
 * `P0-19` should replace this with a transaction per test or a database per suite. This
 * is the honest interim: correct, but it means suites cannot run in parallel.
 */
export async function resetTenantData(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE users, templates, media RESTART IDENTITY CASCADE");
}

/**
 * A pool connected as the APPLICATION role, not the owner.
 *
 * Needed for anything asserting a permission. The owner can do everything, so a test
 * that checks "the application cannot UPDATE audit_logs" while connected as the owner
 * proves nothing at all -- it would pass whether or not the REVOKE ever ran.
 */
export function applicationPool(): Pool {
  const url = DATABASE_URL.replace(
    /\/\/[^@]+@/,
    "//wedding_app:wedding_app_dev@",
  );
  return new Pool({ connectionString: url, max: 2 });
}
