/**
 * `P2-17` — `pnpm --filter @wi/api db:seed:regions`.
 *
 * Loads Indonesia's administrative regions. Unlike `db:seed`, this runs in production: the rows
 * are reference data the product depends on, not sample data, and the load is an idempotent
 * upsert. Uses the migration role, because the application role may only read these tables
 * (migration 0009).
 */
import { Pool } from "pg";

import { loadMigrationEnv } from "./env.mts";
import { seedRegions } from "./seed-data/regions/seed-regions.mts";

async function main(): Promise<void> {
  const env = loadMigrationEnv();
  const pool = new Pool({
    connectionString: env.MIGRATION_DATABASE_URL,
    max: 1,
  });
  try {
    const started = Date.now();
    const result = await seedRegions(pool);
    console.log(
      `regions: ${JSON.stringify(result.regions)} (levels 1-4), ${result.boundaries} boundaries, ` +
        `${result.stale} code(s) no longer in the source, in ${String(Date.now() - started)}ms`,
    );
    if (result.stale > 0) {
      console.log(
        "  stale codes are kept: events may reference them. Review before removing any.",
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("\nregion seed failed:\n");
  console.error(err);
  process.exit(1);
});
