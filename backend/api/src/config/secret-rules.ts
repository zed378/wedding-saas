import type { z } from "zod";

/**
 * Cross-field rules about secrets, applied after the per-variable schema passes.
 *
 * These are the checks that no single field can make. "Is this key allowed in this
 * environment?" depends on two values at once, and the answer matters most in the case
 * where both are individually valid — a real, working, *live* payment key on staging is
 * the definition of a value that passes every field check and must still refuse to boot.
 *
 * `docs/DEVOPS/00` § Configuration per Environment: staging uses the provider's sandbox
 * credentials, production uses live. The `P0-18` card asks for those to be
 * non-interchangeable "by configuration mistake", which means a mistake has to be caught
 * by the machine rather than by whoever pasted the value.
 */

/**
 * Midtrans key prefixes.
 *
 * Sandbox keys are prefixed `SB-`; live keys are not. That is a property of the
 * provider's key format, so this recognises a live key rather than trusting a separate
 * "mode" flag someone would have to remember to flip.
 */
const MIDTRANS_SANDBOX_PREFIX = "SB-";

export interface SecretRuleViolation {
  readonly variable: string;
  readonly message: string;
}

interface Checked {
  NODE_ENV: string;
  MIDTRANS_SERVER_KEY?: string | undefined;
  MIDTRANS_CLIENT_KEY?: string | undefined;
  APP_ORIGIN: string;
  PUBLIC_INVITE_ORIGIN: string;
  ADMIN_ORIGIN: string;
  DATABASE_URL: string;
  JWT_SIGNING_KEY?: string | undefined;
}

/**
 * Every cross-field secret rule. Returns all violations, not the first.
 *
 * Reporting one at a time means a restart per mistake, which is how people end up
 * commenting out validation — the same reasoning as `loadEnv` naming every offending
 * variable at once.
 */
export function checkSecretRules(env: Checked): SecretRuleViolation[] {
  const violations: SecretRuleViolation[] = [];
  const isProduction = env.NODE_ENV === "production";

  // ---------------------------------------------------------------- payment keys
  //
  // THE rule this file exists for. A live key outside production is not a
  // misconfiguration that degrades gracefully: a staging test would charge a real card,
  // and a developer running the stack locally would too.
  for (const name of ["MIDTRANS_SERVER_KEY", "MIDTRANS_CLIENT_KEY"] as const) {
    const value = env[name];
    if (value === undefined || value.length === 0) continue;

    const isSandbox = value.startsWith(MIDTRANS_SANDBOX_PREFIX);

    if (!isSandbox && !isProduction) {
      violations.push({
        variable: name,
        message:
          `looks like a LIVE key (no "${MIDTRANS_SANDBOX_PREFIX}" prefix) but NODE_ENV is ` +
          `"${env.NODE_ENV}". docs/DEVOPS/00 requires sandbox credentials outside ` +
          `production. A live key here charges real cards from a test.`,
      });
    }

    // The reverse is just as wrong and much easier to miss: a sandbox key in production
    // means every payment silently succeeds against the provider's test environment,
    // and no money ever arrives. Nothing errors; the orders just look paid.
    if (isSandbox && isProduction) {
      violations.push({
        variable: name,
        message:
          `is a SANDBOX key ("${MIDTRANS_SANDBOX_PREFIX}" prefix) but NODE_ENV is ` +
          `"production". Payments would succeed against the provider's test environment ` +
          `and no money would arrive.`,
      });
    }
  }

  // ---------------------------------------------------------------- production only
  if (isProduction) {
    // A signing key short enough to brute force is worse than none, because it looks
    // like security. docs/SECURITY/03 wants HS256/RS256 from a secret manager.
    if (env.JWT_SIGNING_KEY !== undefined && env.JWT_SIGNING_KEY.length < 32) {
      violations.push({
        variable: "JWT_SIGNING_KEY",
        message:
          "must be at least 32 characters in production (docs/SECURITY/03 § Tokens).",
      });
    }

    // Every origin must be HTTPS. An http:// origin in production means cookies without
    // Secure work, and the refresh token cookie is docs/SECURITY/03's whole session
    // mechanism.
    for (const name of [
      "APP_ORIGIN",
      "PUBLIC_INVITE_ORIGIN",
      "ADMIN_ORIGIN",
    ] as const) {
      if (!env[name].startsWith("https://")) {
        violations.push({
          variable: name,
          message: `must be https:// in production, received ${env[name]}.`,
        });
      }
    }

    // A localhost database in production is a deployment that came up pointing at
    // nothing, or at a sidecar nobody backs up.
    if (/@(localhost|127\.0\.0\.1)[:/]/.test(env.DATABASE_URL)) {
      violations.push({
        variable: "DATABASE_URL",
        message: "points at localhost in production.",
      });
    }
  }

  return violations;
}

/** Raised when a cross-field secret rule fails. Exit code 78, as `loadEnv` uses. */
export class SecretRuleError extends Error {
  constructor(readonly violations: readonly SecretRuleViolation[]) {
    super(
      [
        "Refusing to start: the configuration mixes environments.",
        ...violations.map((v) => `  - ${v.variable} ${v.message}`),
        "",
        "See deploy/SECRETS.md for where each value lives per environment.",
        "",
      ].join("\n"),
    );
    this.name = "SecretRuleError";
  }
}

/** Type helper so the schema module can stay unaware of this file's shape. */
export type EnvLike = z.infer<z.ZodType<Checked>>;
