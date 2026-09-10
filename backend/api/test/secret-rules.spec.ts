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
  NODE_ENV: "production",
  APP_ORIGIN: "https://app.zedth.my.id",
  PUBLIC_INVITE_ORIGIN: "https://invitation.zedth.my.id",
  ADMIN_ORIGIN: "https://admin.zedth.my.id",
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
    "refuses a live key when NODE_ENV is %s",
    (env) => {
      // The rule this file exists for. docs/DEVOPS/00: staging uses sandbox
      // credentials. A live key here charges real cards from a test.
      const violations = checkSecretRules({
        ...base,
        NODE_ENV: env,
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
        NODE_ENV: "staging",
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
      NODE_ENV: "staging",
      MIDTRANS_CLIENT_KEY: "Mid-client-example-not-a-real-key",
    });
    expect(violations.map((v) => v.variable)).toContain("MIDTRANS_CLIENT_KEY");
  });

  it("says nothing when no payment key is configured", () => {
    // Absent is fine -- payment arrives in P3-03. Only a present, wrong key is an error.
    expect(checkSecretRules({ ...base, NODE_ENV: "development" })).toEqual([]);
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
        NODE_ENV: "development",
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

describe("loadEnv enforces the rules, not just the fields", () => {
  it("refuses to load a live key outside production", () => {
    // End to end: the rules are not a library nobody calls. loadEnv is what main.ts
    // runs before anything else is constructed.
    expect(() =>
      loadEnv({
        NODE_ENV: "development",
        APP_ORIGIN: "http://localhost:3001",
        PUBLIC_INVITE_ORIGIN: "http://localhost:3002",
        ADMIN_ORIGIN: "http://localhost:3003",
        DATABASE_URL: "postgres://wedding_app:pw@localhost:5432/wedding",
        MIDTRANS_SERVER_KEY: LIVE_KEY,
      } as NodeJS.ProcessEnv),
    ).toThrow(SecretRuleError);
  });

  it("loads a valid development environment", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "development",
        APP_ORIGIN: "http://localhost:3001",
        PUBLIC_INVITE_ORIGIN: "http://localhost:3002",
        ADMIN_ORIGIN: "http://localhost:3003",
        DATABASE_URL: "postgres://wedding_app:pw@localhost:5432/wedding",
        MIDTRANS_SERVER_KEY: SANDBOX_KEY,
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});
