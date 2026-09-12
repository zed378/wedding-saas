import { z } from "zod";

import { checkSecretRules, SecretRuleError } from "./secret-rules";

/**
 * Environment contract.
 *
 * A service that boots with a missing signing key or webhook secret is worse than one
 * that refuses to boot: the first fails later, in production, on the request that
 * mattered. Everything required is validated here, once, before anything starts.
 *
 * Reserved slots are listed rather than left to be discovered. Each names the task that
 * makes it required, so nobody has to guess whether an absent variable is an oversight:
 *
 *   REDIS_URL                 P0-15  queue, cache and rate limiting
 *
 * See docs/DEVOPS/00-ENVIRONMENTS.md and P0-18 for where each value lives per environment.
 */
export const envSchema = z
  .object({
    /**
     * The BUILD mode. Node, React and every bundler read this, and it has exactly three
     * legal values -- so it cannot also carry "which deployment is this".
     */
    NODE_ENV: z.enum(["development", "test", "production"]),

    /**
     * The DEPLOYMENT environment. `docs/DEVOPS/00` § Environment List defines four:
     * development, test, staging and production.
     *
     * This exists because `NODE_ENV` cannot express `staging` and must not be made to.
     * Staging runs a production BUILD -- `docs/DEVOPS/00` § Parity requires it to be "as
     * close as possible to production ... the difference should only be resource/data
     * scale" -- while being a non-production ENVIRONMENT that carries sandbox payment
     * credentials and seeded dummy data.
     *
     * Conflating the two forced a choice between a staging build that differs from
     * production (defeating parity) and a staging environment indistinguishable from
     * production (so `db:seed` refuses to run on it, and a live payment key would pass
     * every check). `P0-23` hit exactly that and this is the fix.
     *
     * Defaults to `NODE_ENV` so development and test need no new variable; a deployed
     * environment sets it explicitly.
     */
    APP_ENV: z
      .enum(["development", "test", "staging", "production"])
      .optional(),

    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    /**
     * CORS allowlist. docs/SECURITY/08-API-SECURITY.md forbids `*` on authenticated
     * endpoints, so the origins are explicit and required -- there is no permissive
     * default to fall back to by accident.
     */
    APP_ORIGIN: z.url(),
    PUBLIC_INVITE_ORIGIN: z.url(),
    ADMIN_ORIGIN: z.url(),

    /** Largest accepted JSON body. Uploads do not travel this path (P1-17). */
    BODY_LIMIT: z.string().default("256kb"),

    /** Bounded drain window on shutdown, milliseconds. */
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

    /**
     * The APPLICATION connection (P0-06). Connects as a role that does not own its
     * tables and holds neither SUPERUSER nor BYPASSRLS -- see
     * deploy/postgres/init/01-app-role.sql for why that matters before row-level
     * policies exist.
     *
     * Migrations do NOT use this. They connect as the owner through
     * MIGRATION_DATABASE_URL, which is validated separately in
     * src/infra/db/env.mts, so a running API cannot alter its own schema even if
     * something tried.
     */
    DATABASE_URL: z.string().min(1),

    /**
     * Redis, for the job queue (`P1-02` producer, `P0-15` worker), the cache and rate
     * limiting -- one instance shared by all three (ADR-008).
     *
     * Required rather than optional: every deployed surface needs it, and an API that
     * started without it would fail on the first registration instead of at boot, which
     * is the failure mode `loadEnv` exists to prevent.
     */
    REDIS_URL: z.string().min(1),

    /**
     * Object storage (P0-16). MinIO locally, Cloudflare R2 in production (ADR-011).
     *
     * Optional so that a test run needs no bucket -- the storage module falls back to the
     * in-memory fake when NODE_ENV is `test` and no endpoint is set. Requiring them would
     * mean every unit test needed MinIO, which is the friction that ends with people not
     * running tests. `P0-23` makes them required in staging and production, where the
     * fallback would be a silent data-loss bug rather than a convenience.
     */
    STORAGE_ENDPOINT: z.string().min(1).optional(),
    STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
    STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),

    /** Bucket names, so an environment can prefix or rename them. */
    STORAGE_BUCKET_USER_MEDIA: z.string().min(1).default("user-media"),
    STORAGE_BUCKET_TEMPLATE_ASSETS: z
      .string()
      .min(1)
      .default("template-assets"),
    STORAGE_BUCKET_STAGING: z.string().min(1).default("staging"),

    /**
     * Where media is READ from. `docs/ARCHITECTURE/05` § Access Control: buckets are
     * private and "files must never be accessible directly via the bucket URL", so a media
     * URL is a CDN URL and never a storage endpoint. The two are deliberately separate
     * variables for that reason — pointing this at `STORAGE_ENDPOINT` would publish the
     * bucket.
     *
     * Optional, and with **no default**. A wrong CDN hostname produces broken images on
     * every published invitation, and a default is how a placeholder domain reaches
     * production. Where it is unset, `P1-17`'s media read simply omits `url` and
     * `thumbnail_url` rather than emitting a link it cannot construct.
     */
    CDN_BASE_URL: z.url().optional(),

    /**
     * Auth secrets. Required as of `P1-03`: without them nobody can log in, and "nobody
     * can log in" should be a refusal to boot rather than a 500 on the first attempt.
     *
     * 32 characters in EVERY environment, not just production. A short HMAC key is
     * brute-forceable offline from one captured token, and a development environment that
     * gets away with a short one is where the short one comes from. `checkSecretRules`
     * used to apply this in production only; that hole is closed here, in the schema,
     * where the length is a property of the value rather than of the deployment.
     */
    JWT_SIGNING_KEY: z.string().min(32),
    REFRESH_TOKEN_PEPPER: z.string().min(32),

    /**
     * Payment provider (P3-03, P3-05).
     *
     * Optional here and CROSS-CHECKED in `secret-rules.ts`: a live key outside production
     * refuses to start, and so does a sandbox key inside it. Both are values that pass
     * every per-field check and are still catastrophically wrong.
     */
    MIDTRANS_SERVER_KEY: z.string().min(1).optional(),
    MIDTRANS_CLIENT_KEY: z.string().min(1).optional(),
    MIDTRANS_WEBHOOK_SECRET: z.string().min(1).optional(),

    /**
     * Google Sign-In (P1-04). Optional, and checked at the point of use rather than at
     * boot: making it required would stop every developer not working on OAuth from
     * starting the API, and the failure it prevents -- a sign-in attempt with no client
     * id -- reports a 503 naming this variable rather than a confusing 401.
     */
    GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),

    /**
     * Rate limit overrides (P1-07), as JSON: `{"login":{"limit":20}}`.
     *
     * The middle of three layers. Defaults live in `shared/rate-limit/policies.ts`; the
     * layer that needs no restart is the `rl:config` Redis hash. A malformed value here
     * is logged and ignored rather than applied -- a typo during a tuning change must not
     * remove a limit.
     */
    RATE_LIMIT_OVERRIDES: z.string().optional(),

    /**
     * How many reverse proxies sit in front of the API (P1-07).
     *
     * A COUNT, deliberately, not a boolean. Express's `trust proxy: true` trusts the
     * leftmost `X-Forwarded-For` entry, which the client wrote -- so anyone could pick
     * their own rate-limit bucket, and per-IP limiting would become decorative. A count
     * makes Express take the n-th entry from the right, which only a real proxy can set.
     *
     * 1 locally (Caddy). 2 in production (Cloudflare -> Caddy).
     */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),

    /** Email (P4-06), CAPTCHA (P4-05), maps (P1-14). */
    RESEND_API_KEY: z.string().min(1).optional(),
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
    MAPS_API_KEY: z.string().min(1).optional(),
  })
  /**
   * `APP_ENV` falls back to `NODE_ENV` when it is not set.
   *
   * Applied here rather than as `.default()` because the default depends on another
   * field, which a per-field default cannot see. The effect is that development and test
   * need no new variable and behave exactly as before; only a deployed environment has
   * to say which one it is.
   */
  .transform((env) => ({
    ...env,
    APP_ENV: env.APP_ENV ?? env.NODE_ENV,
  }));

export type Env = z.infer<typeof envSchema>;

/** Raised when the environment does not satisfy the contract. */
export class ConfigValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(
      [
        "Configuration is invalid, refusing to start:",
        ...issues.map((i) => `  - ${i}`),
        "",
        "See .env.example for every variable and docs/DEVOPS/00-ENVIRONMENTS.md for",
        "where each value comes from per environment.",
      ].join("\n"),
    );
    this.name = "ConfigValidationError";
  }
}

/**
 * Validate and freeze the environment.
 *
 * Throws naming every offending variable at once. Reporting one at a time would mean a
 * restart per mistake, which is how people end up commenting out validation.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const name = issue.path.join(".") || "(root)";
      return `${name}: ${issue.message}`;
    });
    throw new ConfigValidationError(issues);
  }

  /**
   * Cross-field rules, after every individual field is valid.
   *
   * Separate because these are the checks no single field can make. The case that
   * matters is a real, working, LIVE payment key on staging: it passes every field
   * check and would charge real cards from a test run.
   */
  const violations = checkSecretRules(result.data);
  if (violations.length > 0) throw new SecretRuleError(violations);

  return Object.freeze(result.data);
}
