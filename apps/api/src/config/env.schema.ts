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
 *   DATABASE_URL              P0-06  migrations and the data layer
 *   REDIS_URL                 P0-15  queue, cache and rate limiting
 *   STORAGE_*                 P0-16  object storage (R2 / MinIO)
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
