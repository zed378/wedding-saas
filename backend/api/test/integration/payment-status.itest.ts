import { randomUUID } from "node:crypto";

import { Redis as IORedis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { RedisCache } from "../../src/infra/cache/redis-cache";
import type { JobQueue } from "../../src/infra/queue/queue.module";
import { CatalogRepository } from "../../src/modules/order/catalog.repository";
import { OrderService } from "../../src/modules/order/order.service";
import { PricingService } from "../../src/modules/order/pricing.service";
import { FakePaymentGateway } from "../../src/modules/payment/fake-payment-gateway";
import { PaymentReconciliationService } from "../../src/modules/payment/payment-reconciliation.service";
import { PaymentStatusService } from "../../src/modules/payment/payment-status.service";
import { PaymentWebhookService } from "../../src/modules/payment/payment-webhook.service";
import { PaymentRepository } from "../../src/modules/payment/payment.repository";
import { PaymentService } from "../../src/modules/payment/payment.service";
import { InvitationStatusService } from "../../src/shared/invitation-status/invitation-status.service";
import { OrderRepository } from "../../src/shared/tenancy/order-repository";
import { createTestInvitation, createTestUser } from "../support/factories";
import { startHarness, type Harness } from "../support/harness";
import { expectServiceIdorSafe } from "../support/idor";
import { rejection } from "../support/rejection";
import { resetTenantData } from "./helpers.ts";

/**
 * `P3-06` — the status endpoint, its provider-query fallback, and reconciliation.
 *
 * The fake gateway's `notify` both returns a notification and sets what `queryStatus` reports. Calling
 * it WITHOUT delivering the result to the webhook is how these tests simulate "the provider knows, and
 * the webhook never came".
 */

const REDIS_URL =
  process.env["TEST_REDIS_URL"] ??
  process.env["REDIS_URL"] ??
  "redis://localhost:56379";

/** Counts provider queries, so throttling and "never asked" are assertions rather than hopes. */
class CountingGateway extends FakePaymentGateway {
  queries = 0;
  failQueries = false;
  override async queryStatus(reference: string) {
    this.queries += 1;
    if (this.failQueries) throw new Error("provider down");
    return super.queryStatus(reference);
  }
}

describe("payment status and reconciliation (P3-06)", () => {
  let harness: Harness;
  let redis: IORedis;
  let gateway: CountingGateway;
  let orders: OrderService;
  let payments: PaymentService;
  let webhook: PaymentWebhookService;
  let status: PaymentStatusService;
  let reconciliation: PaymentReconciliationService;

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
    gateway = new CountingGateway("p3-06-test-key");
    const cache = new RedisCache(redis);
    orders = new OrderService(
      new OrderRepository(harness.db),
      new PricingService(new CatalogRepository(harness.db)),
      new InvitationStatusService(harness.db),
      cache,
    );
    const repository = new PaymentRepository(harness.db);
    payments = new PaymentService(orders, repository, gateway);
    webhook = new PaymentWebhookService(gateway, repository, orders, queue);
    status = new PaymentStatusService(
      orders,
      repository,
      webhook,
      gateway,
      cache,
    );
    reconciliation = new PaymentReconciliationService(
      repository,
      webhook,
      gateway,
    );
  });

  const paying = async () => {
    const user = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, {
      owner: user,
    });
    const order = await orders.create(
      { scope: user.scope, emailVerified: true },
      invitation.id,
      { packageId: "standard", addonIds: [] },
    );
    await payments.initiate(
      { scope: user.scope, fullName: "Budi", email: user.email },
      order.id,
    );
    const { rows } = await harness.pool.query<{
      provider_reference_id: string;
    }>("SELECT provider_reference_id FROM payments WHERE order_id = $1", [
      order.id,
    ]);
    return {
      user,
      invitation,
      order,
      reference: rows[0]!.provider_reference_id,
      amount: BigInt(order.amount_total),
    };
  };

  const age = (orderId: string, interval: string) =>
    harness.pool.query(
      `UPDATE payments SET created_at = now() - interval '${interval}' WHERE order_id = $1`,
      [orderId],
    );

  const notifications = async () => {
    const { rows } = await harness.pool.query<{
      source: string;
      result: string | null;
      needs_review: boolean;
    }>(
      "SELECT source, result, needs_review FROM payment_notifications ORDER BY received_at",
    );
    return rows;
  };

  const invitationStatus = async (invitationId: string) => {
    const { rows } = await harness.pool.query<{ status: string }>(
      "SELECT status FROM invitations WHERE id = $1",
      [invitationId],
    );
    return rows[0]!.status;
  };

  // ------------------------------------------------------------------ reading

  describe("GET status reads", () => {
    it("reports a pending order and payment, and asks the provider nothing while the payment is fresh", async () => {
      const { user, order, reference, amount } = await paying();
      gateway.notify(reference, "success", amount); // the provider knows; nobody told us yet

      expect(await status.status(user.scope, order.id)).toEqual({
        order_status: "pending",
        payment_status: "pending",
        paid_at: null,
      });
      expect(gateway.queries).toBe(0);
      expect(await notifications()).toEqual([]);
    });

    it("reports paid with paid_at after the webhook", async () => {
      const { user, order, reference, amount } = await paying();
      await webhook.handle(
        "fake",
        gateway.notify(reference, "success", amount),
      );

      const result = await status.status(user.scope, order.id);

      expect(result.order_status).toBe("paid");
      expect(result.payment_status).toBe("success");
      expect(new Date(result.paid_at!).getTime()).toBeGreaterThan(
        Date.now() - 60_000,
      );
    });

    it("reports an order with no payment yet", async () => {
      const user = await createTestUser(harness.pool);
      const invitation = await createTestInvitation(harness.pool, {
        owner: user,
      });
      const order = await orders.create(
        { scope: user.scope, emailVerified: true },
        invitation.id,
        { packageId: "standard", addonIds: [] },
      );
      expect(await status.status(user.scope, order.id)).toEqual({
        order_status: "pending",
        payment_status: null,
        paid_at: null,
      });
    });

    it("answers another user's order with 404, and asks the provider nothing", async () => {
      const { order } = await paying();
      await age(order.id, "10 minutes");
      const attacker = await createTestUser(harness.pool);

      await expectServiceIdorSafe(() =>
        status.status(attacker.scope, order.id),
      );
      expect(gateway.queries).toBe(0);
    });

    it("answers a malformed or unknown id with 404", async () => {
      const { user } = await paying();
      for (const id of ["not-a-uuid", randomUUID()]) {
        expect(
          await rejection(() => status.status(user.scope, id)),
        ).toMatchObject({ status: 404 });
      }
    });
  });

  // ------------------------------------------------------------ the query fallback

  describe("the provider-query fallback", () => {
    it("asks the provider about a stale pending payment and applies the answer through the webhook's path", async () => {
      const { user, invitation, order, reference, amount } = await paying();
      await age(order.id, "10 minutes");
      gateway.notify(reference, "success", amount); // the webhook never came

      const result = await status.status(user.scope, order.id);

      expect(result).toMatchObject({
        order_status: "paid",
        payment_status: "success",
      });
      expect(await invitationStatus(invitation.id)).toBe("paid");
      // One transition path: the same history reason the webhook writes, recorded as a query.
      const { rows } = await harness.pool.query<{ reason: string }>(
        "SELECT reason FROM invitation_status_history WHERE invitation_id = $1 AND to_status = 'paid'",
        [invitation.id],
      );
      expect(rows).toEqual([{ reason: "payment webhook confirmed" }]);
      expect(await notifications()).toEqual([
        { source: "query", result: "applied", needs_review: false },
      ]);
    });

    it("asks at most once per throttle window, however often the page polls", async () => {
      const { user, order } = await paying();
      await age(order.id, "10 minutes");

      for (let i = 0; i < 5; i += 1) await status.status(user.scope, order.id);

      expect(gateway.queries).toBe(1);
    });

    it("answers from the database when the provider cannot be reached", async () => {
      const { user, order } = await paying();
      await age(order.id, "10 minutes");
      gateway.failQueries = true;

      expect(await status.status(user.scope, order.id)).toMatchObject({
        order_status: "pending",
        payment_status: "pending",
      });
      expect(await notifications()).toEqual([]);
    });

    it("a provider answer of pending changes nothing and records nothing", async () => {
      const { user, order, reference, amount } = await paying();
      await age(order.id, "10 minutes");
      gateway.notify(reference, "pending", amount);

      await status.status(user.scope, order.id);
      expect(await notifications()).toEqual([]);
    });
  });

  // ------------------------------------------------------------------ reconciliation

  describe("reconciliation", () => {
    it("recovers a success the webhook never delivered, through the same path, flagged", async () => {
      const { invitation, order, reference, amount } = await paying();
      await age(order.id, "30 minutes");
      gateway.notify(reference, "success", amount);

      const summary = await reconciliation.run();

      expect(summary).toMatchObject({
        checked: 1,
        recovered: 1,
        flagged: 1,
        errors: 0,
      });
      expect(await invitationStatus(invitation.id)).toBe("paid");
      expect(await notifications()).toEqual([
        { source: "reconciliation", result: "applied", needs_review: true },
      ]);
    });

    it("flags an injected mismatch: paid locally, failed at the provider — and changes nothing", async () => {
      const { invitation, order, reference, amount } = await paying();
      await webhook.handle(
        "fake",
        gateway.notify(reference, "success", amount),
      );
      // Inject the disagreement: the provider now reports this payment failed.
      gateway.notify(reference, "failed", amount);

      const summary = await reconciliation.run();

      expect(summary).toMatchObject({ checked: 1, recovered: 0, flagged: 1 });
      expect((await notifications()).at(-1)).toEqual({
        source: "reconciliation",
        result: "reconciliation_mismatch",
        needs_review: true,
      });
      expect(await invitationStatus(invitation.id)).toBe("paid");
      const { rows } = await harness.pool.query<{ status: string }>(
        "SELECT status FROM orders WHERE id = $1",
        [order.id],
      );
      expect(rows[0]!.status).toBe("paid");
    });

    it("flags a paid payment the provider has never heard of", async () => {
      const { order, reference, amount } = await paying();
      const genuine = gateway.notify(reference, "success", amount);
      await webhook.handle("fake", genuine);
      // A fresh gateway instance with the same key: it verifies, but knows no transactions.
      const forgetful = new CountingGateway("p3-06-test-key");
      const repository = new PaymentRepository(harness.db);
      const blind = new PaymentReconciliationService(
        repository,
        new PaymentWebhookService(forgetful, repository, orders, queue),
        forgetful,
      );

      expect(await blind.run()).toMatchObject({ flagged: 1 });
      expect((await notifications()).at(-1)).toMatchObject({
        result: "reconciliation_missing",
      });
      expect(order.id).toBeDefined();
    });

    it("leaves agreeing payments, fresh pending ones and unknown pending ones alone", async () => {
      const agreeing = await paying();
      await webhook.handle(
        "fake",
        gateway.notify(agreeing.reference, "success", agreeing.amount),
      );
      await paying(); // fresh: under ten minutes old
      const abandoned = await paying();
      await age(abandoned.order.id, "30 minutes"); // the provider has no record: never opened

      const summary = await reconciliation.run();

      expect(summary).toEqual({
        checked: 2,
        recovered: 0,
        flagged: 0,
        errors: 0,
      });
      expect(
        (await notifications()).filter((n) => n.source === "reconciliation"),
      ).toEqual([]);
    });

    it("counts a provider failure as an error and keeps going", async () => {
      const { order } = await paying();
      await age(order.id, "30 minutes");
      gateway.failQueries = true;

      expect(await reconciliation.run()).toMatchObject({
        checked: 1,
        errors: 1,
      });
    });
  });
});
