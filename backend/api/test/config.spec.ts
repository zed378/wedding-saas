import { describe, expect, it } from "vitest";
import { ConfigValidationError, loadEnv } from "../src/config/env.schema";

const valid = {
  NODE_ENV: "test",
  PORT: "3000",
  APP_ORIGIN: "https://app.vizunicum.my.id",
  PUBLIC_INVITE_ORIGIN: "https://invitation.vizunicum.my.id",
  ADMIN_ORIGIN: "https://admin.vizunicum.my.id",
  // The application role, not the owner. Migrations validate their own URL
  // separately in src/infra/db/env.mts (P0-06).
  DATABASE_URL: "postgres://wedding_app:pw@localhost:5432/wedding",
} as NodeJS.ProcessEnv;

describe("configuration", () => {
  it("accepts a valid environment and coerces types", () => {
    const env = loadEnv(valid);
    expect(env.NODE_ENV).toBe("test");
    expect(env.PORT).toBe(3000); // coerced to a number, not left as a string
  });

  it("refuses to start when a required variable is missing, and names it", () => {
    const { APP_ORIGIN: _omitted, ...withoutOrigin } = valid;

    expect(() => loadEnv(withoutOrigin)).toThrow(ConfigValidationError);

    // Naming the variable is the point: the failure has to tell an operator what to fix.
    try {
      loadEnv(withoutOrigin);
      expect.unreachable("loadEnv should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect((error as ConfigValidationError).message).toContain("APP_ORIGIN");
      expect((error as ConfigValidationError).message).toContain(
        "refusing to start",
      );
    }
  });

  it("reports every offending variable at once, not one per restart", () => {
    const broken = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
    try {
      loadEnv(broken);
      expect.unreachable("loadEnv should have thrown");
    } catch (error) {
      const issues = (error as ConfigValidationError).issues;
      expect(issues.length).toBeGreaterThanOrEqual(3);
      expect(issues.join("\n")).toContain("APP_ORIGIN");
      expect(issues.join("\n")).toContain("PUBLIC_INVITE_ORIGIN");
      expect(issues.join("\n")).toContain("ADMIN_ORIGIN");
    }
  });

  it("rejects a malformed value rather than coercing it into nonsense", () => {
    expect(() => loadEnv({ ...valid, APP_ORIGIN: "not-a-url" })).toThrow(
      ConfigValidationError,
    );
    expect(() => loadEnv({ ...valid, NODE_ENV: "staging" })).toThrow(
      ConfigValidationError,
    );
    expect(() => loadEnv({ ...valid, PORT: "70000" })).toThrow(
      ConfigValidationError,
    );
  });

  it("returns a frozen object so nothing can rewrite configuration at runtime", () => {
    const env = loadEnv(valid);
    expect(Object.isFrozen(env)).toBe(true);
  });
});
