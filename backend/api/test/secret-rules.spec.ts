/*
 * These tests already passed `"staging"` where the field was called NODE_ENV -- a value
 * `NODE_ENV` never allowed. `P0-23` renamed the field to APP_ENV, the deployment
 * environment (`docs/DEVOPS/00` § Environment List), which is what the assertions always
 * meant. Nothing about the expected behaviour changed.
 */
import { describe, it, expect } from "vitest";

import { checkSecretRules } from "../src/config/secret-rules";
import { loadEnv } from "../src/config/env.schema";
import { SecretRuleError } from "../src/config/secret-rules";

/**
 * P0-18 — the rules that stop one environment's credentials being used in another.
 *
 * The case worth understanding: a real, working, LIVE payment key on staging passes
 * every per-field check. It is a valid string, the right length, the right shape. Only
 * a rule that looks at two values at once can tell it is catastrophically wrong -- and
 * "catastrophic" is literal, because a staging test would charge a real card.
 */

const base = {
  APP_ENV: "production",
  APP_ORIGIN: "https://app.vizunicum.my.id",
  PUBLIC_INVITE_ORIGIN: "https://invitation.vizunicum.my.id",
  ADMIN_ORIGIN: "https://admin.vizunicum.my.id",
  DATABASE_URL: "postgres://wedding_app:pw@db.internal:5432/wedding",
};

/**
 * Shaped like the provider's keys, and deliberately not real.
 *
 * The hyphens matter. These first ran the word EXAMPLE straight into the rest of the
 * string with no separator, and scripts/check-secrets.mjs refused them: its placeholder
 * allowance needs a word boundary, and a run-together word has none. The scanner blocked
 * the very commit that added it -- correct behaviour, and a fair first test of the hook.
 *
 * Fixing the fixture rather than loosening the scanner is the right way round: a
 * placeholder should read as one to a human as well as to a regex. Note also that the
 * comment above must not spell out a full key-shaped string, or it trips the scanner
 * too -- which is exactly what happened on the next attempt.
 */
const LIVE_KEY = "Mid-server-example-not-a-real-key";
const SANDBOX_KEY = "SB-Mid-server-example-not-a-real-key";

describe("payment keys cannot cross environments", () => {
  it.each(["development", "test", "staging"])(
    "refuses a live key when APP_ENV is %s",
    (env) => {
      // The rule this file exists for. docs/DEVOPS/00: staging uses sandbox
      // credentials. A live key here charges real cards from a test.
      const violations = checkSecretRules({
        ...base,
        APP_ENV: env,
        MIDTRANS_SERVER_KEY: LIVE_KEY,
      });

      expect(violations.map((v) => v.variable)).toContain(
        "MIDTRANS_SERVER_KEY",
      );
      expect(violations[0]?.message).toMatch(/LIVE key/);
    },
  );

  it("refuses a sandbox key in production", () => {
    // The reverse, and much easier to miss: every payment succeeds against the
    // provider's test environment and no money arrives. Nothing errors -- the orders
    // just look paid.
    const violations = checkSecretRules({
      ...base,
      MIDTRANS_SERVER_KEY: SANDBOX_KEY,
    });

    expect(violations.map((v) => v.variable)).toContain("MIDTRANS_SERVER_KEY");
    expect(violations[0]?.message).toMatch(/SANDBOX key/);
  });

  it("accepts a sandbox key outside production", () => {
    expect(
      checkSecretRules({
        ...base,
        APP_ENV: "staging",
        MIDTRANS_SERVER_KEY: SANDBOX_KEY,
      }),
    ).toEqual([]);
  });

  it("accepts a live key in production", () => {
    expect(
      checkSecretRules({ ...base, MIDTRANS_SERVER_KEY: LIVE_KEY }),
    ).toEqual([]);
  });

  it("checks the client key as well as the server key", () => {
    // Two keys, one rule. Checking only the server key would leave the client key as
    // the way to get a live credential onto staging.
    const violations = checkSecretRules({
      ...base,
      APP_ENV: "staging",
      MIDTRANS_CLIENT_KEY: "Mid-client-example-not-a-real-key",
    });
    expect(violations.map((v) => v.variable)).toContain("MIDTRANS_CLIENT_KEY");
  });

  it("says nothing when no payment key is configured", () => {
    // Absent is fine -- payment arrives in P3-03. Only a present, wrong key is an error.
    expect(checkSecretRules({ ...base, APP_ENV: "development" })).toEqual([]);
  });
});

describe("production-only rules", () => {
  it("refuses a short signing key", () => {
    // A key short enough to brute force is worse than none, because it looks like
    // security. docs/SECURITY/03 § Tokens.
    const violations = checkSecretRules({ ...base, JWT_SIGNING_KEY: "short" });
    expect(violations.map((v) => v.variable)).toContain("JWT_SIGNING_KEY");
  });

  it("accepts a long signing key", () => {
    expect(
      checkSecretRules({ ...base, JWT_SIGNING_KEY: "a".repeat(48) }),
    ).toEqual([]);
  });

  it("does not apply the length rule outside production", () => {
    // A developer should not need a 32-character key to run the stack locally.
    expect(
      checkSecretRules({
        ...base,
        APP_ENV: "development",
        JWT_SIGNING_KEY: "short",
      }),
    ).toEqual([]);
  });

  it.each(["APP_ORIGIN", "PUBLIC_INVITE_ORIGIN", "ADMIN_ORIGIN"] as const)(
    "refuses a non-https %s in production",
    (name) => {
      // An http:// origin means the refresh token cookie works without Secure, and that
      // cookie is docs/SECURITY/03's entire session mechanism.
      const violations = checkSecretRules({
        ...base,
        [name]: "http://app.example.com",
      });
      expect(violations.map((v) => v.variable)).toContain(name);
    },
  );

  it("refuses a localhost database in production", () => {
    const violations = checkSecretRules({
      ...base,
      DATABASE_URL: "postgres://u:p@localhost:5432/wedding",
    });
    expect(violations.map((v) => v.variable)).toContain("DATABASE_URL");
  });

  it("reports every violation at once, not the first", () => {
    // Reporting one at a time means a restart per mistake, which is how people end up
    // commenting out validation.
    const violations = checkSecretRules({
      ...base,
      APP_ORIGIN: "http://a.example.com",
      ADMIN_ORIGIN: "http://b.example.com",
      JWT_SIGNING_KEY: "short",
      MIDTRANS_SERVER_KEY: SANDBOX_KEY,
    });
    expect(violations.length).toBeGreaterThanOrEqual(4);
  });
});

describe("APP_ENV is the deployment, NODE_ENV is the build (P0-23)", () => {
  const staging = {
    NODE_ENV: "production",
    APP_ORIGIN: "https://app.vizunicum.my.id",
    PUBLIC_INVITE_ORIGIN: "https://invitation.vizunicum.my.id",
    ADMIN_ORIGIN: "https://admin.vizunicum.my.id",
    DATABASE_URL: "postgres://wedding_app:pw@postgres:5432/wedding",
    REDIS_URL: "redis://redis:6379",
  };

  it("defaults APP_ENV to NODE_ENV when it is not set", () => {
    // So development and test need no new variable and behave exactly as before.
    const env = loadEnv({
      ...staging,
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv);
    expect(env.APP_ENV).toBe("development");
  });

  it("lets staging run a production BUILD without being a production ENVIRONMENT", () => {
    // docs/DEVOPS/00 § Parity wants staging as close to production as possible, which
    // means NODE_ENV=production. docs/DEVOPS/00 § Environment List wants it seeded and
    // on sandbox credentials, which means it is not production. Both, at once.
    const env = loadEnv({
      ...staging,
      APP_ENV: "staging",
    } as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe("production");
    expect(env.APP_ENV).toBe("staging");
  });

  it("refuses a live payment key on staging", () => {
    // THE reason this split exists. Keyed on NODE_ENV, a production build on staging
    // looked like production and a live key sailed through the one check that matters.
    expect(() =>
      loadEnv({
        ...staging,
        APP_ENV: "staging",
        MIDTRANS_SERVER_KEY: LIVE_KEY,
      } as NodeJS.ProcessEnv),
    ).toThrow(SecretRuleError);
  });

  it("still accepts a sandbox key on staging", () => {
    expect(() =>
      loadEnv({
        ...staging,
        APP_ENV: "staging",
        MIDTRANS_SERVER_KEY: SANDBOX_KEY,
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it("rejects an APP_ENV outside the four docs/DEVOPS/00 names", () => {
    expect(() =>
      loadEnv({ ...staging, APP_ENV: "uat" } as NodeJS.ProcessEnv),
    ).toThrow();
  });
});

describe("loadEnv enforces the rules, not just the fields", () => {
  it("refuses to load a live key outside production", () => {
    // End to end: the rules are not a library nobody calls. loadEnv is what main.ts
    // runs before anything else is constructed.
    expect(() =>
      loadEnv({
        // Both axes. `loadEnv` validates the build mode too, and APP_ENV defaults to it
        // when absent -- these set it explicitly so the test says which one it means.
        NODE_ENV: "development",
        APP_ENV: "development",
        APP_ORIGIN: "http://localhost:3100",
        PUBLIC_INVITE_ORIGIN: "http://localhost:3200",
        ADMIN_ORIGIN: "http://localhost:3300",
        DATABASE_URL: "postgres://wedding_app:pw@localhost:5432/wedding",
        REDIS_URL: "redis://localhost:6379",
        MIDTRANS_SERVER_KEY: LIVE_KEY,
      } as NodeJS.ProcessEnv),
    ).toThrow(SecretRuleError);
  });

  it("loads a valid development environment", () => {
    expect(() =>
      loadEnv({
        // Both axes. `loadEnv` validates the build mode too, and APP_ENV defaults to it
        // when absent -- these set it explicitly so the test says which one it means.
        NODE_ENV: "development",
        APP_ENV: "development",
        APP_ORIGIN: "http://localhost:3100",
        PUBLIC_INVITE_ORIGIN: "http://localhost:3200",
        ADMIN_ORIGIN: "http://localhost:3300",
        DATABASE_URL: "postgres://wedding_app:pw@localhost:5432/wedding",
        REDIS_URL: "redis://localhost:6379",
        MIDTRANS_SERVER_KEY: SANDBOX_KEY,
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});
