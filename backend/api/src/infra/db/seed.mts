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
 * Seeds the master price tables (P0-10). The reference template and demo invitation
 * arrive with P0-21.
 */
import { Pool } from "pg";

import { loadMigrationEnv } from "./env.mts";

/**
 * Master price tables. `docs/DATABASE/07` § Notes is explicit that these are SEED data
 * and not a migration: prices change without a schema change, and `orders.amount_total`
 * is a snapshot that a later price change must never rewrite.
 *
 * Idempotent, so re-running is safe. `ON CONFLICT DO UPDATE` deliberately touches only
 * the master tables -- nothing here reaches into `orders`.
 */
async function seedPackagesAndAddons(pool: Pool): Promise<void> {
  // ADR-023: one package, Rp 139,000, 12 months, 200 photos, no watermark.
  // Price is rupiah as an integer. There is no floating point anywhere near money.
  await pool.query(
    `INSERT INTO packages (id, name, price, duration_months, max_photos, has_watermark, is_active)
     VALUES ('standard', 'Standard', 139000, 12, 200, false, true)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       price = EXCLUDED.price,
       duration_months = EXCLUDED.duration_months,
       max_photos = EXCLUDED.max_photos,
       has_watermark = EXCLUDED.has_watermark,
       is_active = EXCLUDED.is_active`,
  );

  // Both addons ship INACTIVE and that is the point, not an oversight.
  //   custom_domain      -- ADR-022: not sellable until P7-01 ships the feature.
  //                         Selling it first would take money for something that
  //                         does not exist.
  //   extended_validity  -- redundant beside a 12-month package (docs/PLAN/09).
  await pool.query(
    `INSERT INTO addons (id, name, price, is_active) VALUES
       ('custom_domain', 'Custom Domain', 0, false),
       ('extended_validity', 'Extended Validity', 0, false)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       price = EXCLUDED.price,
       is_active = EXCLUDED.is_active`,
  );

  const { rows } = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM packages WHERE is_active",
  );
  console.log(
    `packages and addons seeded (${rows[0]?.n ?? "?"} active package)`,
  );
}

async function main(): Promise<void> {
  // Guard 1: refuse outright in production.
  if (process.env.NODE_ENV === "production") {
    console.error(
      "refusing to seed: NODE_ENV=production. Seeds are development data.",
    );
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
    const { rows } = await pool.query<{ db: string }>(
      "SELECT current_database() AS db",
    );
    console.log(`seeding ${rows[0]?.db}`);

    await seedPackagesAndAddons(pool);

    // P0-21 adds the reference template and its demo invitation.
    console.log(
      "done. (The reference template and demo data arrive with P0-21.)",
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("\nseed failed:\n");
  console.error(err);
  process.exit(1);
});
