import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  UserService,
  FORBIDDEN_FIELDS,
} from "../../src/modules/user/user.service";
import { LoginService } from "../../src/modules/auth/login.service";
import { SessionService } from "../../src/modules/auth/session.service";
import { RegistrationService } from "../../src/modules/auth/registration.service";
import {
  refreshTokens,
  userNotificationPreferences,
  users,
} from "../../src/infra/db/schema/users";
import { invitations } from "../../src/infra/db/schema/index";
import type { Env } from "../../src/config/env.schema";
import type { JobQueue } from "../../src/infra/queue/queue.module";
import { tenantScope } from "../../src/shared/tenancy/tenant-scope";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import { startHarness, type Harness } from "../support/harness";
import { rejection } from "../support/rejection";
import { createTestInvitation, createTestUser } from "../support/factories";
import { resetTenantData } from "./helpers.ts";

/**
 * P1-08 — the current user's own profile.
 *
 * The IDOR test that every other `:id` endpoint needs has no equivalent here, and that is
 * the point: `docs/API/02` § Object-Level Authorization asks for prevention "by design",
 * and every method on `UserService` takes a `TenantScope` and no user id. The attack has
 * no parameter to travel in. What IS tested is the next thing that goes wrong —
 * mass assignment — and the parts of deletion that are a decision rather than a mechanism.
 */

const PEPPER = "integration-refresh-pepper-of-sufficient-len";

const env = {
  JWT_SIGNING_KEY: "integration-signing-key-of-sufficient-len-1",
  REFRESH_TOKEN_PEPPER: PEPPER,
  APP_ORIGIN: "https://app.example.test",
} as unknown as Env;

const PASSWORD = "kembang-sepatu-ungu-2026";
const NEW_PASSWORD = "matahari-terbit-di-timur-88";

describe("user profile", () => {
  let harness: Harness;
  let service: UserService;
  let logins: LoginService;
  let registration: RegistrationService;
  let enqueued: { name: string; data: Record<string, unknown> }[];

  const queue: JobQueue = {
    enqueue: async (_pool, name, data) => {
      enqueued.push({ name, data });
    },
    close: async () => {},
  };

  beforeAll(async () => {
    harness = await startHarness();
    const sessions = new SessionService(harness.db, env);
    logins = new LoginService(harness.db, env, sessions);
    registration = new RegistrationService(harness.db, queue);
    service = new UserService(
      harness.db,
      queue,
      new InvitationRepository(harness.db),
    );
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
    enqueued = [];
  });

  const register = async (email = "budi@example.test") => {
    await registration.register({
      email,
      password: PASSWORD,
      fullName: "Budi Santoso",
    });
    const [row] = await harness.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    return { ...row!, scope: tenantScope(row!.id) };
  };

  describe("reading the profile", () => {
    it("returns the documented fields", async () => {
      const user = await register();
      const profile = await service.getProfile(user.scope);

      expect(profile).toMatchObject({
        id: user.id,
        email: "budi@example.test",
        fullName: "Budi Santoso",
        phone: null,
        role: "user",
        emailVerified: false,
      });
      expect(profile.createdAt).toBeInstanceOf(Date);
    });

    it("never includes the password hash", async () => {
      await register();
      const profile = await service.getProfile(
        (await register("other@example.test")).scope,
      );

      expect(JSON.stringify(profile)).not.toMatch(/argon2|passwordHash/i);
    });

    it("a soft-deleted account is gone", async () => {
      const user = await register();
      await harness.db
        .update(users)
        .set({ deletedAt: new Date() })
        .where(eq(users.id, user.id));

      await expect(service.getProfile(user.scope)).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe("updating it", () => {
    it("changes full_name and phone", async () => {
      const user = await register();

      const updated = await service.updateProfile(user.scope, {
        fullName: "Budi Santoso Wijaya",
        phone: "+6281234567890",
      });

      expect(updated.fullName).toBe("Budi Santoso Wijaya");
      expect(updated.phone).toBe("+6281234567890");
    });

    it("an empty phone clears the column rather than storing an empty string", async () => {
      // "No phone" should be NULL, not a value that sorts and compares like one.
      const user = await register();
      await service.updateProfile(user.scope, { phone: "+6281234567890" });

      const cleared = await service.updateProfile(user.scope, { phone: "" });
      expect(cleared.phone).toBeNull();
    });

    it("touching nothing changes nothing", async () => {
      const user = await register();
      const before = await service.getProfile(user.scope);

      const after = await service.updateProfile(user.scope, {});
      expect(after).toEqual(before);
    });

    it("only ever updates the caller's own row", async () => {
      // Structurally guaranteed -- there is no user id parameter -- but asserted because
      // "structurally guaranteed" is a claim a future signature change could quietly break.
      const budi = await register();
      const mallory = await register("mallory@example.test");

      await service.updateProfile(mallory.scope, {
        fullName: "Mallory Edited",
      });

      expect((await service.getProfile(budi.scope)).fullName).toBe(
        "Budi Santoso",
      );
    });
  });

  describe("mass assignment (the DoD's second item)", () => {
    it.each([...FORBIDDEN_FIELDS])(
      "sending %s changes nothing",
      async (field) => {
        // docs/BACKEND/03 § Field Whitelisting. The schema strips it at the edge and the
        // service's parameter type has no such property -- this asserts the outcome
        // rather than either mechanism, so it survives a change to either.
        const user = await register();
        const before = await harness.db
          .select()
          .from(users)
          .where(eq(users.id, user.id));

        await service.updateProfile(user.scope, {
          fullName: "Still Just A Name",
          // The payload a mass-assignment attempt would carry, cast past the type that
          // exists to prevent it.
          [field]: field === "deleted_at" ? new Date() : "attacker-value",
        } as never);

        const after = await harness.db
          .select()
          .from(users)
          .where(eq(users.id, user.id));

        expect(after[0]!.role).toBe(before[0]!.role);
        expect(after[0]!.email).toBe(before[0]!.email);
        expect(after[0]!.emailVerified).toBe(before[0]!.emailVerified);
        expect(after[0]!.status).toBe(before[0]!.status);
        expect(after[0]!.passwordHash).toBe(before[0]!.passwordHash);
        expect(after[0]!.deletedAt).toBe(before[0]!.deletedAt);
        // ...and the legitimate field still went through, so this is not passing
        // because the update did nothing at all.
        expect(after[0]!.fullName).toBe("Still Just A Name");
      },
    );

    it("cannot promote itself to admin", async () => {
      // The one that matters most, called out by name.
      const user = await register();

      await service.updateProfile(user.scope, {
        fullName: "Budi",
        role: "super_admin",
      } as never);

      expect((await service.getProfile(user.scope)).role).toBe("user");
    });

    it("cannot mark its own email verified", async () => {
      // Which would bypass P1-02's gate on publish and checkout.
      const user = await register();

      await service.updateProfile(user.scope, {
        fullName: "Budi",
        emailVerified: true,
        email_verified: true,
      } as never);

      expect((await service.getProfile(user.scope)).emailVerified).toBe(false);
    });
  });

  describe("changing the password", () => {
    const liveTokens = async (userId: string) => {
      const rows = await harness.db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.userId, userId));
      return rows.filter((r) => r.revokedAt === null);
    };

    it("requires the current password", async () => {
      const user = await register();

      const error = await rejection(() =>
        service.changePassword(
          user.scope,
          "not-the-password",
          NEW_PASSWORD,
          undefined,
          PEPPER,
        ),
      );
      expect(error.status).toBe(400);
      expect(error.code).toBe("VALIDATION_ERROR");
    });

    it("sets the new one", async () => {
      const user = await register();
      await service.changePassword(
        user.scope,
        PASSWORD,
        NEW_PASSWORD,
        undefined,
        PEPPER,
      );

      await expect(
        logins.login("budi@example.test", NEW_PASSWORD),
      ).resolves.toBeDefined();
      await expect(
        logins.login("budi@example.test", PASSWORD),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    });

    it("revokes other sessions (the DoD's fourth item)", async () => {
      // If the attacker's refresh token survives a password change, the change
      // accomplished nothing except telling them they have been noticed.
      const user = await register();
      const attacker = await logins.login("budi@example.test", PASSWORD);
      const alsoAttacker = await logins.login("budi@example.test", PASSWORD);

      await service.changePassword(
        user.scope,
        PASSWORD,
        NEW_PASSWORD,
        undefined,
        PEPPER,
      );

      await expect(
        logins.refresh(attacker.refresh.token),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        logins.refresh(alsoAttacker.refresh.token),
      ).rejects.toMatchObject({ status: 401 });
      expect(await liveTokens(user.id)).toHaveLength(0);
    });

    it("spares the session that made the change", async () => {
      // The difference from a reset: the user is here and authenticated. Logging them out
      // of the tab they are typing in costs usability and buys nothing.
      const user = await register();
      const current = await logins.login("budi@example.test", PASSWORD);
      await logins.login("budi@example.test", PASSWORD);

      const { sessionsRevoked } = await service.changePassword(
        user.scope,
        PASSWORD,
        NEW_PASSWORD,
        current.refresh.token,
        PEPPER,
      );

      expect(sessionsRevoked).toBe(1);
      await expect(
        logins.refresh(current.refresh.token),
      ).resolves.toBeDefined();
    });

    it("enforces the password policy on the new password", async () => {
      const user = await register();

      const error = await rejection(() =>
        service.changePassword(
          user.scope,
          PASSWORD,
          "short",
          undefined,
          PEPPER,
        ),
      );
      expect(error.status).toBe(400);
    });

    it("a failed change revokes nothing", async () => {
      const user = await register();
      await logins.login("budi@example.test", PASSWORD);

      await service
        .changePassword(user.scope, "wrong", NEW_PASSWORD, undefined, PEPPER)
        .catch(() => {});

      expect(await liveTokens(user.id)).toHaveLength(1);
    });

    it("tells the owner", async () => {
      const user = await register();
      enqueued = [];
      await service.changePassword(
        user.scope,
        PASSWORD,
        NEW_PASSWORD,
        undefined,
        PEPPER,
      );

      expect(
        enqueued.some((j) => j.data["template"] === "password_changed"),
      ).toBe(true);
    });

    it("an account with no password is sent to the reset flow instead", async () => {
      const oauth = await createTestUser(harness.pool);
      // createTestUser leaves password_hash NULL, which is what a Google account has.

      const error = await rejection(() =>
        service.changePassword(
          oauth.scope,
          "anything",
          NEW_PASSWORD,
          undefined,
          PEPPER,
        ),
      );
      expect(error.status).toBe(422);
      expect(error.code).toBe("NO_PASSWORD_SET");
    });
  });

  describe("notification preferences", () => {
    it("reads the row created at registration", async () => {
      const user = await register();

      expect(await service.getPreferences(user.scope)).toEqual({
        rsvpEmail: true,
        guestbookEmail: true,
        marketingEmail: false,
      });
    });

    it("marketing defaults to false — opt-in, not opt-out", async () => {
      // docs/SECURITY/09 § Data Minimization.
      const user = await register();
      expect((await service.getPreferences(user.scope)).marketingEmail).toBe(
        false,
      );
    });

    it("updates one field without disturbing the others", async () => {
      const user = await register();

      const updated = await service.updatePreferences(user.scope, {
        marketingEmail: true,
      });
      expect(updated).toEqual({
        rsvpEmail: true,
        guestbookEmail: true,
        marketingEmail: true,
      });
    });

    it("returns defaults when the row is missing, rather than 404", async () => {
      // An account predating P1-02 has no preferences row. A missing preferences row is
      // not a missing user.
      const user = await createTestUser(harness.pool);

      expect(await service.getPreferences(user.scope)).toEqual({
        rsvpEmail: true,
        guestbookEmail: true,
        marketingEmail: false,
      });
    });

    it("creates the row when it was missing", async () => {
      const user = await createTestUser(harness.pool);

      await service.updatePreferences(user.scope, { rsvpEmail: false });

      const rows = await harness.db
        .select()
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rsvpEmail).toBe(false);
    });

    it("one user's preferences are not another's", async () => {
      const budi = await register();
      const mallory = await register("mallory@example.test");

      await service.updatePreferences(mallory.scope, { rsvpEmail: false });

      expect((await service.getPreferences(budi.scope)).rsvpEmail).toBe(true);
    });
  });

  describe("account deletion (ADR-051, answering OQ-11)", () => {
    it("soft-deletes rather than removing the row", async () => {
      const user = await register();

      const result = await service.requestDeletion(user.scope);
      expect(result.status).toBe("scheduled");

      const [row] = await harness.db
        .select()
        .from(users)
        .where(eq(users.id, user.id));
      expect(row).toBeDefined();
      expect(row!.deletedAt).not.toBeNull();
    });

    it("ends every session immediately", async () => {
      // The account is unusable at once. The invitation outlives the login, not the
      // other way round.
      const user = await register();
      const session = await logins.login("budi@example.test", PASSWORD);

      await service.requestDeletion(user.scope);

      await expect(logins.refresh(session.refresh.token)).rejects.toMatchObject(
        { status: 401 },
      );
    });

    it("the account cannot log in afterwards", async () => {
      const user = await register();
      await service.requestDeletion(user.scope);

      await expect(
        logins.login("budi@example.test", PASSWORD),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
      expect(user).toBeDefined();
    });

    it("sends a confirmation", async () => {
      // Step 5, and the only signal the real owner gets if somebody else did this.
      const user = await register();
      enqueued = [];

      await service.requestDeletion(user.scope);

      expect(
        enqueued.some(
          (j) => j.data["template"] === "account_deletion_requested",
        ),
      ).toBe(true);
    });

    it("published invitations keep serving, and are counted", async () => {
      // ADR-051. A couple whose wedding is next week has sent the link to three hundred
      // guests; honouring a deletion request by breaking that harms people who did not
      // ask for anything, to remove data the requester published on purpose.
      const user = await register();
      const invitation = await createTestInvitation(harness.pool, {
        owner: { id: user.id, email: user.email, scope: user.scope },
      });
      await harness.db
        .update(invitations)
        .set({ status: "published" })
        .where(eq(invitations.id, invitation.id));

      const result = await service.requestDeletion(user.scope);
      expect(result.liveInvitations).toBe(1);

      const [row] = await harness.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, invitation.id));
      expect(row!.deletedAt).toBeNull();
      expect(row!.status).toBe("published");
    });

    it("does not count drafts as live", async () => {
      const user = await register();
      await createTestInvitation(harness.pool, {
        owner: { id: user.id, email: user.email, scope: user.scope },
      });

      const result = await service.requestDeletion(user.scope);
      expect(result.liveInvitations).toBe(0);
    });

    it("refuses a second request", async () => {
      const user = await register();
      await service.requestDeletion(user.scope);

      await expect(service.requestDeletion(user.scope)).rejects.toMatchObject({
        status: 404,
      });
    });

    it("frees the email address for a new account", async () => {
      // ADR-031's partial unique index. A deleted account must not hold its address
      // hostage until the hard delete runs.
      const user = await register();
      await service.requestDeletion(user.scope);

      await expect(
        registration.register({
          email: "budi@example.test",
          password: PASSWORD,
          fullName: "Budi Again",
        }),
      ).resolves.toEqual({ status: "accepted" });
      expect(user).toBeDefined();
    });

    it("touches no other account", async () => {
      const budi = await register();
      const mallory = await register("mallory@example.test");
      await logins.login("mallory@example.test", PASSWORD);

      await service.requestDeletion(budi.scope);

      const [row] = await harness.db
        .select()
        .from(users)
        .where(eq(users.id, mallory.id));
      expect(row!.deletedAt).toBeNull();
    });
  });
});
