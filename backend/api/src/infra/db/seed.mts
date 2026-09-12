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
 * Seeds the master price tables (P0-10), the reference template and its demo
 * invitation (P0-21).
 */
import { readFileSync } from "node:fs";
import { Pool } from "pg";

import { loadMigrationEnv } from "./env.mts";
import {
  seedDemoInvitation,
  seedReferenceTemplate,
} from "./seed-data/seed-template.mts";

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

/**
 * The reserved-word and profanity blocklist. `docs/DATABASE/12` § Seeding and Caching is
 * explicit that this is **seed data rather than a migration**, on DATABASE/00's convention
 * that schema and content are separate concerns.
 *
 * Idempotent. `created_by` stays NULL: nobody typed these, and attributing them to a
 * person would be a lie an auditor would later have to untangle.
 *
 * Unlike the rest of this file, it is also needed in **production** -- `P1-09` validates
 * every slug against it, and an empty table is a validation that passes everything,
 * including `admin` and `api`. Until `P5-13` gives admins a write path, running
 * `db:seed --blocklist-only` after a deploy is how the list gets there; the guards in
 * `main()` refuse the full seed in production and that refusal is correct.
 */
async function seedSlugBlocklist(pool: Pool): Promise<number> {
  const rows = JSON.parse(
    readFileSync(
      new URL("./seed-data/slug-blocklist.json", import.meta.url),
      "utf8",
    ),
  ) as { term: string; match_type: string; category: string; reason: string }[];

  for (const row of rows) {
    await pool.query(
      `INSERT INTO slug_blocklist (term, match_type, category, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (lower(term), match_type) DO UPDATE
         SET category = EXCLUDED.category, reason = EXCLUDED.reason`,
      [row.term, row.match_type, row.category, row.reason],
    );
  }

  return rows.length;
}

async function main(): Promise<void> {
  // Guard 1: refuse outright in production.
  //
  // Keyed on APP_ENV, the DEPLOYMENT environment, not NODE_ENV, the build mode.
  // `docs/DEVOPS/00` § Environment List requires staging to carry "realistic dummy data,
  // periodically reset ... from curated seed data", AND § Parity requires staging to run
  // what production runs -- which means NODE_ENV=production. Keyed on NODE_ENV this
  // guard refused to seed the one deployed environment that is supposed to be seeded.
  //
  // APP_ENV falls back to NODE_ENV when unset, so a developer who has never heard of it
  // gets the old behaviour exactly.
  const appEnv = process.env.APP_ENV ?? process.env.NODE_ENV;
  if (appEnv === "production") {
    console.error(
      "refusing to seed: APP_ENV=production. Seeds are development and staging data.",
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
    const blocked = await seedSlugBlocklist(pool);
    console.log(`  slug_blocklist: ${blocked} term(s)`);
    const templateVersionId = await seedReferenceTemplate(pool);
    await seedDemoInvitation(pool, templateVersionId);

    console.log("done.");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("\nseed failed:\n");
  console.error(err);
  process.exit(1);
});
