import { randomUUID } from "node:crypto";

import { Redis as IORedis } from "ioredis";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Env } from "../../src/config/env.schema";
import { RedisCache } from "../../src/infra/cache/redis-cache";
import type { JobQueue } from "../../src/infra/queue/queue.module";
import { CatalogRepository } from "../../src/modules/order/catalog.repository";
import { InvoiceRepository } from "../../src/modules/order/invoice/invoice.repository";
import { InvoiceService } from "../../src/modules/order/invoice/invoice.service";
import { OrderService } from "../../src/modules/order/order.service";
import { PricingService } from "../../src/modules/order/pricing.service";
import { FakePaymentGateway } from "../../src/modules/payment/fake-payment-gateway";
import { PaymentWebhookService } from "../../src/modules/payment/payment-webhook.service";
import { PaymentRepository } from "../../src/modules/payment/payment.repository";
import { PaymentService } from "../../src/modules/payment/payment.service";
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
import { applicationPool, resetTenantData } from "./helpers.ts";

/**
 * `P3-08` — order history and invoices, through the real checkout, payment, webhook and expiry paths.
 */

const REDIS_URL =
  process.env["TEST_REDIS_URL"] ??
  process.env["REDIS_URL"] ??
  "redis://localhost:56379";

describe("order history and invoices (P3-08)", () => {
  let harness: Harness;
  let redis: IORedis;
  let gateway: FakePaymentGateway;
  let orders: OrderService;
  let payments: PaymentService;
  let webhook: PaymentWebhookService;
  let invoices: InvoiceService;
  let enqueued: { name: string; data: Record<string, unknown> }[];

  const queue: JobQueue = {
    enqueue: async (_pool, name, data) => {
      enqueued.push({ name, data });
    },
    close: async () => {},
  };

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
    enqueued = [];
    gateway = new FakePaymentGateway("p3-08-test-key");
    const orderRepository = new OrderRepository(harness.db);
    orders = new OrderService(
      orderRepository,
      new PricingService(new CatalogRepository(harness.db)),
      new InvitationStatusService(harness.db),
      new RedisCache(redis),
    );
    const repository = new PaymentRepository(harness.db);
    payments = new PaymentService(orders, repository, gateway);
    webhook = new PaymentWebhookService(gateway, repository, orders, queue);
    invoices = new InvoiceService(
      new InvoiceRepository(harness.db),
      orderRepository,
      { INVOICE_SELLER_NAME: "vizunicum.my.id" } as Env,
    );
  });

  const verified = (user: TestUser) => ({
    scope: user.scope,
    emailVerified: true,
  });

  const paid = async (user?: TestUser, status?: string) => {
    const owner =
      user ??
      (await createTestUser(harness.pool, { fullName: "Budi Santoso" }));
    const invitation = await createTestInvitation(harness.pool, {
      owner,
      ...(status !== undefined ? { status } : {}),
    });
    const order = await orders.create(verified(owner), invitation.id, {
      packageId: "standard",
      addonIds: [],
    });
    await payments.initiate(
      { scope: owner.scope, fullName: "Budi Santoso", email: owner.email },
      order.id,
    );
    const { rows } = await harness.pool.query<{
      provider_reference_id: string;
    }>("SELECT provider_reference_id FROM payments WHERE order_id = $1", [
      order.id,
    ]);
    await webhook.handle(
      "fake",
      gateway.notify(
        rows[0]!.provider_reference_id,
        "success",
        BigInt(order.amount_total),
      ),
    );
    return { user: owner, invitation, order };
  };

  // ------------------------------------------------------------------- history

  describe("GET /orders and /orders/:order_id", () => {
    it("lists the caller's orders newest first with current status, including one the sweep expired", async () => {
      const { user, order: paidOrder } = await paid();
      const other = await createTestInvitation(harness.pool, { owner: user });
      const lapsed = await orders.create(verified(user), other.id, {
        packageId: "standard",
        addonIds: [],
      });
      await harness.pool.query(
        "UPDATE orders SET expired_at = now() - interval '1 minute' WHERE id = $1",
        [lapsed.id],
      );
      await orders.expireOverdueOrders();

      const { items, total } = await orders.list(user.scope, {
        limit: 20,
        offset: 0,
      });

      expect(total).toBe(2);
      expect(items.map((o) => [o.id, o.status, o.invoice_available])).toEqual([
        [lapsed.id, "expired", false],
        [paidOrder.id, "paid", true],
      ]);
      expect(items[1]!.paid_at).not.toBeNull();
      expect(items[0]!.paid_at).toBeNull();
    });

    it("never lists another user's orders", async () => {
      await paid();
      const stranger = await createTestUser(harness.pool);
      expect(
        await orders.list(stranger.scope, { limit: 20, offset: 0 }),
      ).toEqual({ items: [], total: 0 });
    });

    it("paginates", async () => {
      const { user } = await paid();
      for (let i = 0; i < 2; i += 1) {
        const inv = await createTestInvitation(harness.pool, { owner: user });
        await orders.create(verified(user), inv.id, {
          packageId: "standard",
          addonIds: [],
        });
      }
      const page = await orders.list(user.scope, { limit: 2, offset: 2 });
      expect(page.total).toBe(3);
      expect(page.items).toHaveLength(1);
    });

    it("shows one order in detail, and 404 to anyone else", async () => {
      const { user, order } = await paid();
      expect(await orders.detail(user.scope, order.id)).toMatchObject({
        id: order.id,
        status: "paid",
      });

      const stranger = await createTestUser(harness.pool);
      await expectServiceIdorSafe(() =>
        orders.detail(stranger.scope, order.id),
      );
      for (const id of ["not-a-uuid", randomUUID()]) {
        expect(
          await rejection(() => orders.detail(user.scope, id)),
        ).toMatchObject({ status: 404 });
      }
    });
  });

  // ------------------------------------------------------------------ invoices

  describe("invoices", () => {
    it("the webhook queues invoice generation after commit, and the job renders it once", async () => {
      const { order } = await paid();

      expect(enqueued.filter((j) => j.name === "invoice.generate")).toEqual([
        { name: "invoice.generate", data: { orderId: order.id } },
      ]);

      const first = await invoices.generate(order.id);
      const second = await invoices.generate(order.id);

      expect(first!.number).toMatch(/^INV-\d{8}-[0-9A-F]{8}$/);
      expect(second).toEqual(first);
      const { rows } = await harness.pool.query(
        "SELECT count(*)::int AS n FROM invoices WHERE order_id = $1",
        [order.id],
      );
      expect(rows[0].n).toBe(1);
      const text = first!.pdf.toString("latin1");
      expect(text.startsWith("%PDF-1.4")).toBe(true);
      expect(text).toContain("(Budi Santoso)");
      expect(text).toContain("(Publikasi)");
    });

    it("serves the owner's invoice, generating it if the job never ran", async () => {
      const { user, order } = await paid();
      const issued = await invoices.ownedInvoice(user.scope, order.id);
      expect(issued.pdf.toString("latin1")).toContain(`(${issued.number})`);
    });

    it.each(["pending", "expired", "failed", "refunded"])(
      "refuses an invoice for a %s order, and generates none",
      async (status) => {
        const user = await createTestUser(harness.pool);
        const invitation = await createTestInvitation(harness.pool, {
          owner: user,
        });
        const order = await orders.create(verified(user), invitation.id, {
          packageId: "standard",
          addonIds: [],
        });
        await harness.pool.query(
          "UPDATE orders SET status = $1 WHERE id = $2",
          [status, order.id],
        );

        expect(
          await rejection(() => invoices.ownedInvoice(user.scope, order.id)),
        ).toMatchObject({
          status: 422,
          code: "INVOICE_NOT_AVAILABLE",
        });
        expect(await invoices.generate(order.id)).toBeNull();
        const { rows } = await harness.pool.query(
          "SELECT count(*)::int AS n FROM invoices",
        );
        expect(rows[0].n).toBe(0);
      },
    );

    it("answers another user's invoice with 404", async () => {
      const { order } = await paid();
      const stranger = await createTestUser(harness.pool);
      await expectServiceIdorSafe(() =>
        invoices.ownedInvoice(stranger.scope, order.id),
      );
    });

    it("a failing invoice job leaves the payment exactly as it was", async () => {
      const { order } = await paid();
      const broken = new InvoiceService(
        {
          findByOrder: async () => null,
          source: async () => {
            throw new Error("renderer down");
          },
        } as unknown as InvoiceRepository,
        new OrderRepository(harness.db),
        { INVOICE_SELLER_NAME: "x" } as Env,
      );

      await expect(broken.generate(order.id)).rejects.toThrow("renderer down");

      const { rows } = await harness.pool.query<{
        order: string;
        payment: string;
      }>(
        `SELECT o.status AS order, p.status AS payment FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.id = $1`,
        [order.id],
      );
      expect(rows[0]).toEqual({ order: "paid", payment: "success" });
    });

    it("calls a trial invitation's first payment a first purchase, not a renewal", async () => {
      // P3-02 types it `renewal` (the trial is `published`); the customer bought it for the first time.
      const { order } = await paid(undefined, "published");
      expect(order.order_type).toBe("renewal");
      const text = (await invoices.generate(order.id))!.pdf.toString("latin1");
      expect(text).toContain("(Publikasi)");
      expect(text).not.toContain("(Perpanjangan)");
    });

    describe("issued invoices are immutable for the application role (ADR-079)", () => {
      let app: Pool;
      beforeAll(() => {
        app = applicationPool();
      });
      afterAll(async () => {
        await app.end();
      });

      it("cannot update or delete an invoice", async () => {
        const { order } = await paid();
        await invoices.generate(order.id);
        await expect(
          app.query("UPDATE invoices SET number = 'X' WHERE order_id = $1", [
            order.id,
          ]),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          app.query("DELETE FROM invoices WHERE order_id = $1", [order.id]),
        ).rejects.toMatchObject({
          code: "42501",
        });
      });
    });
  });
});
