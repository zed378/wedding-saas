/**
 * Apply pending migrations. `pnpm --filter @wi/api db:migrate`.
 *
 * A standalone command, run as a deliberate step before a release rolls out
 * (docs/ARCHITECTURE/04 § Migration Strategy). Nothing in the application imports
 * this file and src/main.ts does not call it -- migrating on startup means every
 * replica races to alter the schema during a rolling deploy, and a failed migration
 * becomes an outage rather than a stopped pipeline.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { loadMigrationEnv } from "./env.mts";
import { MIGRATIONS_FOLDER, assertMigrationsFolder } from "./paths.mts";

async function main(): Promise<void> {
  assertMigrationsFolder();
  const env = loadMigrationEnv();
  const pool = new Pool({
    connectionString: env.MIGRATION_DATABASE_URL,
    max: 1,
  });

  try {
    const { rows } = await pool.query<{ db: string; usr: string }>(
      "SELECT current_database() AS db, current_user AS usr",
    );
    console.log(`migrating ${rows[0]?.db} as ${rows[0]?.usr}`);

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });

    // Drizzle's migrator is silent when there is nothing to do, which reads exactly
    // like success. Report what the database actually holds instead of trusting the
    // absence of output.
    const applied = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations",
    );
    console.log(
      `ok - ${applied.rows[0]?.n ?? "?"} migration(s) recorded as applied`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("\nmigration failed:\n");
  console.error(err);
  process.exit(1);
});
