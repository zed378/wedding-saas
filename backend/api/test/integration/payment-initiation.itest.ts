import { randomUUID } from "node:crypto";

import { Redis as IORedis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { RedisCache } from "../../src/infra/cache/redis-cache";
import { CatalogRepository } from "../../src/modules/order/catalog.repository";
import { OrderService } from "../../src/modules/order/order.service";
import { PricingService } from "../../src/modules/order/pricing.service";
import { FakePaymentGateway } from "../../src/modules/payment/fake-payment-gateway";
import type {
  CreateTransactionInput,
  CreatedTransaction,
  PaymentGatewayPort,
} from "../../src/modules/payment/payment-gateway.port";
import { PaymentRepository } from "../../src/modules/payment/payment.repository";
import {
  PaymentService,
  type PayingUser,
} from "../../src/modules/payment/payment.service";
import { InvitationStatusService } from "../../src/shared/invitation-status/invitation-status.service";
import { OrderRepository } from "../../src/shared/tenancy/order-repository";
import {
  createTestInvitation,
  createTestUser,
  type TestUser,
} from "../support/factories";
import { startHarness, type Harness } from "../support/harness";
import { expectServiceIdorSafe } from "../support/idor";
import { rejection } from "../support/rejection";
import { resetTenantData } from "./helpers.ts";

/**
 * `P3-04` — payment initiation against a real database, through the real order service.
 *
 * Orders are created by `OrderService.create` rather than inserted, so the invitation really is in
 * `pending_payment` and "the provider outage leaves order and invitation status untouched" is checked
 * against the state checkout actually produces.
 */

const REDIS_URL =
  process.env["TEST_REDIS_URL"] ??
  process.env["REDIS_URL"] ??
  "redis://localhost:56379";

/** A gateway that answers only when released — for proving what happens during the provider call. */
class GatedGateway implements PaymentGatewayPort {
  readonly provider = "fake";
  readonly inner = new FakePaymentGateway();
  calls = 0;
  private release!: () => void;
  readonly released = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  async createTransaction(
    input: CreateTransactionInput,
  ): Promise<CreatedTransaction> {
    this.calls += 1;
    await this.released;
    return this.inner.createTransaction(input);
  }
  open(): void {
    this.release();
  }
  verifyNotification(body: unknown) {
    return this.inner.verifyNotification(body);
  }
  queryStatus(reference: string) {
    return this.inner.queryStatus(reference);
  }
}

describe("payment initiation (P3-04)", () => {
  let harness: Harness;
  let redis: IORedis;
  let orders: OrderService;
  let repository: PaymentRepository;

  beforeAll(async () => {
    harness = await startHarness();
    redis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    await redis.ping();
    orders = new OrderService(
      new OrderRepository(harness.db),
      new PricingService(new CatalogRepository(harness.db)),
      new InvitationStatusService(harness.db),
      new RedisCache(redis),
    );
    repository = new PaymentRepository(harness.db);
  }, 120_000);

  afterAll(async () => {
    await redis?.quit();
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
  });

  const serviceWith = (gateway: PaymentGatewayPort) =>
    new PaymentService(orders, repository, gateway);

  const payer = (user: TestUser): PayingUser => ({
    scope: user.scope,
    fullName: "Budi Santoso",
    email: user.email,
  });

  /** A real checkout: invitation → order through `OrderService`. */
  const checkedOut = async () => {
    const user = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, {
      owner: user,
    });
    const order = await orders.create(
      { scope: user.scope, emailVerified: true },
      invitation.id,
      { packageId: "standard", addonIds: [] },
    );
    return { user, invitation, order };
  };

  const paymentsOf = async (orderId: string) => {
    const { rows } = await harness.pool.query<{
      id: string;
      provider: string;
      provider_reference_id: string;
      amount: string;
      status: string;
      checkout_url: string | null;
    }>(
      "SELECT id, provider, provider_reference_id, amount::text, status, checkout_url FROM payments WHERE order_id = $1 ORDER BY created_at",
      [orderId],
    );
    return rows;
  };

  const statuses = async (orderId: string, invitationId: string) => {
    const { rows } = await harness.pool.query<{
      order: string;
      invitation: string;
    }>(
      `SELECT o.status AS order, i.status AS invitation
         FROM orders o JOIN invitations i ON i.id = o.invitation_id
        WHERE o.id = $1 AND i.id = $2`,
      [orderId, invitationId],
    );
    return rows[0]!;
  };

  it("records a pending payment for the order's amount and returns only the checkout", async () => {
    const gateway = new FakePaymentGateway();
    const { user, order } = await checkedOut();

    const checkout = await serviceWith(gateway).initiate(payer(user), order.id);

    expect(Object.keys(checkout).sort()).toEqual([
      "expires_at",
      "redirect_url",
      "token",
    ]);
    expect(checkout.expires_at).toBe(order.expired_at);

    const rows = await paymentsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "fake",
      amount: String(order.amount_total),
      status: "pending",
      checkout_url: checkout.redirect_url,
    });
    expect(rows[0]!.provider_reference_id).toMatch(
      new RegExp(`^${order.id}-[0-9a-f]{8}$`),
    );
    expect(rows[0]!.provider_reference_id.length).toBeLessThanOrEqual(50);

    // The amount the provider was asked for is the order row's; the customer is name + email only.
    expect(gateway.created).toEqual([
      {
        providerReferenceId: rows[0]!.provider_reference_id,
        amount: BigInt(order.amount_total),
        customer: { name: "Budi Santoso", email: user.email },
      },
    ]);
  });

  it("has the payment row committed before the provider is even called", async () => {
    const gateway = new GatedGateway();
    const { user, order } = await checkedOut();

    const pending = serviceWith(gateway).initiate(payer(user), order.id);
    await expect.poll(() => gateway.calls).toBe(1);

    // Mid-call: a notification arriving now would find its row.
    const rows = await paymentsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.checkout_url).toBeNull();

    gateway.open();
    await pending;
  });

  it("a second initiation returns the same checkout without calling the provider", async () => {
    const gateway = new FakePaymentGateway();
    const { user, order } = await checkedOut();
    const service = serviceWith(gateway);

    const first = await service.initiate(payer(user), order.id);
    const second = await service.initiate(payer(user), order.id);

    expect(second).toEqual(first);
    expect(gateway.created).toHaveLength(1);
    expect(await paymentsOf(order.id)).toHaveLength(1);
  });

  it("two concurrent initiations call the provider once; the other is told to wait", async () => {
    const gateway = new GatedGateway();
    const { user, order } = await checkedOut();
    const service = serviceWith(gateway);

    const first = service.initiate(payer(user), order.id);
    await expect.poll(() => gateway.calls).toBe(1);
    const second = await rejection(() =>
      service.initiate(payer(user), order.id),
    );

    expect(second).toMatchObject({ status: 409, code: "PAYMENT_IN_PROGRESS" });
    gateway.open();
    await first;
    expect(gateway.calls).toBe(1);
    expect(await paymentsOf(order.id)).toHaveLength(1);
  });

  it("recovers an initiation that died mid-call: marks it failed and starts again", async () => {
    const gateway = new FakePaymentGateway();
    const { user, order } = await checkedOut();
    await harness.pool.query(
      `INSERT INTO payments (order_id, provider, provider_reference_id, amount, status, created_at)
       VALUES ($1, 'fake', $2, $3, 'pending', now() - interval '5 minutes')`,
      [order.id, `${order.id}-dead0000`, order.amount_total],
    );

    await serviceWith(gateway).initiate(payer(user), order.id);

    expect((await paymentsOf(order.id)).map((p) => p.status)).toEqual([
      "failed",
      "pending",
    ]);
    expect(gateway.created).toHaveLength(1);
  });

  it.each(["retryable", "refused"] as const)(
    "a %s provider failure answers 503 and leaves the order and invitation untouched",
    async (outage) => {
      const gateway = new FakePaymentGateway();
      gateway.outage = outage;
      const { user, invitation, order } = await checkedOut();

      const error = await rejection(() =>
        serviceWith(gateway).initiate(payer(user), order.id),
      );

      expect(error).toMatchObject({ status: 503, code: "PAYMENT_UNAVAILABLE" });
      expect(await statuses(order.id, invitation.id)).toEqual({
        order: "pending",
        invitation: "pending_payment",
      });
      expect((await paymentsOf(order.id)).map((p) => p.status)).toEqual([
        "failed",
      ]);

      // And the customer can simply try again once the provider is back.
      gateway.outage = "none";
      await serviceWith(gateway).initiate(payer(user), order.id);
      expect((await paymentsOf(order.id)).map((p) => p.status)).toEqual([
        "failed",
        "pending",
      ]);
    },
  );

  describe("refuses an order that is not payable, without calling the provider", () => {
    it.each(["paid", "expired", "failed", "refunded"])(
      "status %s",
      async (status) => {
        const gateway = new FakePaymentGateway();
        const { user, order } = await checkedOut();
        await harness.pool.query(
          "UPDATE orders SET status = $1 WHERE id = $2",
          [status, order.id],
        );

        const error = await rejection(() =>
          serviceWith(gateway).initiate(payer(user), order.id),
        );

        expect(error).toMatchObject({ status: 422, code: "ORDER_NOT_PAYABLE" });
        expect(gateway.created).toEqual([]);
        expect(await paymentsOf(order.id)).toEqual([]);
      },
    );

    it("still pending but past its deadline", async () => {
      const gateway = new FakePaymentGateway();
      const { user, order } = await checkedOut();
      await harness.pool.query(
        "UPDATE orders SET expired_at = now() - interval '1 second' WHERE id = $1",
        [order.id],
      );
      const error = await rejection(() =>
        serviceWith(gateway).initiate(payer(user), order.id),
      );
      expect(error).toMatchObject({ status: 422, code: "ORDER_NOT_PAYABLE" });
      expect(gateway.created).toEqual([]);
    });
  });

  it("answers another user's order with 404, calling nothing and writing nothing", async () => {
    const gateway = new FakePaymentGateway();
    const { order } = await checkedOut();
    const attacker = await createTestUser(harness.pool);

    await expectServiceIdorSafe(() =>
      serviceWith(gateway).initiate(payer(attacker), order.id),
    );
    expect(gateway.created).toEqual([]);
    expect(await paymentsOf(order.id)).toEqual([]);
  });

  it("answers a malformed or unknown order id with 404", async () => {
    const { user } = await checkedOut();
    for (const id of ["not-a-uuid", randomUUID()]) {
      const error = await rejection(() =>
        serviceWith(new FakePaymentGateway()).initiate(payer(user), id),
      );
      expect(error).toMatchObject({ status: 404, code: "NOT_FOUND" });
    }
  });
});
