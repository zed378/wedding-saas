import { randomUUID } from "node:crypto";

import { Redis as IORedis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { CachePort } from "../../src/infra/cache/cache.port";
import { RedisCache } from "../../src/infra/cache/redis-cache";
import { CatalogRepository } from "../../src/modules/order/catalog.repository";
import {
  OrderService,
  type CheckoutUser,
} from "../../src/modules/order/order.service";
import { PricingService } from "../../src/modules/order/pricing.service";
import { InvitationStatusService } from "../../src/shared/invitation-status/invitation-status.service";
import { OrderRepository } from "../../src/shared/tenancy/order-repository";
import {
  createTestInvitation,
  createTestOrder,
  createTestUser,
  type TestInvitation,
  type TestUser,
} from "../support/factories";
import { startHarness, type Harness } from "../support/harness";
import { expectServiceIdorSafe } from "../support/idor";
import { rejection } from "../support/rejection";
import { resetTenantData } from "./helpers.ts";

/**
 * `P3-02` — order creation against a real database and a real Redis.
 *
 * The claims worth the most here are about what happens **twice**: two checkouts at once, the
 * same request retried, a key reused. Each asserts on the rows that exist afterwards, not only
 * on what the call returned — a service that answered 409 correctly while leaving a second order
 * behind would pass a response-only test.
 */

const REDIS_URL =
  process.env["TEST_REDIS_URL"] ??
  process.env["REDIS_URL"] ??
  "redis://localhost:56379";

describe("order creation (P3-02)", () => {
  let harness: Harness;
  let redis: IORedis;
  let cache: CachePort;
  let service: OrderService;

  beforeAll(async () => {
    harness = await startHarness();
    redis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    await redis.ping();
    cache = new RedisCache(redis);
    service = new OrderService(
      new OrderRepository(harness.db),
      new PricingService(new CatalogRepository(harness.db)),
      new InvitationStatusService(harness.db),
      cache,
    );
  }, 120_000);

  afterAll(async () => {
    await redis?.quit();
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
  });

  const verified = (user: TestUser): CheckoutUser => ({
    scope: user.scope,
    emailVerified: true,
  });

  const ownedInvitation = async (
    status?: string,
  ): Promise<{ user: TestUser; invitation: TestInvitation }> => {
    const user = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, {
      owner: user,
      ...(status !== undefined ? { status } : {}),
    });
    return { user, invitation };
  };

  const ordersOf = async (invitationId: string) => {
    const { rows } = await harness.pool.query<{
      id: string;
      user_id: string;
      package_id: string;
      amount_total: string;
      status: string;
      order_type: string;
      window_hours: number;
    }>(
      `SELECT id, user_id, package_id, amount_total::text, status, order_type,
              EXTRACT(EPOCH FROM (expired_at - created_at)) / 3600 AS window_hours
         FROM orders WHERE invitation_id = $1 ORDER BY created_at`,
      [invitationId],
    );
    return rows;
  };

  const statusOf = async (invitationId: string) => {
    const { rows } = await harness.pool.query<{ status: string }>(
      "SELECT status FROM invitations WHERE id = $1",
      [invitationId],
    );
    return rows[0]!.status;
  };

  const historyOf = async (invitationId: string) => {
    const { rows } = await harness.pool.query<{
      from_status: string | null;
      to_status: string;
      changed_by: string | null;
    }>(
      "SELECT from_status, to_status, changed_by FROM invitation_status_history WHERE invitation_id = $1 ORDER BY created_at",
      [invitationId],
    );
    return rows;
  };

  const standardPrice = async () => {
    const { rows } = await harness.pool.query<{ price: string }>(
      "SELECT price::text AS price FROM packages WHERE id = 'standard'",
    );
    return rows[0]!.price;
  };

  const checkout = { packageId: "standard", addonIds: [] as string[] };

  // ------------------------------------------------------------------- the happy path

  describe("a draft", () => {
    it("creates a pending new_publish order priced from the row, and moves to pending_payment", async () => {
      const { user, invitation } = await ownedInvitation();

      const order = await service.create(
        verified(user),
        invitation.id,
        checkout,
      );

      const rows = await ordersOf(invitation.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: order.id,
        user_id: user.id,
        package_id: "standard",
        amount_total: await standardPrice(),
        status: "pending",
        order_type: "new_publish",
      });
      // `docs/PLAN/09`: `expired_at = now + 24h`.
      expect(Number(rows[0]!.window_hours)).toBeCloseTo(24, 3);

      expect(order).toMatchObject({
        invitation_id: invitation.id,
        package_id: "standard",
        addons: [],
        amount_total: Number(await standardPrice()),
        order_type: "new_publish",
        status: "pending",
      });

      expect(await statusOf(invitation.id)).toBe("pending_payment");
      expect(await historyOf(invitation.id)).toEqual([
        {
          from_status: "draft",
          to_status: "pending_payment",
          changed_by: user.id,
        },
      ]);
    });

    it("writes nothing when pricing refuses: no order, no transition", async () => {
      const { user, invitation } = await ownedInvitation();

      const error = await rejection(() =>
        service.create(verified(user), invitation.id, {
          packageId: "standard",
          addonIds: ["custom_domain"],
        }),
      );

      expect(error).toMatchObject({ status: 422, code: "ADDON_NOT_AVAILABLE" });
      expect(await ordersOf(invitation.id)).toEqual([]);
      expect(await statusOf(invitation.id)).toBe("draft");
      expect(await historyOf(invitation.id)).toEqual([]);
    });
  });

  // --------------------------------------------------------------- order type by status

  describe("the invitation's status decides the order type", () => {
    it.each(["published", "expired"])(
      "a %s invitation gets a renewal order and keeps its status",
      async (status) => {
        const { user, invitation } = await ownedInvitation(status);

        const order = await service.create(
          verified(user),
          invitation.id,
          checkout,
        );

        expect(order.order_type).toBe("renewal");
        expect(order.amount_total).toBe(Number(await standardPrice()));
        expect(await statusOf(invitation.id)).toBe(status);
        expect(await historyOf(invitation.id)).toEqual([]);
      },
    );

    it("a paid invitation is refused: there is nothing to buy", async () => {
      const { user, invitation } = await ownedInvitation("paid");
      const error = await rejection(() =>
        service.create(verified(user), invitation.id, checkout),
      );
      expect(error).toMatchObject({ status: 422, code: "ORDER_NOT_ALLOWED" });
      expect(await ordersOf(invitation.id)).toEqual([]);
    });

    it("a pending_payment invitation whose order expired can check out again, without a transition", async () => {
      const { user, invitation } = await ownedInvitation("pending_payment");
      await createTestOrder(harness.pool, {
        invitation,
        user,
        status: "expired",
      });

      const order = await service.create(
        verified(user),
        invitation.id,
        checkout,
      );

      expect(order.order_type).toBe("new_publish");
      expect(await statusOf(invitation.id)).toBe("pending_payment");
      expect((await ordersOf(invitation.id)).map((o) => o.status)).toEqual([
        "expired",
        "pending",
      ]);
    });
  });

  // ------------------------------------------------------------- one pending order

  describe("one pending order per invitation", () => {
    it("answers ACTIVE_ORDER_EXISTS naming the existing order", async () => {
      const { user, invitation } = await ownedInvitation();
      const first = await service.create(
        verified(user),
        invitation.id,
        checkout,
      );

      const error = await rejection(() =>
        service.create(verified(user), invitation.id, checkout),
      );

      expect(error).toMatchObject({ status: 409, code: "ACTIVE_ORDER_EXISTS" });
      expect(error.details).toEqual([{ field: "order_id", message: first.id }]);
      expect(await ordersOf(invitation.id)).toHaveLength(1);
    });

    it("two concurrent checkouts make one order and one 409", async () => {
      const { user, invitation } = await ownedInvitation();

      const results = await Promise.allSettled([
        service.create(verified(user), invitation.id, checkout),
        service.create(verified(user), invitation.id, checkout),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({
        status: 409,
        code: "ACTIVE_ORDER_EXISTS",
      });
      expect(await ordersOf(invitation.id)).toHaveLength(1);
      expect(await historyOf(invitation.id)).toHaveLength(1);
    });

    it("ten concurrent checkouts still make exactly one order", async () => {
      const { user, invitation } = await ownedInvitation();

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          service.create(verified(user), invitation.id, checkout),
        ),
      );

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await ordersOf(invitation.id)).toHaveLength(1);
    });

    it("the database refuses a second pending order that bypasses the service (ADR-074)", async () => {
      const { user, invitation } = await ownedInvitation();
      await createTestOrder(harness.pool, {
        invitation,
        user,
        status: "pending",
      });

      await expect(
        createTestOrder(harness.pool, { invitation, user, status: "pending" }),
      ).rejects.toMatchObject({ code: "23505" });

      // Not pending orders are unconstrained: history keeps every failed and expired attempt.
      await createTestOrder(harness.pool, {
        invitation,
        user,
        status: "failed",
      });
      await createTestOrder(harness.pool, {
        invitation,
        user,
        status: "expired",
      });
      expect(await ordersOf(invitation.id)).toHaveLength(3);
    });
  });

  // --------------------------------------------------------------------- idempotency

  describe("Idempotency-Key", () => {
    it("a repeated Idempotency-Key returns the same order", async () => {
      const { user, invitation } = await ownedInvitation();
      const idempotencyKey = randomUUID();

      const first = await service.create(verified(user), invitation.id, {
        ...checkout,
        idempotencyKey,
      });
      const second = await service.create(verified(user), invitation.id, {
        ...checkout,
        idempotencyKey,
      });

      expect(second).toEqual(first);
      expect(await ordersOf(invitation.id)).toHaveLength(1);
    });

    it("two concurrent requests with one key both get the one order", async () => {
      const { user, invitation } = await ownedInvitation();
      const idempotencyKey = randomUUID();

      const [a, b] = await Promise.all([
        service.create(verified(user), invitation.id, {
          ...checkout,
          idempotencyKey,
        }),
        service.create(verified(user), invitation.id, {
          ...checkout,
          idempotencyKey,
        }),
      ]);

      expect(a.id).toBe(b.id);
      expect(await ordersOf(invitation.id)).toHaveLength(1);
    });

    it("refuses a key reused for a different invitation", async () => {
      const { user, invitation } = await ownedInvitation();
      const other = await createTestInvitation(harness.pool, { owner: user });
      const idempotencyKey = randomUUID();

      await service.create(verified(user), invitation.id, {
        ...checkout,
        idempotencyKey,
      });
      const error = await rejection(() =>
        service.create(verified(user), other.id, {
          ...checkout,
          idempotencyKey,
        }),
      );

      expect(error).toMatchObject({
        status: 422,
        code: "IDEMPOTENCY_KEY_REUSED",
      });
      expect(await ordersOf(other.id)).toEqual([]);
    });

    it("does not share a key between users", async () => {
      // The key is namespaced by user: another user's identical key is a different request.
      const alice = await ownedInvitation();
      const bob = await ownedInvitation();
      const idempotencyKey = "shared-key";

      const a = await service.create(
        verified(alice.user),
        alice.invitation.id,
        {
          ...checkout,
          idempotencyKey,
        },
      );
      const b = await service.create(verified(bob.user), bob.invitation.id, {
        ...checkout,
        idempotencyKey,
      });

      expect(b.id).not.toBe(a.id);
      expect(b.invitation_id).toBe(bob.invitation.id);
    });

    it("without Redis, a retry gets the 409 naming the same order rather than a duplicate", async () => {
      const broken = new IORedis("redis://127.0.0.1:1", {
        maxRetriesPerRequest: 0,
        connectTimeout: 200,
        lazyConnect: true,
        retryStrategy: () => null,
      });
      broken.on("error", () => {});
      const degraded = new OrderService(
        new OrderRepository(harness.db),
        new PricingService(new CatalogRepository(harness.db)),
        new InvitationStatusService(harness.db),
        new RedisCache(broken),
      );
      const { user, invitation } = await ownedInvitation();
      const idempotencyKey = randomUUID();

      const first = await degraded.create(verified(user), invitation.id, {
        ...checkout,
        idempotencyKey,
      });
      const error = await rejection(() =>
        degraded.create(verified(user), invitation.id, {
          ...checkout,
          idempotencyKey,
        }),
      );

      expect(error).toMatchObject({ status: 409, code: "ACTIVE_ORDER_EXISTS" });
      expect(error.details).toEqual([{ field: "order_id", message: first.id }]);
      expect(await ordersOf(invitation.id)).toHaveLength(1);
      broken.disconnect();
    });
  });

  // ------------------------------------------------------------------- who may check out

  describe("access", () => {
    it("refuses an unverified user with 403 EMAIL_NOT_VERIFIED, writing nothing", async () => {
      const { user, invitation } = await ownedInvitation();

      const error = await rejection(() =>
        service.create(
          { scope: user.scope, emailVerified: false },
          invitation.id,
          checkout,
        ),
      );

      expect(error).toMatchObject({ status: 403, code: "EMAIL_NOT_VERIFIED" });
      expect(await ordersOf(invitation.id)).toEqual([]);
      expect(await statusOf(invitation.id)).toBe("draft");
    });

    it("answers another user's invitation with 404, and changes nothing", async () => {
      const victim = await ownedInvitation();
      const attacker = await createTestUser(harness.pool);

      await expectServiceIdorSafe(() =>
        service.create(verified(attacker), victim.invitation.id, checkout),
      );

      expect(await ordersOf(victim.invitation.id)).toEqual([]);
      expect(await statusOf(victim.invitation.id)).toBe("draft");
    });

    it("answers a deleted invitation and a non-UUID id with 404", async () => {
      const { user, invitation } = await ownedInvitation();
      await harness.pool.query(
        "UPDATE invitations SET deleted_at = now() WHERE id = $1",
        [invitation.id],
      );

      for (const id of [invitation.id, "not-a-uuid", randomUUID()]) {
        const error = await rejection(() =>
          service.create(verified(user), id, checkout),
        );
        expect(error).toMatchObject({ status: 404, code: "NOT_FOUND" });
      }
      expect(await ordersOf(invitation.id)).toEqual([]);
    });
  });
});
