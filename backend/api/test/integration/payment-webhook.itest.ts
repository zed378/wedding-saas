import { Redis as IORedis } from "ioredis";
import type { Pool } from "pg";
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
import { rejection } from "../support/rejection";
import { applicationPool, resetTenantData } from "./helpers.ts";

/**
 * `P3-05` — the webhook, against a real database, driven by the fake gateway's genuine, forged,
 * tampered, duplicate and out-of-order notifications.
 *
 * Every test asserts the rows afterwards — payment, order, invitation, history, notification log and
 * queued jobs — because a webhook that answered correctly while leaving one table behind is exactly
 * the failure the card's "all three tables together" is about.
 */

const REDIS_URL =
  process.env["TEST_REDIS_URL"] ??
  process.env["REDIS_URL"] ??
  "redis://localhost:56379";

describe("payment webhook (P3-05)", () => {
  let harness: Harness;
  let redis: IORedis;
  let gateway: FakePaymentGateway;
  let orders: OrderService;
  let repository: PaymentRepository;
  let payments: PaymentService;
  let webhook: PaymentWebhookService;
  let enqueued: { name: string; data: unknown; key?: string }[];

  const queue: JobQueue = {
    enqueue: async (_pool, name, data, options) => {
      enqueued.push({
        name,
        data,
        ...(options?.idempotencyKey ? { key: options.idempotencyKey } : {}),
      });
    },
    close: async () => {},
  };

  const build = (status = new InvitationStatusService(harness.db)) => {
    orders = new OrderService(
      new OrderRepository(harness.db),
      new PricingService(new CatalogRepository(harness.db)),
      status,
      new RedisCache(redis),
    );
    repository = new PaymentRepository(harness.db);
    payments = new PaymentService(orders, repository, gateway);
    webhook = new PaymentWebhookService(gateway, repository, orders, queue);
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
    gateway = new FakePaymentGateway("p3-05-test-signing-key");
    enqueued = [];
    build();
  });

  /** Checkout and open a payment page, as a customer would. */
  const paying = async (
    orderType: "new_publish" | "renewal" = "new_publish",
  ) => {
    const user = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, {
      owner: user,
      ...(orderType === "renewal" ? { status: "published" } : {}),
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

  const state = async (orderId: string) => {
    const { rows } = await harness.pool.query<{
      payment: string;
      signature_valid: boolean | null;
      verified: boolean;
      raw: boolean;
      order: string;
      invitation: string;
    }>(
      `SELECT p.status AS payment, p.signature_valid, p.verified_at IS NOT NULL AS verified,
              p.raw_callback_payload IS NOT NULL AS raw, o.status AS order, i.status AS invitation
         FROM payments p JOIN orders o ON o.id = p.order_id JOIN invitations i ON i.id = o.invitation_id
        WHERE o.id = $1 ORDER BY p.created_at DESC LIMIT 1`,
      [orderId],
    );
    return rows[0]!;
  };

  const history = async (invitationId: string) => {
    const { rows } = await harness.pool.query<{
      from_status: string | null;
      to_status: string;
      changed_by: string | null;
      reason: string;
    }>(
      "SELECT from_status, to_status, changed_by, reason FROM invitation_status_history WHERE invitation_id = $1 ORDER BY created_at",
      [invitationId],
    );
    return rows;
  };

  const notifications = async () => {
    const { rows } = await harness.pool.query<{
      signature_valid: boolean;
      rejection_reason: string | null;
      claimed_reference: string | null;
      payment_id: string | null;
      result: string | null;
      needs_review: boolean;
      raw_payload: unknown;
    }>(
      "SELECT signature_valid, rejection_reason, claimed_reference, payment_id, result, needs_review, raw_payload FROM payment_notifications ORDER BY received_at",
    );
    return rows;
  };

  const paidJobs = () => enqueued.filter((j) => j.name === "notification.send");

  // ------------------------------------------------------------------ the happy path

  it("a verified success pays the payment, the order and the invitation together, then queues order.paid", async () => {
    const { invitation, order, reference, amount } = await paying();

    const result = await webhook.handle(
      "fake",
      gateway.notify(reference, "success", amount),
    );

    expect(result).toBe("applied");
    expect(await state(order.id)).toEqual({
      payment: "success",
      signature_valid: true,
      verified: true,
      raw: true,
      order: "paid",
      invitation: "paid",
    });
    expect((await history(invitation.id)).at(-1)).toEqual({
      from_status: "pending_payment",
      to_status: "paid",
      changed_by: null,
      reason: "payment webhook confirmed",
    });
    expect(paidJobs()).toEqual([
      {
        name: "notification.send",
        data: { template: "order_paid", orderId: order.id },
        key: `order.paid:${order.id}`,
      },
    ]);
    expect(await notifications()).toMatchObject([
      {
        signature_valid: true,
        result: "applied",
        needs_review: false,
        claimed_reference: reference,
      },
    ]);
  });

  // ------------------------------------------------------------------- forgeries (401)

  describe("an invalid notification changes nothing", () => {
    it("a forged success changes nothing, answers 401, is recorded and counted", async () => {
      const { invitation, order, reference, amount } = await paying();
      const before = metrics.paymentWebhookSignatureInvalid.get({
        provider: "fake",
        reason: "signature_mismatch",
      });

      const error = await rejection(() =>
        webhook.handle("fake", gateway.forge(reference, "success", amount)),
      );

      expect(error).toMatchObject({ status: 401 });
      expect(await state(order.id)).toMatchObject({
        payment: "pending",
        signature_valid: null,
        verified: false,
        order: "pending",
        invitation: "pending_payment",
      });
      expect((await history(invitation.id)).map((h) => h.to_status)).toEqual([
        "pending_payment",
      ]);
      expect(paidJobs()).toEqual([]);
      expect(await notifications()).toMatchObject([
        {
          signature_valid: false,
          rejection_reason: "signature_mismatch",
          claimed_reference: reference,
          payment_id: null,
          result: null,
        },
      ]);
      expect(
        metrics.paymentWebhookSignatureInvalid.get({
          provider: "fake",
          reason: "signature_mismatch",
        }),
      ).toBe(before + 1);
    });

    it("a notification without a signature is refused the same way", async () => {
      const { order, reference, amount } = await paying();
      const genuine = gateway.notify(reference, "success", amount);
      const { signature: _signature, ...unsigned } = genuine;

      const error = await rejection(() => webhook.handle("fake", unsigned));

      expect(error).toMatchObject({ status: 401 });
      expect((await state(order.id)).order).toBe("pending");
      expect(await notifications()).toMatchObject([
        { signature_valid: false, rejection_reason: "malformed" },
      ]);
    });

    it("a genuine notification tampered to a success changes nothing", async () => {
      const { order, reference, amount } = await paying();
      const pending = gateway.notify(reference, "pending", amount);

      await expect(
        webhook.handle("fake", gateway.tamper(pending, { outcome: "success" })),
      ).rejects.toMatchObject({ status: 401 });
      expect((await state(order.id)).payment).toBe("pending");
    });

    it("a forged notification naming a real payment does not touch it", async () => {
      // ADR-077: the forgery is its own row; the genuine payment's record is untouched.
      const { order, reference, amount } = await paying();
      await webhook.handle(
        "fake",
        gateway.notify(reference, "success", amount),
      );
      const { rows: before } = await harness.pool.query(
        "SELECT status, signature_valid, verified_at, raw_callback_payload FROM payments WHERE order_id = $1",
        [order.id],
      );

      await expect(
        webhook.handle("fake", gateway.forge(reference, "failed", amount)),
      ).rejects.toMatchObject({ status: 401 });

      const { rows: after } = await harness.pool.query(
        "SELECT status, signature_valid, verified_at, raw_callback_payload FROM payments WHERE order_id = $1",
        [order.id],
      );
      expect(after).toEqual(before);
    });

    it("does not store an oversized or non-object forged payload", async () => {
      await expect(webhook.handle("fake", ["a", "list"])).rejects.toMatchObject(
        { status: 401 },
      );
      await expect(
        webhook.handle("fake", { reference: "x", junk: "y".repeat(10_000) }),
      ).rejects.toMatchObject({ status: 401 });
      expect((await notifications()).map((n) => n.raw_payload)).toEqual([
        null,
        null,
      ]);
    });

    it("answers a provider that is not configured with 404, recording nothing", async () => {
      const { reference, amount } = await paying();
      await expect(
        webhook.handle(
          "midtrans",
          gateway.notify(reference, "success", amount),
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(await notifications()).toEqual([]);
    });
  });

  // ------------------------------------------------------------------ idempotency

  describe("exactly once", () => {
    it("the same success delivered five times makes one state change and one order.paid", async () => {
      const { invitation, order, reference, amount } = await paying();
      const notification = gateway.notify(reference, "success", amount);

      const results: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        results.push(await webhook.handle("fake", { ...notification }));
      }

      expect(results).toEqual([
        "applied",
        "duplicate",
        "duplicate",
        "duplicate",
        "duplicate",
      ]);
      expect(
        (await history(invitation.id)).filter((h) => h.to_status === "paid"),
      ).toHaveLength(1);
      expect(paidJobs()).toHaveLength(1);
      expect((await state(order.id)).order).toBe("paid");
      expect(await notifications()).toHaveLength(5);
    });

    it("five concurrent deliveries still make exactly one change", async () => {
      const { invitation, reference, amount } = await paying();
      const notification = gateway.notify(reference, "success", amount);

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          webhook.handle("fake", { ...notification }),
        ),
      );

      expect(results.filter((r) => r === "applied")).toHaveLength(1);
      expect(results.filter((r) => r === "duplicate")).toHaveLength(4);
      expect(
        (await history(invitation.id)).filter((h) => h.to_status === "paid"),
      ).toHaveLength(1);
      expect(paidJobs()).toHaveLength(1);
    });

    it("a failure arriving after the success changes nothing (out of order)", async () => {
      const { order, reference, amount } = await paying();
      const pendingFirst = gateway.notify(reference, "pending", amount);
      const failedLater = gateway.notify(reference, "failed", amount);
      const success = gateway.notify(reference, "success", amount);

      await webhook.handle("fake", success);
      expect(await webhook.handle("fake", failedLater)).toBe("no_change");
      expect(await webhook.handle("fake", pendingFirst)).toBe("no_change");

      expect(await state(order.id)).toMatchObject({
        payment: "success",
        order: "paid",
        invitation: "paid",
      });
    });
  });

  // --------------------------------------------------------------------- atomicity

  it("a failure mid-transaction rolls back payment, order and invitation together", async () => {
    const { invitation, order, reference, amount } = await paying();
    // The status writer throws AFTER the payment and order updates in the same transaction.
    const broken = new InvitationStatusService(harness.db);
    broken.transitionWithin = async () => {
      throw new Error("simulated database failure mid-transaction");
    };
    build(broken);

    await expect(
      webhook.handle("fake", gateway.notify(reference, "success", amount)),
    ).rejects.toThrow("simulated database failure");

    expect(await state(order.id)).toMatchObject({
      payment: "pending",
      verified: false,
      order: "pending",
      invitation: "pending_payment",
    });
    expect((await history(invitation.id)).map((h) => h.to_status)).toEqual([
      "pending_payment",
    ]);
    expect(paidJobs()).toEqual([]);
    // The arrival itself is kept, unprocessed, and the provider's retry then succeeds.
    expect(await notifications()).toMatchObject([
      { signature_valid: true, result: null },
    ]);

    build();
    expect(
      await webhook.handle(
        "fake",
        gateway.notify(reference, "success", amount),
      ),
    ).toBe("applied");
    expect((await state(order.id)).invitation).toBe("paid");
  });

  // ------------------------------------------------------------------ anomalies (200 + review)

  describe("verified but not straightforward", () => {
    it("a verified notification for an unknown payment answers normally, changes nothing, is flagged", async () => {
      const result = await webhook.handle(
        "fake",
        gateway.notify(
          "00000000-0000-4000-8000-000000000000-deadbeef",
          "success",
          139000n,
        ),
      );
      expect(result).toBe("unknown_reference");
      expect(await notifications()).toMatchObject([
        {
          signature_valid: true,
          result: "unknown_reference",
          needs_review: true,
          payment_id: null,
        },
      ]);
      expect(paidJobs()).toEqual([]);
    });

    it("a success for a different amount grants nothing", async () => {
      const { order, reference, amount } = await paying();

      const result = await webhook.handle(
        "fake",
        gateway.notify(reference, "success", amount - 1n),
      );

      expect(result).toBe("amount_mismatch");
      expect(await state(order.id)).toMatchObject({
        payment: "pending",
        order: "pending",
        invitation: "pending_payment",
      });
      expect(await notifications()).toMatchObject([
        { result: "amount_mismatch", needs_review: true },
      ]);
      expect(paidJobs()).toEqual([]);
    });

    it("a success after the order expired is applied and flagged (SECURITY/07 § Timeout & Expiry)", async () => {
      const { invitation, order, reference, amount } = await paying();
      // What P3-07's expiry does: order expired, invitation back to draft.
      await harness.pool.query(
        "UPDATE orders SET status = 'expired' WHERE id = $1",
        [order.id],
      );
      await new InvitationStatusService(harness.db).transition(
        invitation.id,
        "draft",
        {
          kind: "SYSTEM",
          userId: null,
        },
      );

      const result = await webhook.handle(
        "fake",
        gateway.notify(reference, "success", amount),
      );

      expect(result).toBe("late_payment");
      expect(await state(order.id)).toMatchObject({
        payment: "success",
        order: "paid",
        invitation: "paid",
      });
      expect((await history(invitation.id)).at(-1)).toMatchObject({
        from_status: "draft",
        to_status: "paid",
        changed_by: null,
      });
      expect(await notifications()).toMatchObject([
        { result: "late_payment", needs_review: true },
      ]);
      expect(paidJobs()).toHaveLength(1);
    });

    it("a second successful payment for an already-paid order is flagged, not granted twice", async () => {
      const { invitation, order, reference, amount } = await paying();
      await webhook.handle(
        "fake",
        gateway.notify(reference, "success", amount),
      );
      // A second payment attempt on the same order that also got paid.
      const { rows } = await harness.pool.query<{ id: string }>(
        `INSERT INTO payments (order_id, provider, provider_reference_id, amount, status)
         VALUES ($1, 'fake', $2, $3, 'failed') RETURNING id`,
        [order.id, `${order.id}-second00`, String(amount)],
      );
      expect(rows).toHaveLength(1);

      const result = await webhook.handle(
        "fake",
        gateway.notify(`${order.id}-second00`, "success", amount),
      );

      expect(result).toBe("duplicate_charge");
      expect(
        (await history(invitation.id)).filter((h) => h.to_status === "paid"),
      ).toHaveLength(1);
      expect(paidJobs()).toHaveLength(1);
      expect((await notifications()).at(-1)).toMatchObject({
        result: "duplicate_charge",
        needs_review: true,
      });
    });

    it("a refund notification is recorded and flagged; the paid order is untouched", async () => {
      const { order, reference, amount } = await paying();
      await webhook.handle(
        "fake",
        gateway.notify(reference, "success", amount),
      );

      expect(
        await webhook.handle(
          "fake",
          gateway.notify(reference, "ignored", amount),
        ),
      ).toBe("ignored");
      expect(await state(order.id)).toMatchObject({
        payment: "success",
        order: "paid",
      });
      expect((await notifications()).at(-1)).toMatchObject({
        result: "ignored",
        needs_review: true,
      });
    });

    it("a renewal is paid without changing the invitation (P3-13 extends it)", async () => {
      const { invitation, order, reference, amount } = await paying("renewal");

      expect(
        await webhook.handle(
          "fake",
          gateway.notify(reference, "success", amount),
        ),
      ).toBe("applied");
      expect(await state(order.id)).toMatchObject({
        order: "paid",
        invitation: "published",
      });
      expect(await history(invitation.id)).toEqual([]);
      expect(paidJobs()).toHaveLength(1);
    });
  });

  // ----------------------------------------------------------------- failed payments

  describe("a verified failure (BR-5.3)", () => {
    it("fails the order and returns the invitation to draft", async () => {
      const { invitation, order, reference, amount } = await paying();

      expect(
        await webhook.handle(
          "fake",
          gateway.notify(reference, "failed", amount),
        ),
      ).toBe("failed");

      expect(await state(order.id)).toMatchObject({
        payment: "failed",
        order: "failed",
        invitation: "draft",
      });
      expect((await history(invitation.id)).at(-1)).toMatchObject({
        from_status: "pending_payment",
        to_status: "draft",
        changed_by: null,
      });
      expect(paidJobs()).toEqual([]);
    });

    it("does not fail the order while another payment attempt for it is still live", async () => {
      const { order, reference, amount } = await paying();
      await harness.pool.query(
        `INSERT INTO payments (order_id, provider, provider_reference_id, amount, status)
         VALUES ($1, 'fake', $2, $3, 'pending')`,
        [order.id, `${order.id}-other000`, String(amount)],
      );

      expect(
        await webhook.handle(
          "fake",
          gateway.notify(reference, "failed", amount),
        ),
      ).toBe("failed_other_payment_live");
      const { rows } = await harness.pool.query<{ status: string }>(
        "SELECT status FROM orders WHERE id = $1",
        [order.id],
      );
      expect(rows[0]!.status).toBe("pending");
    });

    it("a pending notification records the method and changes no status", async () => {
      const { order, reference, amount } = await paying();
      expect(
        await webhook.handle(
          "fake",
          gateway.notify(reference, "pending", amount, "qris"),
        ),
      ).toBe("no_change");
      const { rows } = await harness.pool.query<{
        method: string;
        status: string;
      }>("SELECT method, status FROM payments WHERE order_id = $1", [order.id]);
      expect(rows[0]).toEqual({ method: "qris", status: "pending" });
    });
  });

  // --------------------------------------------------------------------- the clock

  it("answers well under five seconds, with the email queued rather than sent", async () => {
    const { reference, amount } = await paying();
    const started = performance.now();
    await webhook.handle("fake", gateway.notify(reference, "success", amount));
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(paidJobs()).toHaveLength(1);
  });

  // ------------------------------------------------------------- the evidence is kept

  describe("payment_notifications is append-mostly for the application role (ADR-077)", () => {
    let app: Pool;

    beforeAll(() => {
      app = applicationPool();
    });

    afterAll(async () => {
      await app.end();
    });

    it("cannot delete a notification, nor rewrite what arrived; can mark it processed", async () => {
      await rejection(() =>
        webhook.handle("fake", gateway.forge("ref-1", "success", 1n)),
      );
      const { rows } = await harness.pool.query<{ id: string }>(
        "SELECT id FROM payment_notifications LIMIT 1",
      );
      const id = rows[0]!.id;

      await expect(
        app.query("DELETE FROM payment_notifications WHERE id = $1", [id]),
      ).rejects.toMatchObject({
        code: "42501",
      });
      await expect(
        app.query(
          "UPDATE payment_notifications SET signature_valid = true WHERE id = $1",
          [id],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.query(
          "UPDATE payment_notifications SET raw_payload = '{}' WHERE id = $1",
          [id],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.query(
          "UPDATE payment_notifications SET needs_review = true, result = 'x' WHERE id = $1",
          [id],
        ),
      ).resolves.toBeDefined();
    });
  });
});
