import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import {
  SessionService,
  type AuthenticatedUser,
} from "../src/modules/auth/session.service";
import { LoginService } from "../src/modules/auth/login.service";
import {
  signAccessToken,
  verifyAccessToken,
} from "../src/modules/auth/tokens/access-token.service";
import type { Database } from "../src/infra/db/client";
import type { Env } from "../src/config/env.schema";
import { UnauthenticatedError } from "../src/http/errors";
import { GoogleOAuthService } from "../src/modules/auth/oauth/google-oauth.service";

const refresh = vi.hoisted(() => ({
  issueRefreshToken: vi.fn(),
  rotateRefreshToken: vi.fn(),
  revokeRefreshToken: vi.fn(),
  ADMIN_SESSION_TTL_MS: 4 * 60 * 60 * 1000,
}));
vi.mock("../src/modules/auth/tokens/refresh-token.service", () => refresh);

const env = {
  JWT_SIGNING_KEY: "mfa-session-test-key-at-least-32-characters",
  REFRESH_TOKEN_PEPPER: "mfa-session-test-pepper-at-least-32-characters",
} as Env;
const db = {} as Database;
const user = (role = "admin"): AuthenticatedUser => ({
  id: "9b396864-6659-45f2-a428-d7263fd58c3e",
  email: "admin@example.test",
  fullName: "Test Admin",
  role,
  emailVerified: true,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("P5-14 admin session MFA provenance", () => {
  it("requires MFA for a returning Google administrator before issuing any credentials", async () => {
    const database = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ ...user(), status: "active" }]),
          }),
        }),
      }),
    } as unknown as Database;
    const mfa = {
      hasConfirmedFactor: vi.fn().mockResolvedValue(true),
      signMfaTicket: vi.fn().mockResolvedValue("google-mfa-ticket"),
    };
    const login = new LoginService(
      database,
      env,
      {} as SessionService,
      mfa as never,
    );
    const oauth = new GoogleOAuthService(
      database,
      {
        verify: vi.fn().mockResolvedValue({
          subjectId: "google-subject",
          email: user().email,
          emailVerified: true,
        }),
      },
      login,
    );
    const result = await oauth.authenticate("verified-by-google");
    expect(result.session).toMatchObject({
      requiresMfa: true,
      isEnrolled: true,
      ticket: "google-mfa-ticket",
    });
    expect(result.session).not.toHaveProperty("accessToken");
    expect(refresh.issueRefreshToken).not.toHaveBeenCalled();
  });

  it("persists original MFA proof and clamps a real refresh rotation to its absolute expiry", async () => {
    const actual = await vi.importActual<
      typeof import("../src/modules/auth/tokens/refresh-token.service")
    >("../src/modules/auth/tokens/refresh-token.service");
    const verified = new Date(Date.now() - 60 * 60 * 1000);
    const now = new Date();
    const values = vi.fn().mockResolvedValue(undefined);
    const tx = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue([
                { userId: user().id, mfaVerifiedAt: verified },
              ]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values }),
    };
    const database = {
      transaction: vi.fn(
        async (callback: (transaction: typeof tx) => unknown) => callback(tx),
      ),
    };
    const result = await actual.rotateRefreshToken(
      database as unknown as Database,
      env.REFRESH_TOKEN_PEPPER,
      "old-refresh",
      now,
    );
    const expiresAt = new Date(verified.getTime() + 4 * 60 * 60 * 1000);
    expect(result).toMatchObject({
      status: "ok",
      mfaVerifiedAt: verified,
      issued: { expiresAt },
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user().id,
        mfaVerifiedAt: verified,
        expiresAt,
      }),
    );
    expect(expiresAt.getTime() - now.getTime()).toBeLessThan(
      4 * 60 * 60 * 1000,
    );
  });

  it.each(["yesterday", -1, 1.5, Math.floor(Date.now() / 1000) + 3600])(
    "rejects malformed or future signed MFA claim %s",
    async (proof) => {
      const token = await new SignJWT({
        role: "admin",
        email_verified: true,
        mfa_verified_at: proof,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(user().id)
        .setIssuer("wedding-invitation")
        .setAudience("wedding-invitation-api")
        .setIssuedAt()
        .setExpirationTime("15m")
        .sign(new TextEncoder().encode(env.JWT_SIGNING_KEY));
      await expect(
        verifyAccessToken(env.JWT_SIGNING_KEY, token),
      ).rejects.toThrow();
    },
  );
  it.each(["admin", "super_admin"])(
    "rejects %s access without proof even after role promotion",
    async (role) => {
      const sessions = new SessionService(db, env);
      vi.spyOn(sessions, "loadActiveUser").mockResolvedValue(user(role));
      const token = await signAccessToken(env.JWT_SIGNING_KEY, {
        userId: user().id,
        role: "user",
        emailVerified: true,
      });
      await expect(
        sessions.authenticate(`Bearer ${token}`),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
    },
  );

  it("accepts fresh signed proof and rejects proof at the absolute four-hour limit", async () => {
    const sessions = new SessionService(db, env);
    vi.spyOn(sessions, "loadActiveUser").mockResolvedValue(user());
    const now = Math.floor(Date.now() / 1000);
    for (const age of [60, 4 * 60 * 60]) {
      const token = await signAccessToken(env.JWT_SIGNING_KEY, {
        userId: user().id,
        role: "admin",
        emailVerified: true,
        mfaVerifiedAt: now - age,
      });
      if (age === 60) {
        expect(
          (await verifyAccessToken(env.JWT_SIGNING_KEY, token)).mfaVerifiedAt,
        ).toBe(now - age);
        await expect(sessions.authenticate(`Bearer ${token}`)).resolves.toEqual(
          user(),
        );
      } else
        await expect(
          sessions.authenticate(`Bearer ${token}`),
        ).rejects.toBeInstanceOf(UnauthenticatedError);
    }
  });

  it("keeps ordinary user authentication available without MFA", async () => {
    const sessions = new SessionService(db, env);
    vi.spyOn(sessions, "loadActiveUser").mockResolvedValue(user("user"));
    const token = await signAccessToken(env.JWT_SIGNING_KEY, {
      userId: user().id,
      role: "user",
      emailVerified: true,
    });
    await expect(sessions.authenticate(`Bearer ${token}`)).resolves.toEqual(
      user("user"),
    );
  });

  it.each(["admin", "super_admin"])(
    "refuses direct %s session issuance without MFA",
    async (role) => {
      const login = new LoginService(db, env, {} as SessionService);
      await expect(login.issueSession(user(role))).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
      expect(refresh.issueRefreshToken).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "routes enrolled=%s admin through the shared MFA login gate",
    async (enrolled) => {
      const mfa = {
        hasConfirmedFactor: vi.fn().mockResolvedValue(enrolled),
        signMfaTicket: vi.fn().mockResolvedValue("signed-ticket"),
      };
      const login = new LoginService(
        db,
        env,
        {} as SessionService,
        mfa as never,
      );
      await expect(login.issueLogin(user())).resolves.toMatchObject({
        requiresMfa: true,
        isEnrolled: enrolled,
        ticket: "signed-ticket",
      });
      expect(mfa.signMfaTicket).toHaveBeenCalledWith(
        user().id,
        user().email,
        "admin",
        enrolled ? "challenge" : "setup",
      );
      expect(refresh.issueRefreshToken).not.toHaveBeenCalled();
    },
  );

  it("records successful MFA in both access and refresh credentials", async () => {
    const verified = new Date(Date.now() - 1000);
    const issued = {
      token: "refresh",
      expiresAt: new Date(verified.getTime() + refresh.ADMIN_SESSION_TTL_MS),
    };
    refresh.issueRefreshToken.mockResolvedValue(issued);
    const login = new LoginService(db, env, {} as SessionService);
    const session = await login.issueSession(user(), verified);
    expect(refresh.issueRefreshToken).toHaveBeenCalledWith(
      db,
      env.REFRESH_TOKEN_PEPPER,
      user().id,
      expect.any(Date),
      verified,
    );
    expect(
      (await verifyAccessToken(env.JWT_SIGNING_KEY, session.accessToken))
        .mfaVerifiedAt,
    ).toBe(Math.floor(verified.getTime() / 1000));
  });

  it.each([null, new Date(Date.now() - 4 * 60 * 60 * 1000)])(
    "revokes an unverified or expired admin refresh successor",
    async (mfaVerifiedAt) => {
      refresh.rotateRefreshToken.mockResolvedValue({
        status: "ok",
        userId: user().id,
        mfaVerifiedAt,
        issued: { token: "successor", expiresAt: new Date() },
      });
      const sessions = { loadActiveUser: vi.fn().mockResolvedValue(user()) };
      const login = new LoginService(
        db,
        env,
        sessions as unknown as SessionService,
      );
      await expect(login.refresh("old-refresh")).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
      expect(refresh.revokeRefreshToken).toHaveBeenCalledWith(
        db,
        env.REFRESH_TOKEN_PEPPER,
        "successor",
      );
    },
  );

  it("preserves original proof when refreshing instead of renewing the MFA lifetime", async () => {
    const verified = new Date(Date.now() - 60_000);
    refresh.rotateRefreshToken.mockResolvedValue({
      status: "ok",
      userId: user().id,
      mfaVerifiedAt: verified,
      issued: {
        token: "successor",
        expiresAt: new Date(verified.getTime() + refresh.ADMIN_SESSION_TTL_MS),
      },
    });
    const sessions = { loadActiveUser: vi.fn().mockResolvedValue(user()) };
    const login = new LoginService(
      db,
      env,
      sessions as unknown as SessionService,
    );
    const session = await login.refresh("old-refresh");
    expect(
      (await verifyAccessToken(env.JWT_SIGNING_KEY, session.accessToken))
        .mfaVerifiedAt,
    ).toBe(Math.floor(verified.getTime() / 1000));
    expect(refresh.revokeRefreshToken).not.toHaveBeenCalled();
  });
});
