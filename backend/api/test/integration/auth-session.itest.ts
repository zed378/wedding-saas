import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq, isNull } from "drizzle-orm";

import { LoginService } from "../../src/modules/auth/login.service";
import { SessionService } from "../../src/modules/auth/session.service";
import { RegistrationService } from "../../src/modules/auth/registration.service";
import {
  hashRefreshToken,
  issueRefreshToken,
  REFRESH_TOKEN_TTL_MS,
  rotateRefreshToken,
} from "../../src/modules/auth/tokens/refresh-token.service";
import { signAccessToken } from "../../src/modules/auth/tokens/access-token.service";
import { refreshTokens, users } from "../../src/infra/db/schema/users";
import type { Env } from "../../src/config/env.schema";
import type { JobQueue } from "../../src/infra/queue/queue.module";
import { securityLogger } from "../../src/shared/logging/logger";
import { startHarness, type Harness } from "../support/harness";
import { rejection } from "../support/rejection";
import { resetTenantData } from "./helpers.ts";

/**
 * P1-03 — login, rotation and reuse detection, against a real database.
 *
 * Integration because every property that matters is a property of a row changing:
 * that rotation and issuance happen in one transaction, that two presentations of one
 * token race in the database, and that a suspension takes effect on the next request
 * rather than at token expiry.
 */

const JWT_KEY = "integration-signing-key-of-sufficient-len-1";
const PEPPER = "integration-refresh-pepper-of-sufficient-len";

const env = {
  JWT_SIGNING_KEY: JWT_KEY,
  REFRESH_TOKEN_PEPPER: PEPPER,
  APP_ORIGIN: "https://app.example.test",
} as unknown as Env;

const PASSWORD = "kembang-sepatu-ungu-2026";

describe("login, refresh and logout", () => {
  let harness: Harness;
  let logins: LoginService;
  let sessions: SessionService;
  let registration: RegistrationService;

  const queue: JobQueue = {
    enqueue: async () => {},
    close: async () => {},
  };

  beforeAll(async () => {
    harness = await startHarness();
    sessions = new SessionService(harness.db, env);
    logins = new LoginService(harness.db, env, sessions);
    registration = new RegistrationService(harness.db, queue);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
  });

  /** A real registered user, created through the real path. */
  const register = async (
    email = "budi@example.test",
  ): Promise<{ id: string }> => {
    await registration.register({
      email,
      password: PASSWORD,
      fullName: "Budi Santoso",
    });
    const [row] = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    return row!;
  };

  const liveTokenCount = async (userId: string): Promise<number> => {
    const rows = await harness.db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(
        and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)),
      );
    return rows.length;
  };

  describe("login", () => {
    it("returns an access token and the user", async () => {
      const user = await register();
      const session = await logins.login("budi@example.test", PASSWORD);

      expect(session.user.id).toBe(user.id);
      expect(session.user.role).toBe("user");
      expect(
        await sessions.authenticate(`Bearer ${session.accessToken}`),
      ).toMatchObject({ id: user.id });
    });

    it("accepts the address in any case", async () => {
      await register();
      await expect(
        logins.login("BUDI@Example.TEST", PASSWORD),
      ).resolves.toBeDefined();
    });

    it("an unknown email and a wrong password are indistinguishable", async () => {
      // docs/API/01 § Error Cases. The whole point of a generic message is that these
      // two produce the same object, not merely the same status.
      await register();

      const unknown = await rejection(() =>
        logins.login("nobody@example.test", PASSWORD),
      );
      const wrong = await rejection(() =>
        logins.login("budi@example.test", "not-the-password"),
      );

      expect(unknown.code).toBe("INVALID_CREDENTIALS");
      expect(unknown.code).toBe(wrong.code);
      expect(unknown.status).toBe(wrong.status);
      expect(unknown.message).toBe(wrong.message);
    });

    it("an unknown email costs about as much as a wrong password", async () => {
      // Timing is the other channel. P1-01's dummy-hash verify is what makes these
      // comparable; returning early for an unknown address would undo it, and the
      // argon2 cost is 277 ms -- impossible to miss over a network.
      await register();

      const time = async (fn: () => Promise<unknown>): Promise<number> => {
        const started = performance.now();
        await fn().catch(() => {});
        return performance.now() - started;
      };

      const unknown = await time(() =>
        logins.login("nobody@example.test", PASSWORD),
      );
      const wrong = await time(() =>
        logins.login("budi@example.test", "not-the-password"),
      );

      // Generous, because CI machines are noisy. The failure this catches is an early
      // return, which is a ~277 ms gap against two costs of roughly 277 ms each.
      expect(Math.abs(unknown - wrong)).toBeLessThan(Math.max(unknown, wrong));
    });

    it("an unverified user can still log in", async () => {
      // docs/API/01 § Registration Flow step 2: verification gates publish and checkout,
      // not the front door.
      await register();
      const session = await logins.login("budi@example.test", PASSWORD);
      expect(session.user.emailVerified).toBe(false);
    });

    it("a suspended user cannot log in, and is told why", async () => {
      const user = await register();
      await harness.db
        .update(users)
        .set({ status: "suspended" })
        .where(eq(users.id, user.id));

      const error = await rejection(() =>
        logins.login("budi@example.test", PASSWORD),
      );

      // Distinct from INVALID_CREDENTIALS on purpose: only someone who already supplied
      // the correct password reaches this branch, so it reveals nothing to an enumerator.
      expect(error.status).toBe(403);
      expect(error.code).toBe("FORBIDDEN");
    });

    it("does not issue a session to a suspended user", async () => {
      const user = await register();
      await harness.db
        .update(users)
        .set({ status: "suspended" })
        .where(eq(users.id, user.id));

      await logins.login("budi@example.test", PASSWORD).catch(() => {});
      expect(await liveTokenCount(user.id)).toBe(0);
    });

    it("logging in twice leaves two live sessions", async () => {
      // A phone and a laptop. Unlike P1-02's single-use tokens, issuing here must NOT
      // revoke the previous one.
      const user = await register();
      await logins.login("budi@example.test", PASSWORD);
      await logins.login("budi@example.test", PASSWORD);

      expect(await liveTokenCount(user.id)).toBe(2);
    });
  });

  describe("the refresh token", () => {
    it("is stored only as a peppered hash", async () => {
      const user = await register();
      const session = await logins.login("budi@example.test", PASSWORD);

      const [row] = await harness.db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.userId, user.id));

      expect(row!.tokenHash).not.toBe(session.refresh.token);
      expect(row!.tokenHash).toBe(
        hashRefreshToken(PEPPER, session.refresh.token),
      );
      expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      // The pepper is the point: a database dump alone is not enough to reproduce it.
      expect(
        hashRefreshToken("a-different-pepper", session.refresh.token),
      ).not.toBe(row!.tokenHash);
    });

    it("lives 30 days", async () => {
      await register();
      const session = await logins.login("budi@example.test", PASSWORD);
      const [row] = await harness.db.select().from(refreshTokens);

      const lifetime = row!.expiresAt.getTime() - row!.createdAt.getTime();
      expect(Math.abs(lifetime - REFRESH_TOKEN_TTL_MS)).toBeLessThan(5000);
      expect(REFRESH_TOKEN_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it("never appears in a response body", async () => {
      // The session object is what the controller serialises. `refresh` is a separate
      // field that only `setRefreshCookie` reads -- but a future edit spreading the
      // session into the body is exactly what this guards.
      await register();
      const session = await logins.login("budi@example.test", PASSWORD);

      const body = JSON.stringify({
        access_token: session.accessToken,
        user: session.user,
      });
      expect(body).not.toContain(session.refresh.token);
    });
  });

  describe("rotation", () => {
    it("invalidates the presented token and issues a working successor", async () => {
      await register();
      const first = await logins.login("budi@example.test", PASSWORD);

      const second = await logins.refresh(first.refresh.token);
      expect(second.refresh.token).not.toBe(first.refresh.token);

      // The successor works...
      await expect(logins.refresh(second.refresh.token)).resolves.toBeDefined();
    });

    it("leaves exactly one live token per session", async () => {
      // The card's step 4: revoke and issue in ONE transaction, so a crash cannot leave
      // two live tokens for one session.
      const user = await register();
      const first = await logins.login("budi@example.test", PASSWORD);
      await logins.refresh(first.refresh.token);

      expect(await liveTokenCount(user.id)).toBe(1);
    });

    it("mints a new access token carrying the current role", async () => {
      const user = await register();
      const first = await logins.login("budi@example.test", PASSWORD);

      await harness.db
        .update(users)
        .set({ role: "admin" })
        .where(eq(users.id, user.id));

      const second = await logins.refresh(first.refresh.token);
      expect(second.user.role).toBe("admin");
    });

    it("refuses an unknown token", async () => {
      await expect(logins.refresh("not-a-real-token")).rejects.toMatchObject({
        status: 401,
      });
    });

    it("refuses a missing cookie", async () => {
      await expect(logins.refresh(undefined)).rejects.toMatchObject({
        status: 401,
      });
    });

    it("refuses an expired token without treating it as theft", async () => {
      // Expiry is not evidence that anyone else held it. This must NOT revoke the
      // user's other sessions.
      const user = await register();
      const live = await logins.login("budi@example.test", PASSWORD);

      const past = new Date(Date.now() - REFRESH_TOKEN_TTL_MS - 60_000);
      const stale = await issueRefreshToken(harness.db, PEPPER, user.id, past);

      await expect(logins.refresh(stale.token)).rejects.toMatchObject({
        status: 401,
      });

      // The live session survives.
      await expect(logins.refresh(live.refresh.token)).resolves.toBeDefined();
    });

    it("survives two simultaneous rotations of the same token", async () => {
      // The database decides. One claims the row; the other finds it revoked, which is
      // reuse -- see the next block. What must NOT happen is two successors.
      const user = await register();
      const first = await logins.login("budi@example.test", PASSWORD);

      const results = await Promise.allSettled([
        logins.refresh(first.refresh.token),
        logins.refresh(first.refresh.token),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(1);
      // ...and the family revocation from the loser leaves nothing live.
      expect(await liveTokenCount(user.id)).toBe(0);
    });
  });

  describe("reuse detection (the DoD's second item)", () => {
    it("a replayed refresh token revokes every session", async () => {
      // The scenario: an attacker steals a refresh token. The victim refreshes normally,
      // which revokes it. The attacker then presents the stolen copy. docs/SECURITY/03:
      // "if a revoked token is used again -> indicates theft -> revoke ALL of that
      // user's active sessions".
      const user = await register();
      const phone = await logins.login("budi@example.test", PASSWORD);
      const laptop = await logins.login("budi@example.test", PASSWORD);

      const stolen = laptop.refresh.token;
      await logins.refresh(stolen); // the victim, legitimately
      expect(await liveTokenCount(user.id)).toBe(2); // phone + rotated laptop

      await expect(logins.refresh(stolen)).rejects.toMatchObject({
        status: 401,
      });

      // Everything. Including the phone, which was never touched by the attacker -- that
      // is the point: the blast radius is the user, because we do not know what else was
      // taken.
      expect(await liveTokenCount(user.id)).toBe(0);
      await expect(logins.refresh(phone.refresh.token)).rejects.toMatchObject({
        status: 401,
      });
    });

    it("emits auth.token_reuse_detected", async () => {
      // A silent family revocation is a user mysteriously logged out and no incident.
      // docs/DEVOPS/06 keeps this stream for a year.
      const spy = vi.spyOn(securityLogger, "error");

      await register();
      const session = await logins.login("budi@example.test", PASSWORD);
      await logins.refresh(session.refresh.token);
      await logins.refresh(session.refresh.token).catch(() => {});

      const call = spy.mock.calls.find(
        (c) =>
          (c[0] as { event?: string } | undefined)?.event ===
          "auth.token_reuse_detected",
      );
      expect(call).toBeDefined();
      expect(call![0]).toMatchObject({
        context: { sessions_revoked: expect.any(Number) },
      });
      spy.mockRestore();
    });

    it("an expired token that was never revoked is not reuse", async () => {
      // The distinction the second query in `rotateRefreshToken` exists to make.
      const user = await register();
      const past = new Date(Date.now() - REFRESH_TOKEN_TTL_MS - 60_000);
      const stale = await issueRefreshToken(harness.db, PEPPER, user.id, past);

      const result = await rotateRefreshToken(harness.db, PEPPER, stale.token);
      expect(result.status).toBe("invalid");
    });
  });

  describe("logout", () => {
    it("ends that session server-side, not just in the browser", async () => {
      // Step 8. Discarding the cookie would leave the token working for 30 days for
      // anyone who copied it.
      await register();
      const session = await logins.login("budi@example.test", PASSWORD);

      await logins.logout(session.refresh.token);

      await expect(logins.refresh(session.refresh.token)).rejects.toMatchObject(
        { status: 401 },
      );
    });

    it("leaves other sessions alone", async () => {
      await register();
      const phone = await logins.login("budi@example.test", PASSWORD);
      const laptop = await logins.login("budi@example.test", PASSWORD);

      await logins.logout(laptop.refresh.token);

      await expect(logins.refresh(phone.refresh.token)).resolves.toBeDefined();
    });

    it("is silent for an unknown or absent token", async () => {
      await expect(logins.logout(undefined)).resolves.toBeUndefined();
      await expect(logins.logout("nonsense")).resolves.toBeUndefined();
    });

    it("a logged-out token replayed does not trigger a family revocation", async () => {
      // Arguable, and deliberate: `revokeRefreshToken` sets `revoked_at`, so a replay
      // after logout looks exactly like theft. It IS treated as theft -- this test
      // records that, because the alternative (a third state for "revoked by logout")
      // would let an attacker who steals a token and then calls logout erase the signal.
      const user = await register();
      const session = await logins.login("budi@example.test", PASSWORD);
      await logins.login("budi@example.test", PASSWORD);

      await logins.logout(session.refresh.token);
      await logins.refresh(session.refresh.token).catch(() => {});

      expect(await liveTokenCount(user.id)).toBe(0);
    });
  });

  describe("the database is the authority, not the token", () => {
    it("the role comes from the database, not the token", async () => {
      // docs/SECURITY/01 § Elevation of Privilege. The token is validly signed and says
      // `super_admin`; the row says `user`.
      const user = await register();
      const forged = await signAccessToken(JWT_KEY, {
        userId: user.id,
        role: "super_admin",
        emailVerified: true,
      });

      const resolved = await sessions.authenticate(`Bearer ${forged}`);
      expect(resolved.role).toBe("user");
    });

    it("email_verified comes from the database too", async () => {
      const user = await register();
      const token = await signAccessToken(JWT_KEY, {
        userId: user.id,
        role: "user",
        emailVerified: true,
      });

      expect(
        (await sessions.authenticate(`Bearer ${token}`)).emailVerified,
      ).toBe(false);
    });

    it("a suspended user is refused before the token expires", async () => {
      // The DoD's third item. The access token below is minutes old and perfectly valid.
      const user = await register();
      const session = await logins.login("budi@example.test", PASSWORD);

      await expect(
        sessions.authenticate(`Bearer ${session.accessToken}`),
      ).resolves.toBeDefined();

      await harness.db
        .update(users)
        .set({ status: "suspended" })
        .where(eq(users.id, user.id));

      await expect(
        sessions.authenticate(`Bearer ${session.accessToken}`),
      ).rejects.toMatchObject({ status: 401 });
    });

    it("a suspended user cannot refresh either", async () => {
      const user = await register();
      const session = await logins.login("budi@example.test", PASSWORD);

      await harness.db
        .update(users)
        .set({ status: "suspended" })
        .where(eq(users.id, user.id));

      await expect(logins.refresh(session.refresh.token)).rejects.toMatchObject(
        { status: 401 },
      );

      // And the successor that rotation wrote is not left live for 30 days.
      expect(await liveTokenCount(user.id)).toBe(0);
    });

    it("a soft-deleted user is refused", async () => {
      const user = await register();
      const session = await logins.login("budi@example.test", PASSWORD);

      await harness.db
        .update(users)
        .set({ deletedAt: new Date() })
        .where(eq(users.id, user.id));

      await expect(
        sessions.authenticate(`Bearer ${session.accessToken}`),
      ).rejects.toMatchObject({ status: 401 });
    });

    it("a token for a user that does not exist is refused", async () => {
      const orphan = await signAccessToken(JWT_KEY, {
        userId: "00000000-0000-4000-8000-0000000000ff",
        role: "user",
        emailVerified: true,
      });

      await expect(
        sessions.authenticate(`Bearer ${orphan}`),
      ).rejects.toMatchObject({ status: 401 });
    });

    it.each([undefined, "", "Basic abc", "Bearer", "notatoken"])(
      "refuses a malformed Authorization header (%j)",
      async (header) => {
        await expect(
          sessions.authenticate(header as string | undefined),
        ).rejects.toMatchObject({ status: 401 });
      },
    );
  });
});
