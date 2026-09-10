/**
 * Seed development data. `pnpm --filter @wi/api db:seed`.
 *
 * A separate command from `db:migrate`, and that separation is the point rather than
 * a convenience: production runs migrations and never runs this. A seed folded into
 * the migration chain would eventually insert a demo user into a real database, and
 * it would do it as part of the deploy that nobody was watching.
 *
 * Two guards below enforce that, because the discipline cannot rely on remembering.
 *
 * There is nothing to seed yet -- there are no tables until P0-07..P0-10. The
 * reference template and demo data arrive with P0-21.
 */
import { Pool } from "pg";

import { loadMigrationEnv } from "./env.mts";

async function main(): Promise<void> {
  // Guard 1: refuse outright in production.
  if (process.env.NODE_ENV === "production") {
    console.error("refusing to seed: NODE_ENV=production. Seeds are development data.");
    process.exit(1);
  }

  const env = loadMigrationEnv();

  // Guard 2: refuse a database that does not look like a development one. NODE_ENV
  // is set by whoever runs the command, so it cannot be the only check -- a laptop
  // pointed at a production URL still has NODE_ENV=development.
  const url = env.MIGRATION_DATABASE_URL;
  const looksRemote = !/@(localhost|127\.0\.0\.1|postgres|db)[:/]/.test(url);
  if (looksRemote && process.env.SEED_I_KNOW_WHAT_I_AM_DOING !== "yes") {
    console.error(
      [
        "refusing to seed: MIGRATION_DATABASE_URL does not point at a local database.",
        "",
        "Host is not localhost, 127.0.0.1, or the compose service name. If this really",
        "is a throwaway environment, set SEED_I_KNOW_WHAT_I_AM_DOING=yes.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("SELECT current_database() AS db");
    console.log(`seeding ${rows[0]?.db}`);

    // P0-21 fills this in: the reference template and its demo invitation.
    console.log("nothing to seed yet - no tables exist until P0-07..P0-10 (see P0-21).");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("\nseed failed:\n");
  console.error(err);
  process.exit(1);
});
