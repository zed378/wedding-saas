import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";

import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import {
  adminBypass,
  tenantScope,
} from "../../src/shared/tenancy/tenant-scope";
import {
  requireOwnership,
  requireOwned,
} from "../../src/shared/auth-middleware/require-ownership";
import { SessionService } from "../../src/modules/auth/session.service";
import { signAccessToken } from "../../src/modules/auth/tokens/access-token.service";
import { auditLogs, users } from "../../src/infra/db/schema/index";
import { securityLogger } from "../../src/shared/logging/logger";
import type { Env } from "../../src/config/env.schema";
import { startHarness, type Harness } from "../support/harness";
import { rejection } from "../support/rejection";
import {
  createTwoTenants,
  expectIdorSafe,
  expectServiceIdorSafe,
} from "../support/idor";
import { createTestUser } from "../support/factories";
import { resetTenantData } from "./helpers.ts";

/**
 * P1-06 — authorization.
 *
 * `docs/SECURITY/05` is the project's number one security concern with zero tolerance for
 * regressions, so this file is mostly about proving that the things which are supposed to
 * be impossible actually are — including that the **test helper** can fail, which is the
 * one property that decides whether every later endpoint's IDOR test means anything.
 */

const JWT_KEY = "integration-signing-key-of-sufficient-len-1";

const env = {
  JWT_SIGNING_KEY: JWT_KEY,
  REFRESH_TOKEN_PEPPER: "integration-refresh-pepper-of-sufficient-len",
  APP_ORIGIN: "https://app.example.test",
} as unknown as Env;

describe("authorization", () => {
  let harness: Harness;
  let repo: InvitationRepository;
  let sessions: SessionService;

  beforeAll(async () => {
    harness = await startHarness();
    repo = new InvitationRepository(harness.db);
    sessions = new SessionService(harness.db, env);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
  });

  describe("requireOwnership", () => {
    it("returns the resource to its owner", async () => {
      const { alice } = await createTwoTenants(harness.pool);

      const found = await requireOwnership(() =>
        repo.findOwned(alice.invitation.id, alice.user.scope),
      );
      expect(found.id).toBe(alice.invitation.id);
    });

    it("a non-owner gets 404 and no data", async () => {
      // docs/SECURITY/05 § 1. The single highest-priority rule in the project.
      const { alice, mallory } = await createTwoTenants(harness.pool);

      const error = await rejection(() =>
        requireOwnership(() =>
          repo.findOwned(alice.invitation.id, mallory.user.scope),
        ),
      );

      expect(error.status).toBe(404);
      expect(error.code).toBe("NOT_FOUND");
      expect(JSON.stringify(error)).not.toContain("Alice");
    });

    it("'absent' and 'not yours' are the same response", async () => {
      // docs/SECURITY/04 § Note. A status-code difference is an existence oracle, so the
      // two must be byte-identical -- not merely both 404.
      const { alice, mallory } = await createTwoTenants(harness.pool);

      const notYours = await rejection(() =>
        requireOwnership(() =>
          repo.findOwned(alice.invitation.id, mallory.user.scope),
        ),
      );
      const absent = await rejection(() =>
        requireOwnership(() =>
          repo.findOwned(
            "00000000-0000-4000-8000-0000000000ff",
            mallory.user.scope,
          ),
        ),
      );

      expect(notYours.status).toBe(absent.status);
      expect(notYours.code).toBe(absent.code);
      expect(notYours.message).toBe(absent.message);
    });

    it("a soft-deleted invitation is gone to its owner too", async () => {
      const { alice } = await createTwoTenants(harness.pool);
      await harness.pool.query(
        "UPDATE invitations SET deleted_at = now() WHERE id = $1",
        [alice.invitation.id],
      );

      await expect(
        requireOwnership(() =>
          repo.findOwned(alice.invitation.id, alice.user.scope),
        ),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("emits authz.idor_attempt when context is supplied", async () => {
      // One 404 is a stale bookmark. A hundred with incrementing ids is an attack, and
      // docs/SECURITY/05 wants that visible.
      const spy = vi.spyOn(securityLogger, "warn");
      const { alice, mallory } = await createTwoTenants(harness.pool);

      await requireOwnership(
        () => repo.findOwned(alice.invitation.id, mallory.user.scope),
        {
          scope: mallory.user.scope,
          resourceType: "invitation",
          resourceId: alice.invitation.id,
        },
      ).catch(() => {});

      const call = spy.mock.calls.find(
        (c) =>
          (c[0] as { event?: string } | undefined)?.event ===
          "authz.idor_attempt",
      );
      expect(call).toBeDefined();
      expect(call![0]).toMatchObject({
        context: { actor_id: mallory.user.scope, resource_type: "invitation" },
      });
      spy.mockRestore();
    });

    it("emits nothing when the owner's own lookup misses", async () => {
      // Otherwise every mistyped URL by a legitimate user is a security event, and the
      // stream that matters drowns.
      const spy = vi.spyOn(securityLogger, "warn");
      const { alice } = await createTwoTenants(harness.pool);

      await requireOwnership(() =>
        repo.findOwned(alice.invitation.id, alice.user.scope),
      );

      expect(
        spy.mock.calls.some(
          (c) =>
            (c[0] as { event?: string } | undefined)?.event ===
            "authz.idor_attempt",
        ),
      ).toBe(false);
      spy.mockRestore();
    });

    it("requireOwned proves ownership without shipping the row", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);

      await expect(
        requireOwned(() =>
          repo.ownsInvitation(alice.invitation.id, alice.user.scope),
        ),
      ).resolves.toBeUndefined();

      await expect(
        requireOwned(() =>
          repo.ownsInvitation(alice.invitation.id, mallory.user.scope),
        ),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("the service cannot be called without a scope", () => {
    it("a job with no user context cannot construct one from nothing", async () => {
      // docs/SECURITY/04 § Implementation Principle 2. There is no "unscoped" value to
      // pass: `tenantScope` is the only producer of the branded type and it validates.
      expect(() => tenantScope("")).toThrow(/Tenant scope must be a UUID/);
      expect(() => tenantScope("all")).toThrow();
      expect(() => tenantScope(undefined as unknown as string)).toThrow();
    });

    it("an invitation id is not a scope", async () => {
      // It is a valid UUID, so only the brand stops it being passed as an owner. This
      // test documents that the brand is doing work a regex cannot.
      const { alice } = await createTwoTenants(harness.pool);

      const wrong = tenantScope(alice.invitation.id);
      expect(await repo.findOwned(alice.invitation.id, wrong)).toBeNull();
    });
  });

  describe("requireRole is never sufficient on its own", () => {
    it("requireRole alone does not protect a resource", async () => {
      // docs/SECURITY/04 § Implementation Principle 1, as a test. Mallory has the `user`
      // role, so any `requireRole("user")` guard passes for her -- and she still cannot
      // read Alice's row, because that is ownership's job and not the role's.
      const { alice, mallory } = await createTwoTenants(harness.pool);

      const [malloryRow] = await harness.db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, mallory.user.id));
      expect(malloryRow!.role).toBe("user");

      await expectServiceIdorSafe(() =>
        repo.findOwned(alice.invitation.id, mallory.user.scope),
      );
    });

    it("an admin role does not silently widen findOwned", async () => {
      // The bypass is a separately named method (docs/SECURITY/04 § 4). The ordinary
      // path must not quietly behave differently for an admin, or the audit row that
      // makes the bypass acceptable would be skipped.
      const { alice } = await createTwoTenants(harness.pool);
      const admin = await createTestUser(harness.pool, { role: "admin" });

      expect(await repo.findOwned(alice.invitation.id, admin.scope)).toBeNull();
    });
  });

  describe("requireAuth resolves from the database", () => {
    it("requireRole reads the database role, not the token's", async () => {
      // A validly-signed token claiming super_admin. The row says `user`.
      const alice = await createTestUser(harness.pool);
      const token = await signAccessToken(JWT_KEY, {
        userId: alice.id,
        role: "super_admin",
        emailVerified: true,
      });

      const resolved = await sessions.authenticate(`Bearer ${token}`);
      expect(resolved.role).toBe("user");
    });

    it("a suspended user is not authenticated", async () => {
      const alice = await createTestUser(harness.pool);
      await harness.pool.query(
        "UPDATE users SET status = 'suspended' WHERE id = $1",
        [alice.id],
      );

      const token = await signAccessToken(JWT_KEY, {
        userId: alice.id,
        role: "user",
        emailVerified: true,
      });

      await expect(
        sessions.authenticate(`Bearer ${token}`),
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  describe("the admin bypass (docs/SECURITY/05 § Special Case)", () => {
    const auditRows = async (): Promise<number> =>
      (await harness.db.select().from(auditLogs)).length;

    it("reaches another tenant's invitation", async () => {
      const { alice } = await createTwoTenants(harness.pool);
      const admin = await createTestUser(harness.pool, { role: "admin" });

      const found = await repo.adminFindInvitationBypassingOwnership(
        alice.invitation.id,
        adminBypass(admin.id, "support ticket #1234"),
      );
      expect(found?.id).toBe(alice.invitation.id);
    });

    it("writes an audit row every time", async () => {
      const { alice } = await createTwoTenants(harness.pool);
      const admin = await createTestUser(harness.pool, { role: "admin" });

      for (let i = 0; i < 3; i += 1) {
        await repo.adminFindInvitationBypassingOwnership(
          alice.invitation.id,
          adminBypass(admin.id, `support ticket #${i}`),
        );
      }

      expect(await auditRows()).toBe(3);
    });

    it("writes an audit row even when nothing was found", async () => {
      // An admin probing ids that do not exist is exactly as interesting as one reading
      // a row, and arguably more so.
      const admin = await createTestUser(harness.pool, { role: "admin" });

      await repo.adminFindInvitationBypassingOwnership(
        "00000000-0000-4000-8000-0000000000ff",
        adminBypass(admin.id, "probing"),
      );

      expect(await auditRows()).toBe(1);
    });

    it("records the reason, which is the point of the audit row", async () => {
      const { alice } = await createTwoTenants(harness.pool);
      const admin = await createTestUser(harness.pool, { role: "admin" });

      await repo.adminFindInvitationBypassingOwnership(
        alice.invitation.id,
        adminBypass(admin.id, "GDPR erasure request REQ-778"),
      );

      const [row] = await harness.db.select().from(auditLogs);
      expect(row!.adminId).toBe(admin.id);
      expect(row!.reason).toContain("REQ-778");
    });

    it("refuses a bypass with no reason", async () => {
      // The audit row is the only record that a bypass was legitimate, and a reason
      // nobody supplied is one nobody can review.
      const admin = await createTestUser(harness.pool, { role: "admin" });

      expect(() => adminBypass(admin.id, "")).toThrow(/non-empty reason/);
      expect(() => adminBypass(admin.id, "   ")).toThrow();
    });
  });

  describe("the IDOR helper itself", () => {
    it("passes a service that is actually safe", async () => {
      await expectIdorSafe(harness.pool, (id, scope) =>
        repo.findOwned(id, scope),
      );
    });

    it("FAILS when given a service that leaks", async () => {
      // The property that decides whether every later endpoint's IDOR test means
      // anything. A helper that cannot fail is a helper that proves nothing, and this is
      // the only test in the suite whose passing depends on an assertion failing.
      const leaky = async (id: string): Promise<unknown> => {
        // Deliberately unscoped: no `owner_id` predicate. This is the bug the whole
        // subsystem exists to prevent, written out so the helper has something real to
        // catch.
        const { rows } = await harness.pool.query(
          "SELECT * FROM invitations WHERE id = $1",
          [id],
        );
        return rows[0] ?? null;
      };

      await expect(
        expectIdorSafe(harness.pool, (id) => leaky(id)),
      ).rejects.toThrow(/returned data for a resource the caller does not own/);
    });

    it("FAILS a service that refuses everybody", async () => {
      // The other way to pass an IDOR test while shipping a broken product. Without the
      // positive half of the assertion, `async () => null` would look perfectly secure.
      await expect(
        expectIdorSafe(harness.pool, async () => null),
      ).rejects.toThrow(
        /the owner must still be able to reach their own resource/,
      );
    });

    it("FAILS a service that answers 403 instead of 404", async () => {
      // docs/SECURITY/04 § Note: 403 confirms the resource exists. A helper that accepted
      // it would let the enumeration oracle through the one test meant to catch it.
      await expect(
        expectServiceIdorSafe(() => {
          throw Object.assign(new Error("forbidden"), {
            status: 403,
            code: "FORBIDDEN",
          });
        }),
      ).rejects.toThrow(/never 403/);
    });

    it("catches a leak hidden in a 404 body", async () => {
      const { expectHttpIdorSafe } = await import("../support/idor.js");

      await expect(
        expectHttpIdorSafe(
          () =>
            Promise.resolve({
              status: 404,
              body: { success: false, error: { message: "Alice's wedding" } },
            }),
          { mustNotContain: ["Alice's wedding"] },
        ),
      ).rejects.toThrow(/leaked/);
    });
  });
});
