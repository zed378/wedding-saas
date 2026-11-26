import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Env } from "../../src/config/env.schema";
import { users, refreshTokens } from "../../src/infra/db/schema/users";
import { LoginService } from "../../src/modules/auth/login.service";
import { SessionService } from "../../src/modules/auth/session.service";
import { GoogleOAuthService } from "../../src/modules/auth/oauth/google-oauth.service";
import {
  issueRefreshToken,
  ADMIN_SESSION_TTL_MS,
} from "../../src/modules/auth/tokens/refresh-token.service";
import { verifyAccessToken } from "../../src/modules/auth/tokens/access-token.service";
import { startHarness, resetDatabase, type Harness } from "../support/harness";

const env = {
  JWT_SIGNING_KEY: "admin-mfa-integration-signing-key-at-least-32",
  REFRESH_TOKEN_PEPPER: "admin-mfa-integration-refresh-pepper-at-least-32",
} as Env;

describe("P5-14 persisted administrative MFA sessions", () => {
  let harness: Harness;
  let sessions: SessionService;
  let logins: LoginService;
  beforeAll(async () => {
    harness = await startHarness();
    sessions = new SessionService(harness.db, env);
    logins = new LoginService(harness.db, env, sessions);
  }, 120_000);
  afterAll(async () => {
    await harness?.stop();
  });
  beforeEach(async () => {
    await resetDatabase(harness.pool);
  });

  async function account(role: "admin" | "user" = "admin") {
    const [row] = await harness.db
      .insert(users)
      .values({
        email: "mfa-session@example.test",
        fullName: "MFA test",
        role,
        emailVerified: true,
        oauthProvider: "google",
        oauthSubjectId: "mfa-google-subject",
      })
      .returning();
    return row!;
  }

  it("preserves the original MFA proof and expiry through two real database rotations", async () => {
    const user = await account();
    const verified = new Date(Date.now() - 60_000);
    const initial = await logins.issueSession(user, verified);
    const second = await logins.refresh(initial.refresh.token);
    const third = await logins.refresh(second.refresh.token);
    const rows = await harness.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user.id));
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);
    for (const row of rows) {
      expect(row.mfaVerifiedAt).toEqual(verified);
      expect(row.expiresAt.getTime()).toBe(
        verified.getTime() + ADMIN_SESSION_TTL_MS,
      );
    }
    expect(
      (await verifyAccessToken(env.JWT_SIGNING_KEY, third.accessToken))
        .mfaVerifiedAt,
    ).toBe(Math.floor(verified.getTime() / 1000));
    await expect(
      sessions.authenticate(`Bearer ${third.accessToken}`),
    ).resolves.toMatchObject({ id: user.id, role: "admin" });
  });

  it("cannot promote a pre-MFA user session through access or refresh", async () => {
    const user = await account("user");
    const original = await logins.issueSession(user);
    await harness.db
      .update(users)
      .set({ role: "admin" })
      .where(eq(users.id, user.id));
    await expect(
      sessions.authenticate(`Bearer ${original.accessToken}`),
    ).rejects.toMatchObject({ status: 401 });
    await expect(logins.refresh(original.refresh.token)).rejects.toMatchObject({
      status: 401,
    });
    const rows = await harness.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user.id));
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it("rejects legacy administrator refresh rows without MFA provenance", async () => {
    const user = await account();
    const legacy = await issueRefreshToken(
      harness.db,
      env.REFRESH_TOKEN_PEPPER,
      user.id,
    );
    await expect(logins.refresh(legacy.token)).rejects.toMatchObject({
      status: 401,
    });
    const rows = await harness.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user.id));
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it("Google admin authentication returns setup ticket and creates no refresh credential", async () => {
    const user = await account();
    const oauth = new GoogleOAuthService(
      harness.db,
      {
        verify: async () => ({
          subjectId: "mfa-google-subject",
          email: user.email,
          emailVerified: true,
          name: "MFA test",
        }),
      },
      logins,
    );
    const result = await oauth.authenticate("opaque-google-token");
    expect(result.session).toMatchObject({
      requiresMfa: true,
      isEnrolled: false,
    });
    expect(result.session).not.toHaveProperty("accessToken");
    expect(await harness.db.select().from(refreshTokens)).toHaveLength(0);
  });
});
