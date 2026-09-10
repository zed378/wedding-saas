import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import {
  RedisContainer,
  type StartedRedisContainer,
} from "@testcontainers/redis";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { execFileSync } from "node:child_process";
import path from "node:path";

import * as schema from "../../src/infra/db/schema/index";

/**
 * The integration harness. `docs/TESTING/02` § Test Pattern.
 *
 * Two things it is responsible for, and one thing it deliberately refuses to do.
 *
 * **A database that matches the migrations.** Either a throwaway container, or one the
 * developer already has running. Migrations are applied automatically, so a suite can
 * never run against a schema that is a migration behind — which produces failures that
 * look like bugs in the code under test.
 *
 * **Per-test isolation.** `docs/TESTING/02` offers "a transaction rollback per test OR
 * truncate the tables". Truncation is what the schema suites have used since `P0-07`,
 * and it is why `fileParallelism: false` is still required: two suites truncating one
 * database delete each other's rows. This adds the transaction option, which is both
 * faster and genuinely isolated.
 *
 * **It does not skip.** If no database can be reached and none can be started, the
 * suite FAILS. `P0-19` step 7 asks for exactly this, and the reason is that a skipped
 * integration suite reports green for constraints nobody verified — the board then says
 * a task passed when its tests did not run.
 */

export interface Harness {
  readonly databaseUrl: string;
  readonly redisUrl: string | undefined;
  readonly pool: Pool;
  readonly db: ReturnType<typeof drizzle<typeof schema>>;
  stop(): Promise<void>;
}

const MIGRATIONS = path.resolve(__dirname, "../../migrations");

/**
 * Where the database comes from, in order of preference.
 *
 * 1. `TEST_DATABASE_URL` / `MIGRATION_DATABASE_URL` — a database the developer already
 *    has. Fastest, and what the compose stack provides.
 * 2. A testcontainer — reproducible and disposable, but a container start per run.
 *
 * Preferring an existing database is deliberate: a five-second container start on every
 * `pnpm test:integration` is exactly the friction that stops people running them.
 */
export async function startHarness(
  options: { redis?: boolean } = {},
): Promise<Harness> {
  const existing =
    process.env["TEST_DATABASE_URL"] ?? process.env["MIGRATION_DATABASE_URL"];

  let pgContainer: StartedPostgreSqlContainer | undefined;
  let redisContainer: StartedRedisContainer | undefined;
  let databaseUrl: string;

  if (existing !== undefined && (await reachable(existing))) {
    databaseUrl = existing;
  } else {
    try {
      pgContainer = await new PostgreSqlContainer("postgres:18-alpine")
        .withDatabase("wedding_test")
        .withUsername("wedding_owner")
        .withPassword("wedding_owner_test")
        .start();
      databaseUrl = pgContainer.getConnectionUri();
    } catch (cause) {
      // Fails rather than skips. P0-19 step 7.
      throw new Error(
        [
          "No database available for the integration suite.",
          "",
          existing !== undefined
            ? `  TEST_DATABASE_URL is set to ${redact(existing)} but nothing answered there.`
            : "  Neither TEST_DATABASE_URL nor MIGRATION_DATABASE_URL is set.",
          "  Starting a container failed too, so Docker is probably not running.",
          "",
          "These tests do not skip when the database is missing, on purpose: a skipped",
          "integration suite reports green for constraints nobody verified, and the",
          "board then says a task passed when its tests did not run.",
          "",
          "  docker compose -f deploy/docker-compose.yml up -d postgres",
          "  MIGRATION_DATABASE_URL=postgres://wedding_owner:wedding_owner_dev@localhost:5432/wedding \\",
          "    pnpm --filter @wi/api test:integration",
          "",
        ].join("\n"),
        { cause },
      );
    }
  }

  if (options.redis === true) {
    const existingRedis =
      process.env["TEST_REDIS_URL"] ?? process.env["REDIS_URL"];
    if (existingRedis === undefined) {
      redisContainer = await new RedisContainer("redis:7-alpine").start();
    }
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const db = drizzle(pool, { schema });

  // Applied every time. A suite running against a schema one migration behind produces
  // failures that look like bugs in the code under test, and the hour is spent in the
  // wrong file.
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await seedMasterData(pool);

  return {
    databaseUrl,
    redisUrl:
      redisContainer?.getConnectionUrl() ??
      process.env["TEST_REDIS_URL"] ??
      process.env["REDIS_URL"],
    pool,
    db,
    async stop(): Promise<void> {
      await pool.end();
      await pgContainer?.stop();
      await redisContainer?.stop();
    },
  };
}

/**
 * The master price tables, which are seed data rather than a migration (`P0-10`).
 *
 * Without this every order test fails on a missing `standard` package — a failure that
 * reads as a schema bug and is not. The `db-roundtrip.sh` script learned the same lesson
 * in `P0-10`.
 */
async function seedMasterData(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO packages (id, name, price, duration_months, max_photos, has_watermark, is_active)
     VALUES ('standard', 'Standard', 139000, 12, 200, false, true)
     ON CONFLICT (id) DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO addons (id, name, price, is_active) VALUES
       ('custom_domain', 'Custom Domain', 0, false),
       ('extended_validity', 'Extended Validity', 0, false)
     ON CONFLICT (id) DO NOTHING`,
  );
}

async function reachable(url: string): Promise<boolean> {
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 2_000,
    max: 1,
  });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

function redact(url: string): string {
  return url.replace(/:[^:@]*@/, ":***@");
}

/**
 * Clear every tenant-owned table.
 *
 * `TRUNCATE ... CASCADE` from the three roots, so the ordering question disappears --
 * see the `P0-11` record for what happened when each suite cleared the tables it knew
 * about in the order it believed correct. `packages` and `addons` survive: nothing
 * cascades upward into them and the seed must persist.
 */
export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE users, templates, media RESTART IDENTITY CASCADE");
}

/**
 * Verify the migration journal matches what has been applied.
 *
 * Used by the harness's own test. A suite running one migration behind is the failure
 * mode this whole file exists to prevent, so it is worth asserting rather than assuming.
 */
export async function appliedMigrationCount(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations",
  );
  return Number(rows[0]?.n ?? 0);
}

export function journalMigrationCount(): number {
  const journal = execFileSync(
    process.execPath,
    [
      "-e",
      `console.log(JSON.parse(require('fs').readFileSync(${JSON.stringify(
        path.join(MIGRATIONS, "meta", "_journal.json"),
      )}, 'utf8')).entries.length)`,
    ],
    { encoding: "utf8" },
  );
  return Number(journal.trim());
}
