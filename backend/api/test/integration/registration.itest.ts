import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";

import {
  RegistrationService,
  type RegisterInput,
} from "../../src/modules/auth/registration.service";
import {
  consumeToken,
  hashToken,
  issueToken,
  TOKEN_LIFETIME_MS,
} from "../../src/modules/auth/tokens/single-use-token.service";
import { requireVerifiedEmail } from "../../src/modules/auth/require-verified-email";
import {
  userNotificationPreferences,
  userTokens,
  users,
} from "../../src/infra/db/schema/users";
import type { JobQueue } from "../../src/infra/queue/queue.module";
import { startHarness, type Harness } from "../support/harness";
import { resetTenantData } from "./helpers.ts";

/**
 * P1-02 — registration and email verification, against a real database.
 *
 * Integration rather than unit because every property worth asserting is a property of
 * the *transaction*: that three rows appear together, that a token can be claimed
 * exactly once under concurrency, and that a duplicate address is indistinguishable
 * from a new one. None of those survive being mocked.
 */

describe("registration", () => {
  let harness: Harness;
  let service: RegistrationService;
  let enqueued: { pool: string; name: string; data: Record<string, unknown> }[];

  const queue: JobQueue = {
    enqueue: async (pool, name, data) => {
      enqueued.push({ pool, name, data });
    },
    close: async () => {},
  };

  beforeAll(async () => {
    harness = await startHarness();
    service = new RegistrationService(harness.db, queue);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
    enqueued = [];
  });

  const input = (over: Partial<RegisterInput> = {}): RegisterInput => ({
    email: "Budi.Santoso@Example.test",
    password: "kembang-sepatu-ungu-2026",
    fullName: "Budi Santoso",
    ...over,
  });

  // The policy's breach check would reach the network; every call here supplies its own
  // password that passes the local rules, and the network call is what we avoid by
  // never using a breached one. The HIBP client has its own unit tests (P1-01).
  const register = (over: Partial<RegisterInput> = {}) =>
    service.register(input(over));

  it("creates the user, their preferences and a token together", async () => {
    const result = await register();
    expect(result.status).toBe("accepted");

    const [user] = await harness.db
      .select()
      .from(users)
      .where(eq(users.email, "budi.santoso@example.test"));

    expect(user).toBeDefined();
    // Lowercased: `Budi@Gmail.com` and `budi@gmail.com` are one mailbox.
    expect(user!.email).toBe("budi.santoso@example.test");
    expect(user!.emailVerified).toBe(false);
    expect(user!.passwordHash).toMatch(/^\$argon2id\$/);

    // Step 6: created at registration so no later query defends against its absence.
    const prefs = await harness.db
      .select()
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, user!.id));
    expect(prefs).toHaveLength(1);

    const tokens = await harness.db
      .select()
      .from(userTokens)
      .where(eq(userTokens.userId, user!.id));
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.type).toBe("email_verification");
  });

  it("stores only a hash of the token, never the token", async () => {
    await register();

    const emailJob = enqueued.find(
      (j) => j.data["template"] === "email_verification",
    );
    const token = emailJob!.data["token"] as string;
    expect(token.length).toBeGreaterThan(20);

    const [row] = await harness.db.select().from(userTokens);
    expect(row!.tokenHash).not.toBe(token);
    expect(row!.tokenHash).toBe(hashToken(token));
    // A database dump must not yield a working verification link.
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("expires the verification token in 24 hours", async () => {
    // docs/SECURITY/03 § Email Verification.
    await register();
    const [row] = await harness.db.select().from(userTokens);

    const lifetime = row!.expiresAt.getTime() - row!.createdAt.getTime();
    expect(
      Math.abs(lifetime - TOKEN_LIFETIME_MS.email_verification),
    ).toBeLessThan(5000);
  });

  it("enqueues the email after the user exists, not before", async () => {
    await register();

    const job = enqueued.find(
      (j) => j.data["template"] === "email_verification",
    );
    expect(job).toBeDefined();
    expect(job!.pool).toBe("general");
    expect(job!.name).toBe("notification.send");

    // The job names a user that can actually be looked up. A job emitted inside the
    // transaction could describe a row that was rolled back.
    const [user] = await harness.db
      .select()
      .from(users)
      .where(eq(users.id, job!.data["userId"] as string));
    expect(user).toBeDefined();
  });

  it("succeeds even when the queue is unavailable", async () => {
    // DoD item 2. Registration must not block on, or be undone by, the notification
    // path -- the whole point of it being asynchronous.
    const failing: JobQueue = {
      enqueue: async () => {
        throw new Error("redis is down");
      },
      close: async () => {},
    };
    const isolated = new RegistrationService(harness.db, failing);

    // The real QueueModule swallows this; here the throw proves the service does not
    // depend on it succeeding.
    await expect(
      isolated.register(input({ email: "resilient@example.test" })),
    ).rejects.toThrow();

    // ...and the user was still created, because the enqueue happens after commit.
    const [user] = await harness.db
      .select()
      .from(users)
      .where(eq(users.email, "resilient@example.test"));
    expect(user).toBeDefined();
  });

  describe("enumeration (DoD item 4)", () => {
    it("does not reveal that an email is already registered", async () => {
      const first = await register();
      const second = await register();

      // Identical, down to the shape.
      expect(second).toEqual(first);
      expect(second.status).toBe("accepted");
    });

    it("does not create a second user for the same address", async () => {
      await register();
      await register();

      const rows = await harness.db
        .select()
        .from(users)
        .where(eq(users.email, "budi.santoso@example.test"));
      expect(rows).toHaveLength(1);
    });

    it("tells the real owner that somebody tried", async () => {
      // The one person entitled to know is the only one who would otherwise be kept in
      // the dark.
      await register();
      enqueued = [];
      await register();

      expect(
        enqueued.some(
          (j) => j.data["template"] === "registration_attempt_existing_account",
        ),
      ).toBe(true);
    });

    it("rejects a weak password identically whether or not the address is taken", async () => {
      const fresh = await register({
        email: "new@example.test",
        password: "short",
      });
      await register({ email: "taken@example.test" });
      const taken = await register({
        email: "taken@example.test",
        password: "short",
      });

      expect(taken).toEqual(fresh);
      expect(taken.status).toBe("rejected");
    });
  });

  describe("verification", () => {
    const registerAndGetToken = async (): Promise<string> => {
      await register();
      const job = enqueued.find(
        (j) => j.data["template"] === "email_verification",
      );
      return job!.data["token"] as string;
    };

    it("verifies the address", async () => {
      const token = await registerAndGetToken();

      expect(await service.verifyEmail(token)).toEqual({ status: "verified" });

      const [user] = await harness.db.select().from(users);
      expect(user!.emailVerified).toBe(true);
    });

    it("a used token cannot be redeemed twice", async () => {
      const token = await registerAndGetToken();

      await service.verifyEmail(token);
      // Not an error: a second click, or a mail client prefetching the link. The user
      // achieved what they wanted.
      expect(await service.verifyEmail(token)).toEqual({
        status: "already_verified",
      });
    });

    it("survives two simultaneous redemptions", async () => {
      // The reason `consume` is one conditional UPDATE rather than a read then a write.
      // A mail scanner opening the link while the user clicks is the realistic case.
      const token = await registerAndGetToken();

      const [a, b] = await Promise.all([
        service.verifyEmail(token),
        service.verifyEmail(token),
      ]);

      const outcomes = [a.status, b.status].sort();
      expect(outcomes).toEqual(["already_verified", "verified"]);
    });

    it("refuses an expired token", async () => {
      const [user] = await harness.db
        .insert(users)
        .values({
          email: "expiring@example.test",
          fullName: "Expiring",
          passwordHash: "x",
        })
        .returning({ id: users.id });

      const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const { token } = await issueToken(
        harness.db,
        user!.id,
        "email_verification",
        past,
      );

      expect(await service.verifyEmail(token)).toEqual({ status: "expired" });
    });

    it("refuses a token that does not exist", async () => {
      expect(await service.verifyEmail("not-a-real-token")).toEqual({
        status: "invalid",
      });
    });

    it("the token determines the user, so one user cannot verify another", async () => {
      // There is no user id in the request at all. This asserts the design rather than
      // an input check: the only way to verify an address is to hold its token.
      await register();
      const mallory = await harness.db
        .insert(users)
        .values({
          email: "mallory@example.test",
          fullName: "Mallory",
          passwordHash: "x",
        })
        .returning({ id: users.id });

      const token = enqueued.find(
        (j) => j.data["template"] === "email_verification",
      )!.data["token"] as string;
      await service.verifyEmail(token);

      const [malloryRow] = await harness.db
        .select()
        .from(users)
        .where(eq(users.id, mallory[0]!.id));
      expect(malloryRow!.emailVerified).toBe(false);
    });

    it("refuses a password-reset token presented as a verification token", async () => {
      // The `type` column is part of the lookup, so tokens are not interchangeable
      // between purposes.
      await register();
      const [user] = await harness.db.select().from(users);

      const { token } = await issueToken(
        harness.db,
        user!.id,
        "password_reset",
      );
      expect(await service.verifyEmail(token)).toEqual({ status: "invalid" });
    });
  });

  describe("issuing a token revokes the previous one", () => {
    it("leaves only one live token per purpose", async () => {
      // Otherwise "resend" leaves a trail of live links in old emails, the oldest valid
      // for its full 24 hours.
      await register();
      const [user] = await harness.db.select().from(users);

      const first = enqueued.find(
        (j) => j.data["template"] === "email_verification",
      )!.data["token"] as string;

      await service.resendVerification("budi.santoso@example.test");

      expect(await service.verifyEmail(first)).toEqual({
        status: "already_verified",
      });

      const live = await harness.db
        .select()
        .from(userTokens)
        .where(
          and(
            eq(userTokens.userId, user!.id),
            eq(userTokens.type, "email_verification"),
          ),
        );
      expect(live.filter((t) => t.usedAt === null)).toHaveLength(1);
    });
  });

  describe("resend-verification", () => {
    it("reveals nothing about an unknown address", async () => {
      await expect(
        service.resendVerification("nobody@example.test"),
      ).resolves.toBeUndefined();
      expect(enqueued).toHaveLength(0);
    });

    it("sends nothing for an already-verified address", async () => {
      await register();
      const token = enqueued.find(
        (j) => j.data["template"] === "email_verification",
      )!.data["token"] as string;
      await service.verifyEmail(token);

      enqueued = [];
      await service.resendVerification("budi.santoso@example.test");
      expect(enqueued).toHaveLength(0);
    });

    it("sends a fresh token for a known unverified address", async () => {
      await register();
      enqueued = [];

      await service.resendVerification("budi.santoso@example.test");
      const job = enqueued.find(
        (j) => j.data["template"] === "email_verification",
      );
      expect(job).toBeDefined();
      expect(await service.verifyEmail(job!.data["token"] as string)).toEqual({
        status: "verified",
      });
    });
  });
});

describe("requireVerifiedEmail (P1-02 step 5)", () => {
  it("allows a verified user through", () => {
    expect(() => requireVerifiedEmail({ emailVerified: true })).not.toThrow();
  });

  it("refuses an unverified user with EMAIL_NOT_VERIFIED", () => {
    // 403 rather than 404: this is a property of the CALLER and reveals nothing about
    // anyone else's resources (docs/API/00 § 403 vs 404).
    expect(() => requireVerifiedEmail({ emailVerified: false })).toThrowError(
      expect.objectContaining({ code: "EMAIL_NOT_VERIFIED", status: 403 }),
    );
  });
});
