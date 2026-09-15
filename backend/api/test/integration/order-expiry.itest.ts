import { Redis as IORedis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { RedisCache } from "../../src/infra/cache/redis-cache";
import type { JobQueue } from "../../src/infra/queue/queue.module";
import { CatalogRepository } from "../../src/modules/order/catalog.repository";
import { OrderService } from "../../src/modules/order/order.service";
import { PricingService } from "../../src/modules/order/pricing.service";
import { FakePaymentGateway } from "../../src/modules/payment/fake-payment-gateway";
import { PaymentWebhookService } from "../../src/modules/payment/payment-webhook.service";
import { PaymentRepository } from "../../src/modules/payment/payment.repository";
import { PaymentService } from "../../src/modules/payment/payment.service";
import { InvitationStatusService } from "../../src/shared/invitation-status/invitation-status.service";
import { metrics } from "../../src/shared/metrics/metrics";
import { OrderRepository } from "../../src/shared/tenancy/order-repository";
import { createTestInvitation, createTestUser } from "../support/factories";
import { startHarness, type Harness } from "../support/harness";
import { resetTenantData } from "./helpers.ts";

/**
 * `P3-07` — the expiry sweep and the checkout it must never block, against a real database, with
 * orders created and paid through the real services.
 */

const REDIS_URL =
  process.env["TEST_REDIS_URL"] ??
  process.env["REDIS_URL"] ??
  "redis://localhost:56379";

describe("order expiry (P3-07)", () => {
  let harness: Harness;
  let redis: IORedis;
  let orders: OrderService;
  let payments: PaymentService;
  let webhook: PaymentWebhookService;
  let gateway: FakePaymentGateway;

  const queue: JobQueue = { enqueue: async () => {}, close: async () => {} };

  beforeAll(async () => {
    harness = await startHarness();
    redis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    await redis.ping();
  }, 120_000);

  afterAll(async () => {
    await redis?.quit();
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
    gateway = new FakePaymentGateway("p3-07-test-key");
    orders = new OrderService(
      new OrderRepository(harness.db),
      new PricingService(new CatalogRepository(harness.db)),
      new InvitationStatusService(harness.db),
      new RedisCache(redis),
    );
    const repository = new PaymentRepository(harness.db);
    payments = new PaymentService(orders, repository, gateway);
    webhook = new PaymentWebhookService(gateway, repository, orders, queue);
  });

  const checkout = async (status?: string) => {
    const user = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, {
      owner: user,
      ...(status !== undefined ? { status } : {}),
    });
    const order = await orders.create(
      { scope: user.scope, emailVerified: true },
      invitation.id,
      { packageId: "standard", addonIds: [] },
    );
    return { user, invitation, order };
  };

  const overdue = (orderId: string) =>
    harness.pool.query(
      "UPDATE orders SET expired_at = now() - interval '1 minute' WHERE id = $1",
      [orderId],
    );

  const statusOf = async (orderId: string) => {
    const { rows } = await harness.pool.query<{
      order: string;
      invitation: string;
    }>(
      `SELECT o.status AS order, i.status AS invitation
         FROM orders o JOIN invitations i ON i.id = o.invitation_id WHERE o.id = $1`,
      [orderId],
    );
    return rows[0]!;
  };

  const history = async (invitationId: string) => {
    const { rows } = await harness.pool.query<{
      from_status: string;
      to_status: string;
      changed_by: string | null;
      reason: string;
    }>(
      "SELECT from_status, to_status, changed_by, reason FROM invitation_status_history WHERE invitation_id = $1 ORDER BY created_at",
      [invitationId],
    );
    return rows;
  };

  it("expires an overdue order and returns its invitation to draft, with a history row", async () => {
    const { invitation, order } = await checkout();
    await overdue(order.id);
    const before = metrics.ordersExpired.get({ order_type: "new_publish" });

    expect(await orders.expireOverdueOrders()).toEqual({
      expired: 1,
      skipped: 0,
    });

    expect(await statusOf(order.id)).toEqual({
      order: "expired",
      invitation: "draft",
    });
    expect((await history(invitation.id)).at(-1)).toEqual({
      from_status: "pending_payment",
      to_status: "draft",
      changed_by: null,
      reason: "order expired unpaid",
    });
    expect(metrics.ordersExpired.get({ order_type: "new_publish" })).toBe(
      before + 1,
    );
  });

  it("leaves an order that is not yet due alone", async () => {
    const { order } = await checkout();
    expect(await orders.expireOverdueOrders()).toEqual({
      expired: 0,
      skipped: 0,
    });
    expect(await statusOf(order.id)).toEqual({
      order: "pending",
      invitation: "pending_payment",
    });
  });

  it("expires a renewal order without touching its published invitation", async () => {
    const { invitation, order } = await checkout("published");
    await overdue(order.id);

    await orders.expireOverdueOrders();

    expect(await statusOf(order.id)).toEqual({
      order: "expired",
      invitation: "published",
    });
    expect(await history(invitation.id)).toEqual([]);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const { invitation, order } = await checkout();
    await overdue(order.id);

    await orders.expireOverdueOrders();
    expect(await orders.expireOverdueOrders()).toEqual({
      expired: 0,
      skipped: 0,
    });

    expect(
      (await history(invitation.id)).filter((h) => h.to_status === "draft"),
    ).toHaveLength(1);
  });

  it("two concurrent runs expire each order once", async () => {
    const made = await Promise.all([checkout(), checkout(), checkout()]);
    for (const { order } of made) await overdue(order.id);

    const [a, b] = await Promise.all([
      orders.expireOverdueOrders(),
      orders.expireOverdueOrders(),
    ]);

    expect(a.expired + b.expired).toBe(3);
    for (const { invitation } of made) {
      expect(
        (await history(invitation.id)).filter((h) => h.to_status === "draft"),
      ).toHaveLength(1);
    }
  });

  it("lets the user check out again immediately after the deadline, without waiting for the sweep", async () => {
    // Card DoD 4, and the P3-02 follow-up: an overdue pending order used to answer ACTIVE_ORDER_EXISTS.
    const { user, invitation, order } = await checkout();
    await overdue(order.id);

    const second = await orders.create(
      { scope: user.scope, emailVerified: true },
      invitation.id,
      { packageId: "standard", addonIds: [] },
    );

    expect(second.id).not.toBe(order.id);
    expect(second.order_type).toBe("new_publish");
    expect(await statusOf(order.id)).toMatchObject({ order: "expired" });
    expect(await statusOf(second.id)).toEqual({
      order: "pending",
      invitation: "pending_payment",
    });
    // Sorted: the expiry and the new checkout are written in ONE transaction, so their `created_at`
    // (`now()`, the transaction's start) is identical and their order in a query is not defined.
    expect(
      (await history(invitation.id))
        .map((h) => `${h.from_status}->${h.to_status}`)
        .sort(),
    ).toEqual([
      "draft->pending_payment",
      "draft->pending_payment",
      "pending_payment->draft",
    ]);
  });

  it("still answers ACTIVE_ORDER_EXISTS for a pending order that is not yet due", async () => {
    const { user, invitation } = await checkout();
    await expect(
      orders.create({ scope: user.scope, emailVerified: true }, invitation.id, {
        packageId: "standard",
        addonIds: [],
      }),
    ).rejects.toMatchObject({ status: 409, code: "ACTIVE_ORDER_EXISTS" });
  });

  it("a late success after the job ran is honoured and flagged", async () => {
    // Card DoD 2 against the real sweep: the scheduler ran first, the customer paid anyway.
    const { user, invitation, order } = await checkout();
    await payments.initiate(
      { scope: user.scope, fullName: "Budi", email: user.email },
      order.id,
    );
    const { rows } = await harness.pool.query<{
      provider_reference_id: string;
    }>("SELECT provider_reference_id FROM payments WHERE order_id = $1", [
      order.id,
    ]);
    await overdue(order.id);
    await orders.expireOverdueOrders();
    expect(await statusOf(order.id)).toEqual({
      order: "expired",
      invitation: "draft",
    });

    const result = await webhook.handle(
      "fake",
      gateway.notify(
        rows[0]!.provider_reference_id,
        "success",
        BigInt(order.amount_total),
      ),
    );

    expect(result).toBe("late_payment");
    expect(await statusOf(order.id)).toEqual({
      order: "paid",
      invitation: "paid",
    });
    const { rows: flagged } = await harness.pool.query<{
      needs_review: boolean;
    }>(
      "SELECT needs_review FROM payment_notifications ORDER BY received_at DESC LIMIT 1",
    );
    expect(flagged[0]!.needs_review).toBe(true);
  });
});
