import { z } from "zod";

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
 *   JWT_SIGNING_KEY           P1-03  access token signing
 *   REFRESH_TOKEN_PEPPER      P1-03  refresh token hashing
 *   MIDTRANS_SERVER_KEY       P3-03  payment provider
 *   MIDTRANS_WEBHOOK_SECRET   P3-05  webhook signature verification
 *   RESEND_API_KEY            P4-06  transactional email
 *
 * See docs/DEVOPS/00-ENVIRONMENTS.md and P0-18 for where each value lives per environment.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),

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
  STORAGE_BUCKET_TEMPLATE_ASSETS: z.string().min(1).default("template-assets"),
  STORAGE_BUCKET_STAGING: z.string().min(1).default("staging"),
});

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
  return Object.freeze(result.data);
}
