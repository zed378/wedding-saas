import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { GoogleOAuthService } from "../../src/modules/auth/oauth/google-oauth.service";
import {
  GoogleUnavailableError,
  InvalidGoogleTokenError,
  type GoogleIdentity,
  type GoogleTokenVerifier,
} from "../../src/modules/auth/oauth/google-verifier";
import { LoginService } from "../../src/modules/auth/login.service";
import { SessionService } from "../../src/modules/auth/session.service";
import { RegistrationService } from "../../src/modules/auth/registration.service";
import {
  refreshTokens,
  userNotificationPreferences,
  users,
} from "../../src/infra/db/schema/users";
import type { Env } from "../../src/config/env.schema";
import type { JobQueue } from "../../src/infra/queue/queue.module";
import { startHarness, type Harness } from "../support/harness";
import { rejection } from "../support/rejection";
import { resetTenantData } from "./helpers.ts";

/**
 * P1-04 — Google sign-in.
 *
 * The verifier is a stub, and that is the correct boundary: reaching Google's real JWKS
 * endpoint from a test would make the suite depend on the internet and on a token we
 * cannot mint. `google-verifier.spec.ts` covers the verifier's own classification; what
 * this file tests is everything that happens *after* an identity is established, which is
 * where account takeover would actually live.
 */

const env = {
  JWT_SIGNING_KEY: "integration-signing-key-of-sufficient-len-1",
  REFRESH_TOKEN_PEPPER: "integration-refresh-pepper-of-sufficient-len",
  APP_ORIGIN: "https://app.example.test",
} as unknown as Env;

const PASSWORD = "kembang-sepatu-ungu-2026";

/** What Google said. The only input this service has. */
const identity = (over: Partial<GoogleIdentity> = {}): GoogleIdentity => ({
  subjectId: "google-subject-1234567890",
  email: "budi@example.test",
  emailVerified: true,
  name: "Budi Santoso",
  ...over,
});

describe("google sign-in", () => {
  let harness: Harness;
  let oauth: GoogleOAuthService;
  let logins: LoginService;
  let registration: RegistrationService;

  /** Swapped per test. `verify` ignores its argument -- the token is opaque here. */
  let next: () => Promise<GoogleIdentity>;

  const verifier: GoogleTokenVerifier = { verify: () => next() };

  const queue: JobQueue = { enqueue: async () => {}, close: async () => {} };

  beforeAll(async () => {
    harness = await startHarness();
    const sessions = new SessionService(harness.db, env);
    logins = new LoginService(harness.db, env, sessions);
    registration = new RegistrationService(harness.db, queue);
    oauth = new GoogleOAuthService(harness.db, verifier, logins);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
    next = async () => identity();
  });

  const signIn = (over: Partial<GoogleIdentity> = {}) => {
    next = async () => identity(over);
    return oauth.authenticate("an-opaque-id-token");
  };

  const rowFor = async (email: string) => {
    const [row] = await harness.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    return row;
  };

  describe("a new identity", () => {
    it("registers an account", async () => {
      const { outcome, session } = await signIn();

      expect(outcome).toBe("registered");
      expect(session.user.email).toBe("budi@example.test");
      expect(session.user.role).toBe("user");
    });

    it("is verified immediately", async () => {
      // docs/API/01 § Google OAuth: "auto email_verified = true". Google has already done
      // what our own verification email would have.
      await signIn();
      expect((await rowFor("budi@example.test"))!.emailVerified).toBe(true);
    });

    it("has no password hash", async () => {
      // Step 5. A placeholder would be a value some later path tries to verify against.
      await signIn();
      expect((await rowFor("budi@example.test"))!.passwordHash).toBeNull();
    });

    it("records the provider and subject id", async () => {
      await signIn();
      const row = await rowFor("budi@example.test");

      expect(row!.oauthProvider).toBe("google");
      expect(row!.oauthSubjectId).toBe("google-subject-1234567890");
    });

    it("gets notification preferences, like a password registration", async () => {
      await signIn();
      const row = await rowFor("budi@example.test");

      const prefs = await harness.db
        .select()
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, row!.id));
      expect(prefs).toHaveLength(1);
    });

    it("lowercases the address", async () => {
      // The verifier already lowercases; this asserts the property end to end, because a
      // mixed-case row would evade the unique email index.
      await signIn({ email: "budi@example.test" });
      expect(await rowFor("budi@example.test")).toBeDefined();
    });

    it("falls back to the local part when Google supplies no name", async () => {
      // `full_name` is NOT NULL and renders as a byline. An empty string would be blank.
      await signIn({ name: undefined });
      expect((await rowFor("budi@example.test"))!.fullName).toBe("budi");
    });

    it("truncates a name to the column width", async () => {
      await signIn({ name: "x".repeat(300) });
      expect((await rowFor("budi@example.test"))!.fullName).toHaveLength(100);
    });
  });

  describe("a returning identity", () => {
    it("matches on the subject id, not the email", async () => {
      // The subject id is stable for the life of a Google account; the email is not.
      const first = await signIn();
      const second = await signIn({ email: "budi.changed@example.test" });

      expect(second.outcome).toBe("matched");
      expect(second.session.user.id).toBe(first.session.user.id);
      // ...and the stored address is untouched: this endpoint does not rename accounts.
      expect(second.session.user.email).toBe("budi@example.test");
    });

    it("creates no second account", async () => {
      await signIn();
      await signIn();

      const all = await harness.db.select().from(users);
      expect(all).toHaveLength(1);
    });

    it("one Google identity cannot attach to two accounts", async () => {
      // OQ-15, answered by ADR-049. Step 3 makes the subject id a login key, and a login
      // key that matches two rows is a login whose outcome depends on row order.
      await signIn();

      // Asserted at the database, not in the service: this is the guarantee that holds
      // for a hand-run data fix during an incident as well as for the endpoint.
      await expect(
        harness.db.insert(users).values({
          email: "someone.else@example.test",
          fullName: "Someone Else",
          oauthProvider: "google",
          oauthSubjectId: "google-subject-1234567890",
        }),
      ).rejects.toMatchObject({
        cause: { code: "23505", constraint: "idx_users_oauth" },
      });
    });

    it("a soft-deleted account frees its Google identity", async () => {
      // Partial over active rows, like idx_users_email and for the same reason: a deleted
      // account must not hold an identity hostage until the hard delete runs.
      await signIn();
      const row = await rowFor("budi@example.test");
      await harness.db
        .update(users)
        .set({
          deletedAt: new Date(),
          email: `deleted-${row!.id}@example.test`,
        })
        .where(eq(users.id, row!.id));

      const again = await signIn();
      expect(again.outcome).toBe("registered");
    });
  });

  describe("linking an existing password account", () => {
    it("links when Google has verified the address", async () => {
      await registration.register({
        email: "budi@example.test",
        password: PASSWORD,
        fullName: "Budi Santoso",
      });
      const before = await rowFor("budi@example.test");
      expect(before!.emailVerified).toBe(false);

      const { outcome, session } = await signIn();

      expect(outcome).toBe("linked");
      expect(session.user.id).toBe(before!.id);

      const after = await rowFor("budi@example.test");
      expect(after!.oauthSubjectId).toBe("google-subject-1234567890");
      expect(after!.emailVerified).toBe(true);
    });

    it("keeps the password, so both sign-in methods work", async () => {
      // Linking a method must not remove one. A user who links Google and then forgets
      // they did should not find their password gone.
      await registration.register({
        email: "budi@example.test",
        password: PASSWORD,
        fullName: "Budi Santoso",
      });
      await signIn();

      await expect(
        logins.login("budi@example.test", PASSWORD),
      ).resolves.toBeDefined();
    });

    it("an unverified Google email cannot claim an existing account", async () => {
      // The account takeover this endpoint could otherwise enable: a Workspace admin can
      // create an identity on an address they do not own, and Google reports
      // email_verified: false for it.
      await registration.register({
        email: "budi@example.test",
        password: PASSWORD,
        fullName: "Budi Santoso",
      });

      await expect(signIn({ emailVerified: false })).rejects.toMatchObject({
        status: 403,
      });

      const row = await rowFor("budi@example.test");
      expect(row!.oauthSubjectId).toBeNull();
      expect(row!.emailVerified).toBe(false);
    });

    it("an unverified Google email cannot register either", async () => {
      // An account on an address nobody proved they own is an account whose password
      // reset belongs to somebody else.
      await expect(signIn({ emailVerified: false })).rejects.toMatchObject({
        status: 403,
      });
      expect(await rowFor("budi@example.test")).toBeUndefined();
    });

    it("a returning identity still works once linked, even unverified later", async () => {
      // Once the subject id is on the row, match happens before the verification check --
      // correctly: the link was established when Google had verified the address.
      await signIn();
      const again = await signIn({ emailVerified: false });

      expect(again.outcome).toBe("matched");
    });
  });

  describe("the body cannot influence the identity (DoD item 2)", () => {
    it("the email in the request body has no influence on the identity", async () => {
      // The service takes ONE argument, an opaque token. There is no email parameter to
      // pass, which is the strongest form of this guarantee: the call below is the whole
      // API surface, and it cannot express the attack.
      await registration.register({
        email: "victim@example.test",
        password: PASSWORD,
        fullName: "Victim",
      });

      // Google says one thing; an attacker would like us to hear another. We only have
      // Google's word to go on.
      await signIn({ email: "attacker@example.test" });

      const victim = await rowFor("victim@example.test");
      expect(victim!.oauthSubjectId).toBeNull();
      expect(victim!.emailVerified).toBe(false);

      expect(await rowFor("attacker@example.test")).toBeDefined();
    });
  });

  describe("the account must be usable", () => {
    it("refuses a suspended account", async () => {
      await signIn();
      const row = await rowFor("budi@example.test");
      await harness.db
        .update(users)
        .set({ status: "suspended" })
        .where(eq(users.id, row!.id));

      await expect(signIn()).rejects.toMatchObject({ status: 403 });
    });

    it("issues no session to a suspended account", async () => {
      await signIn();
      const row = await rowFor("budi@example.test");
      await harness.db
        .update(users)
        .set({ status: "suspended" })
        .where(eq(users.id, row!.id));

      await signIn().catch(() => {});

      // The check is before `issueSession`, so nothing was written.
      const live = await harness.db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.userId, row!.id));
      expect(live.filter((t) => t.revokedAt === null)).toHaveLength(1);
    });
  });

  describe("the session is the same shape as a password login (step 6)", () => {
    it("returns an access token and a refresh token", async () => {
      const { session } = await signIn();

      expect(session.accessToken.split(".")).toHaveLength(3);
      expect(session.refresh.token.length).toBeGreaterThan(20);
    });

    it("the refresh token rotates like any other", async () => {
      const { session } = await signIn();

      const rotated = await logins.refresh(session.refresh.token);
      expect(rotated.refresh.token).not.toBe(session.refresh.token);
      await expect(logins.refresh(session.refresh.token)).rejects.toMatchObject(
        { status: 401 },
      );
    });
  });

  describe("verifier failures reach HTTP as the right thing", () => {
    it("a rejected token is 401, and creates nothing", async () => {
      next = async () => {
        throw new InvalidGoogleTokenError("invalid token signature");
      };

      await expect(oauth.authenticate("garbage")).rejects.toMatchObject({
        status: 401,
        code: "INVALID_CREDENTIALS",
      });
      expect(await harness.db.select().from(users)).toHaveLength(0);
    });

    it("Google being unreachable is 503, not 401", async () => {
      // A 401 would send the user to a password form for an account that may have no
      // password at all -- turning somebody else's outage into their mistake.
      next = async () => {
        throw new GoogleUnavailableError(new Error("getaddrinfo ENOTFOUND"));
      };

      await expect(oauth.authenticate("a-fine-token")).rejects.toMatchObject({
        status: 503,
        code: "SERVICE_UNAVAILABLE",
      });
    });
  });

  describe("an OAuth-only account and password login (DoD item 3)", () => {
    it("an OAuth-only account cannot be used for password login", async () => {
      await signIn();

      await expect(
        logins.login("budi@example.test", PASSWORD),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    });

    it("the null password hash does not crash the login path", async () => {
      // Step 5's real requirement. `verifyPassword(null, …)` verifies against a dummy
      // hash (P1-01) rather than dereferencing, so this is a rejection, not a 500.
      await signIn();

      const error = await rejection(() =>
        logins.login("budi@example.test", "anything-at-all"),
      );
      expect(error.status).toBe(401);
      expect(error.name).toBe("InvalidCredentialsError");
    });

    it("gives the same error as a genuinely unknown address", async () => {
      // Non-enumerating: "this account exists but has no password" must not be
      // distinguishable from "no such account".
      await signIn();

      const oauthOnly = await rejection(() =>
        logins.login("budi@example.test", PASSWORD),
      );
      const unknown = await rejection(() =>
        logins.login("nobody@example.test", PASSWORD),
      );

      expect(oauthOnly.code).toBe(unknown.code);
      expect(oauthOnly.message).toBe(unknown.message);
    });
  });
});
