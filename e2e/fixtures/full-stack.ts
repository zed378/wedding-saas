import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, openSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * `P2-14` — the real application, end to end: Postgres, Redis, the built API and the built
 * web app, for flows a stub cannot vouch for.
 *
 * `docs/TESTING/03` wants these flows against staging; the staging deploy is pull-based and
 * not reachable from a test run, so this is the local equivalent — the same production builds
 * against the same database engine, with nothing mocked between the browser and Postgres.
 *
 * ## Prerequisites
 *
 *   POSTGRES_PORT=54432 REDIS_PORT=56279 docker compose -f deploy/docker-compose.yml up -d postgres redis
 *   pnpm --filter @wi/api build && pnpm --filter @wi/web-app build
 *   E2E_FULL_STACK=1 MIGRATION_DATABASE_URL=postgres://wedding_owner:wedding_owner_dev@localhost:54432/wedding \
 *     TEST_REDIS_URL=redis://localhost:56279 pnpm --filter @wi/e2e exec playwright test template-switch
 *
 * The API listens on 3000 and the web app on 3100 because the web app's build inlines
 * `NEXT_PUBLIC_API_BASE_URL`, whose default is `http://localhost:3000/api/v1`.
 *
 * ## What it writes
 *
 * Migrations (idempotent), the development seed (idempotent, and it refuses a remote
 * database), and one extra template, `e2e-minimal`, with no gallery, maps, gift, RSVP or
 * guestbook — the second design a template switch needs. Users are created per run with a
 * unique address, so runs do not collide.
 */

const ROOT = join(__dirname, "..", "..");
const API = join(ROOT, "backend", "api");
const WEB_APP = join(ROOT, "frontend", "web-app");

export const API_ORIGIN = "http://localhost:3000";
export const WEB_APP_ORIGIN = "http://localhost:3100";

export const MINIMAL_TEMPLATE = {
  slug: "e2e-minimal",
  name: "E2E Minimal",
} as const;

/**
 * `pg` and `ioredis` are the API's dependencies, borrowed rather than added to this package.
 * Typed to the few members used here, since their declarations live with the API too.
 */
const fromApi = createRequire(join(API, "package.json"));

interface PgPool {
  query<Row>(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>;
  end(): Promise<void>;
}

interface RedisClient {
  keys(pattern: string): Promise<string[]>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  quit(): Promise<unknown>;
}

export function fullStackConfigured(): boolean {
  return (
    process.env["E2E_FULL_STACK"] === "1" &&
    process.env["MIGRATION_DATABASE_URL"] !== undefined
  );
}

export interface FullStack {
  readonly referenceTemplateId: string;
  readonly minimalTemplateId: string;
  stop(): Promise<void>;
}

export async function startFullStack(): Promise<FullStack> {
  const migrationUrl = process.env["MIGRATION_DATABASE_URL"]!;
  const redisUrl = process.env["TEST_REDIS_URL"] ?? "redis://localhost:56279";

  for (const [what, path] of [
    ["the API", join(API, "dist", "main.js")],
    ["the web app", join(WEB_APP, ".next", "BUILD_ID")],
  ] as const) {
    if (!existsSync(path)) throw new Error(`no build of ${what} at ${path}`);
  }

  for (const origin of [API_ORIGIN, WEB_APP_ORIGIN]) {
    const busy = await fetch(origin).then(
      () => true,
      () => false,
    );
    if (busy) {
      throw new Error(
        `${origin} is already answering — a server this suite did not start would be tested instead.`,
      );
    }
  }

  const env = { ...process.env, MIGRATION_DATABASE_URL: migrationUrl };
  for (const script of ["src/infra/db/migrate.mts", "src/infra/db/seed.mts"]) {
    const run = spawnSync(process.execPath, [script], {
      cwd: API,
      env,
      encoding: "utf8",
    });
    if (run.status !== 0) {
      throw new Error(`${script} failed:\n${run.stdout}\n${run.stderr}`);
    }
  }

  const { Pool } = fromApi("pg") as {
    Pool: new (options: { connectionString: string }) => PgPool;
  };
  const pool = new Pool({ connectionString: migrationUrl });
  let referenceTemplateId: string;
  let minimalTemplateId: string;
  try {
    const reference = JSON.parse(
      readFileSync(
        join(API, "src", "infra", "db", "seed-data", "reference-template.json"),
        "utf8",
      ),
    ) as {
      template: { slug: string };
      sections: { section_key: string }[];
      theme: unknown;
      customizable_theme_keys: string[];
    };

    referenceTemplateId = (
      await pool.query<{ id: string }>(
        "SELECT id FROM templates WHERE slug = $1",
        [reference.template.slug],
      )
    ).rows[0]!.id;

    // The second design: the reference template's own sections, minus five. Built from the
    // seed rather than written out, so it stays valid when the reference template changes.
    const kept = new Set(["hero", "quote", "couple", "event", "closing"]);
    // `docs/DATABASE/03` § Schema Validation: validated before it is written, like every other
    // writer of this table (`scripts/check-template-version-writes.mjs`). A fixture storing a
    // definition the application would refuse would test a state the product cannot reach.
    const { assertValidTemplateVersion } = fromApi("@wi/schema") as {
      assertValidTemplateVersion: (definition: unknown) => {
        sections: unknown;
        theme: unknown;
        customizable_theme_keys: string[];
      };
    };
    const minimal = assertValidTemplateVersion({
      // Without the seed file's `_why` annotations, which the seed loader strips too
      // (`seed-data/load.mts`) and the schema refuses as unknown keys.
      sections: reference.sections
        .filter((s) => kept.has(s.section_key))
        .map((section) =>
          Object.fromEntries(
            Object.entries(section).filter(([key]) => !key.startsWith("_")),
          ),
        ),
      theme: reference.theme,
      customizable_theme_keys: reference.customizable_theme_keys,
    });
    minimalTemplateId = (
      await pool.query<{ id: string }>(
        `INSERT INTO templates (slug, name, category, is_premium, thumbnail_url, status)
         VALUES ($1, $2, '{}', false, NULL, 'published')
         ON CONFLICT (slug) DO UPDATE SET status = 'published'
         RETURNING id`,
        [MINIMAL_TEMPLATE.slug, MINIMAL_TEMPLATE.name],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO template_versions
         (template_id, version, sections, theme, customizable_theme_keys, status, released_at)
       VALUES ($1, '1.0.0', $2::jsonb, $3::jsonb, $4, 'published', now())
       ON CONFLICT (template_id, version) DO UPDATE SET sections = EXCLUDED.sections`,
      [
        minimalTemplateId,
        JSON.stringify(minimal.sections),
        JSON.stringify(minimal.theme),
        minimal.customizable_theme_keys,
      ],
    );
  } finally {
    await pool.end();
  }

  // Earlier runs' limiter counters and blocks would turn this run into 429s.
  const Redis = fromApi("ioredis") as new (
    url: string,
    options: { maxRetriesPerRequest: number },
  ) => RedisClient;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
  const stale = await redis.keys("rl:*");
  if (stale.length > 0) await redis.del(...stale);
  /*
   * And the catalogue cache, the way an admin publish invalidates it (`TemplateService`'s
   * generation counter, `infra/cache/redis-cache.ts`). The integration suite truncates
   * `templates`, so the templates written above can have new ids while a cached listing from
   * an earlier run still names the old ones — the editor then offered a template id the
   * database had never heard of, and `change-template` answered 404.
   */
  await redis.incr("cache:gen:tpl");
  await redis.quit();

  const children: ChildProcess[] = [];
  children.push(
    spawn(process.execPath, ["dist/main.js"], {
      cwd: API,
      // `E2E_API_LOG=<file>` keeps the API's structured log, for a failure the browser only
      // sees as a status code.
      stdio:
        process.env["E2E_API_LOG"] === undefined
          ? "ignore"
          : ["ignore", openSync(process.env["E2E_API_LOG"], "w"), "inherit"],
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: "3000",
        APP_ORIGIN: WEB_APP_ORIGIN,
        PUBLIC_INVITE_ORIGIN: "http://localhost:3200",
        ADMIN_ORIGIN: "http://localhost:3300",
        DATABASE_URL: migrationUrl.replace(
          /\/\/[^@]+@/,
          "//wedding_app:wedding_app_dev@",
        ),
        MIGRATION_DATABASE_URL: migrationUrl,
        REDIS_URL: redisUrl,
        JWT_SIGNING_KEY: "e2e-full-stack-signing-key-000000000000",
        REFRESH_TOKEN_PEPPER: "e2e-full-stack-refresh-pepper-00000000",
        CDN_BASE_URL: "https://cdn.test",
        RATE_LIMIT_OVERRIDES: JSON.stringify({
          "general-authenticated": { limit: 50_000, windowSeconds: 60 },
        }),
      },
    }),
  );
  children.push(
    spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["next", "start", "--port", "3100"],
      {
        cwd: WEB_APP,
        stdio: "ignore",
        shell: process.platform === "win32",
        env: {
          ...process.env,
          API_INTERNAL_BASE_URL: API_ORIGIN,
          NODE_ENV: "production",
        },
      },
    ),
  );

  const stop = async () => {
    for (const child of children) {
      if (child.pid === undefined) continue;
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else {
        child.kill();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  };

  const deadline = Date.now() + 90_000;
  for (const url of [`${API_ORIGIN}/health`, `${WEB_APP_ORIGIN}/login`]) {
    for (;;) {
      const up = await fetch(url).then(
        (response) => response.status < 500,
        () => false,
      );
      if (up) break;
      if (Date.now() > deadline) {
        await stop();
        throw new Error(`${url} never answered`);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  return { referenceTemplateId, minimalTemplateId, stop };
}
