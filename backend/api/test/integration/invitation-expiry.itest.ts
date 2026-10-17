import { Redis as IORedis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InMemoryStorage, mediaKey } from "@wi/storage";

import { RedisCache } from "../../src/infra/cache/redis-cache";
import type { JobQueue } from "../../src/infra/queue/queue.module";
import { CatalogRepository } from "../../src/modules/order/catalog.repository";
import { OrderService } from "../../src/modules/order/order.service";
import { PricingService } from "../../src/modules/order/pricing.service";
import { FakePaymentGateway } from "../../src/modules/payment/fake-payment-gateway";
import { PaymentWebhookService } from "../../src/modules/payment/payment-webhook.service";
import { PaymentRepository } from "../../src/modules/payment/payment.repository";
import { PaymentService } from "../../src/modules/payment/payment.service";
import { InvitationExpiryService } from "../../src/modules/publishing/invitation-expiry.service";
import { InvitationRetentionService } from "../../src/modules/invitation/invitation-retention.service";
import { PublicInvitationCache } from "../../src/modules/publishing/public-invitation-cache";
import { PublicInvitationRepository } from "../../src/shared/tenancy/public-invitation-repository";
import { InvitationStatusService } from "../../src/shared/invitation-status/invitation-status.service";
import { metrics } from "../../src/shared/metrics/metrics";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import { OrderRepository } from "../../src/shared/tenancy/order-repository";
import { createTestInvitation, createTestUser } from "../support/factories";
import { startHarness, type Harness } from "../support/harness";
import { resetTenantData } from "./helpers.ts";

const REDIS_URL =
  process.env["TEST_REDIS_URL"] ??
  process.env["REDIS_URL"] ??
  "redis://localhost:56379";

describe("invitation expiry, renewal and retention (P3-13)", () => {
  let harness: Harness;
  let redis: IORedis;
  let storage: InMemoryStorage;
  let invitationRepo: InvitationRepository;
  let publicRepo: PublicInvitationRepository;
  let orderRepo: OrderRepository;
  let statusService: InvitationStatusService;
  let expiryService: InvitationExpiryService;
  let retentionService: InvitationRetentionService;
  let publicCache: PublicInvitationCache;
  let orderService: OrderService;
  let paymentService: PaymentService;
  let webhookService: PaymentWebhookService;
  let gateway: FakePaymentGateway;

  const enqueuedJobs: Array<{ pool: string; jobName: string; data: unknown }> =
    [];
  const queue: JobQueue = {
    enqueue: async (pool, jobName, data) => {
      enqueuedJobs.push({ pool, jobName, data });
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
    enqueuedJobs.length = 0;

    storage = new InMemoryStorage();
    invitationRepo = new InvitationRepository(harness.db);
    publicRepo = new PublicInvitationRepository(harness.db);
    orderRepo = new OrderRepository(harness.db);
    statusService = new InvitationStatusService(harness.db);

    const redisCache = new RedisCache(redis);
    publicCache = new PublicInvitationCache(redisCache);

    expiryService = new InvitationExpiryService(
      invitationRepo,
      statusService,
      queue,
      publicCache,
    );

    retentionService = new InvitationRetentionService(
      invitationRepo,
      statusService,
      storage,
    );

    const pricing = new PricingService(new CatalogRepository(harness.db));
    orderService = new OrderService(
      orderRepo,
      pricing,
      statusService,
      redisCache,
    );

    gateway = new FakePaymentGateway("p3-13-test-key");
    const paymentRepo = new PaymentRepository(harness.db);
    paymentService = new PaymentService(orderService, paymentRepo, gateway);
    webhookService = new PaymentWebhookService(
      gateway,
      paymentRepo,
      orderService,
      queue,
    );
  });

  describe("DoD 1: Expiry happens only in scheduled job; requests never mutate status", () => {
    it("an overdue invitation stays published upon reading, and expires only when sweep runs", async () => {
      const user = await createTestUser(harness.pool);
      const inv = await createTestInvitation(harness.pool, {
        owner: user,
        status: "published",
        slug: "overdue-wedding",
      });

      // Set expiry_date in the past (yesterday in Jakarta time)
      await harness.pool.query(
        `UPDATE invitations 
         SET expiry_date = ((now() AT TIME ZONE 'Asia/Jakarta')::date - interval '1 day')::date
         WHERE id = $1`,
        [inv.id],
      );

      // Verify that public read finds the invitation (requests never mutate status)
      const readBefore = await publicRepo.findPublishedBySlug("overdue-wedding");
      expect(readBefore).not.toBeNull();

      // Verify status is STILL 'published' in database after public read
      const { rows: readRows } = await harness.pool.query<{ status: string }>(
        "SELECT status FROM invitations WHERE id = $1",
        [inv.id],
      );
      expect(readRows[0]!.status).toBe("published");

      const expiredMetricBefore = metrics.invitationsExpired.get();

      // Run scheduled expiry sweep
      const { expiredCount } = await expiryService.expireOverdueInvitations();
      expect(expiredCount).toBe(1);
      expect(metrics.invitationsExpired.get()).toBe(expiredMetricBefore + 1);

      // Verify database status is now 'expired'
      const { rows: afterRows } = await harness.pool.query<{ status: string }>(
        "SELECT status FROM invitations WHERE id = $1",
        [inv.id],
      );
      expect(afterRows[0]!.status).toBe("expired");

      // Verify status history audit trail
      const { rows: history } = await harness.pool.query<{
        from_status: string;
        to_status: string;
        changed_by: string | null;
        reason: string;
      }>(
        "SELECT from_status, to_status, changed_by, reason FROM invitation_status_history WHERE invitation_id = $1 ORDER BY created_at DESC LIMIT 1",
        [inv.id],
      );
      expect(history[0]).toMatchObject({
        from_status: "published",
        to_status: "expired",
        changed_by: null, // SYSTEM
        reason: "expiry_date passed, daily job",
      });

      // Verify public read now returns null
      const readAfter = await publicRepo.findPublishedBySlug("overdue-wedding");
      expect(readAfter).toBeNull();

      // Verify notification event was queued
      const notification = enqueuedJobs.find(
        (j) => j.jobName === "notification.send",
      );
      expect(notification).toBeDefined();
      expect(notification?.data).toMatchObject({
        template: "invitation_expired",
        invitationId: inv.id,
      });
    });

    it("does not expire published invitations whose expiry_date is in the future", async () => {
      const user = await createTestUser(harness.pool);
      const inv = await createTestInvitation(harness.pool, {
        owner: user,
        status: "published",
        slug: "future-wedding",
      });

      // Set expiry_date in future
      await harness.pool.query(
        `UPDATE invitations 
         SET expiry_date = ((now() AT TIME ZONE 'Asia/Jakarta')::date + interval '30 days')::date
         WHERE id = $1`,
        [inv.id],
      );

      const { expiredCount } = await expiryService.expireOverdueInvitations();
      expect(expiredCount).toBe(0);

      const { rows } = await harness.pool.query<{ status: string }>(
        "SELECT status FROM invitations WHERE id = $1",
        [inv.id],
      );
      expect(rows[0]!.status).toBe("published");
    });
  });

  describe("DoD 2: Renewal extends from whichever of expiry or now is later, and restores published", () => {
    it("renews an expired invitation, extending from today and restoring published status", async () => {
      const user = await createTestUser(harness.pool);
      const inv = await createTestInvitation(harness.pool, {
        owner: user,
        status: "expired",
        slug: "expired-then-renewed",
      });

      // Expired 10 days ago
      await harness.pool.query(
        `UPDATE invitations 
         SET expiry_date = ((now() AT TIME ZONE 'Asia/Jakarta')::date - interval '10 days')::date
         WHERE id = $1`,
        [inv.id],
      );

      // Create renewal order
      const order = await orderService.create(
        { scope: user.scope, emailVerified: true },
        inv.id,
        { packageId: "standard", addonIds: [] },
      );
      expect(order.order_type).toBe("renewal");

      // Initiate payment
      await paymentService.initiate(
        { scope: user.scope, fullName: "Test User", email: user.email },
        order.id,
      );
      const { rows: payRows } = await harness.pool.query<{
        provider_reference_id: string;
      }>("SELECT provider_reference_id FROM payments WHERE order_id = $1", [
        order.id,
      ]);
      const reference = payRows[0]!.provider_reference_id;
      const amount = BigInt(order.amount_total);

      const renewedMetricBefore = metrics.invitationsRenewed.get();

      // Simulate webhook payment callback
      const outcome = await webhookService.handle(
        "fake",
        gateway.notify(reference, "success", amount),
      );
      expect(outcome).toBe("applied");
      expect(metrics.invitationsRenewed.get()).toBe(renewedMetricBefore + 1);

      // Verify invitation is restored to 'published'
      const { rows: invRows } = await harness.pool.query<{
        status: string;
        expiry_date: string;
      }>("SELECT status, expiry_date::text FROM invitations WHERE id = $1", [
        inv.id,
      ]);
      expect(invRows[0]!.status).toBe("published");

      // Verify expiry_date extended from now (today + 12 months in Jakarta time)
      const { rows: expectedDateRows } = await harness.pool.query<{
        expected_date: string;
      }>(
        "SELECT ((now() AT TIME ZONE 'Asia/Jakarta')::date + interval '12 months')::date::text as expected_date",
      );
      expect(invRows[0]!.expiry_date).toBe(
        expectedDateRows[0]!.expected_date,
      );

      // Verify status history shows SYSTEM renewal
      const { rows: history } = await harness.pool.query<{
        from_status: string;
        to_status: string;
        reason: string;
      }>(
        "SELECT from_status, to_status, reason FROM invitation_status_history WHERE invitation_id = $1 ORDER BY created_at DESC LIMIT 1",
        [inv.id],
      );
      expect(history[0]).toMatchObject({
        from_status: "expired",
        to_status: "published",
        reason: "renewal payment confirmed",
      });

      // Verify order_paid notification was enqueued
      const paidJob = enqueuedJobs.find(
        (j) =>
          j.jobName === "notification.send" &&
          (j.data as { template: string; orderId: string })?.template ===
            "order_paid" &&
          (j.data as { template: string; orderId: string })?.orderId ===
            order.id,
      );
      expect(paidJob).toBeDefined();
    });

    it("renews a still-published invitation, extending from its existing future expiry_date", async () => {
      const user = await createTestUser(harness.pool);
      const inv = await createTestInvitation(harness.pool, {
        owner: user,
        status: "published",
        slug: "published-renewal",
      });

      // Existing expiry date 60 days in future
      await harness.pool.query(
        `UPDATE invitations 
         SET expiry_date = ((now() AT TIME ZONE 'Asia/Jakarta')::date + interval '60 days')::date
         WHERE id = $1`,
        [inv.id],
      );

      const order = await orderService.create(
        { scope: user.scope, emailVerified: true },
        inv.id,
        { packageId: "standard", addonIds: [] },
      );
      expect(order.order_type).toBe("renewal");

      await paymentService.initiate(
        { scope: user.scope, fullName: "Test User", email: user.email },
        order.id,
      );
      const { rows: payRows } = await harness.pool.query<{
        provider_reference_id: string;
      }>("SELECT provider_reference_id FROM payments WHERE order_id = $1", [
        order.id,
      ]);
      const reference = payRows[0]!.provider_reference_id;
      const amount = BigInt(order.amount_total);

      const outcome = await webhookService.handle(
        "fake",
        gateway.notify(reference, "success", amount),
      );
      expect(outcome).toBe("applied");

      // Verify status stays published
      const { rows: invRows } = await harness.pool.query<{
        status: string;
        expiry_date: string;
      }>("SELECT status, expiry_date::text FROM invitations WHERE id = $1", [
        inv.id,
      ]);
      expect(invRows[0]!.status).toBe("published");

      // Verify expiry_date extended from existing 60-day date + 12 months
      const { rows: expectedDateRows } = await harness.pool.query<{
        expected_date: string;
      }>(
        "SELECT (((now() AT TIME ZONE 'Asia/Jakarta')::date + interval '60 days')::date + interval '12 months')::date::text as expected_date",
      );
      expect(invRows[0]!.expiry_date).toBe(
        expectedDateRows[0]!.expected_date,
      );
    });
  });

  describe("DoD 3: Expired invitations show the friendly page while API stays undifferentiated", () => {
    it("returns null from public repository for an expired invitation, indistinguishable from unpublished", async () => {
      const user = await createTestUser(harness.pool);
      await createTestInvitation(harness.pool, {
        owner: user,
        status: "expired",
        slug: "expired-public-link",
      });

      const expiredResult = await publicRepo.findPublishedBySlug("expired-public-link");
      expect(expiredResult).toBeNull();

      // Compare with non-existent or unpublished slug - both return null identically
      const nonExistentResult = await publicRepo.findPublishedBySlug("never-existed-slug");
      expect(nonExistentResult).toBeNull();
    });
  });

  describe("DoD 4: Retention chain is implemented and hard deletion removes storage objects", () => {
    it("soft-deletes an invitation expired for 90 days without renewal", async () => {
      const user = await createTestUser(harness.pool);
      const inv = await createTestInvitation(harness.pool, {
        owner: user,
        status: "expired",
      });

      // Expired 91 days ago in WIB
      await harness.pool.query(
        "UPDATE invitations SET expiry_date = ((now() AT TIME ZONE 'Asia/Jakarta')::date - interval '91 days')::date WHERE id = $1",
        [inv.id],
      );

      const softDeleteMetricBefore = metrics.invitationsSoftDeleted.get();

      const softDeletedCount = await retentionService.sweepSoftDelete(90);
      expect(softDeletedCount).toBe(1);
      expect(metrics.invitationsSoftDeleted.get()).toBe(
        softDeleteMetricBefore + 1,
      );

      const { rows } = await harness.pool.query<{
        status: string;
        deleted_at: Date | null;
      }>("SELECT status, deleted_at FROM invitations WHERE id = $1", [inv.id]);
      expect(rows[0]!.status).toBe("soft_deleted");
      expect(rows[0]!.deleted_at).not.toBeNull();
    });

    it("hard-deletes an invitation soft-deleted for 30 days and removes all storage objects", async () => {
      const user = await createTestUser(harness.pool);
      const inv = await createTestInvitation(harness.pool, {
        owner: user,
        status: "soft_deleted",
      });

      await harness.pool.query(
        "UPDATE invitations SET deleted_at = now() - interval '31 days' WHERE id = $1",
        [inv.id],
      );

      // Create a media row and place media objects in storage (using RFC4122 v4 UUID)
      const mediaId = "11111111-2222-4333-8444-555555555555";
      await harness.pool.query(
        `INSERT INTO media (id, invitation_id, uploaded_by, purpose, status, storage_path)
         VALUES ($1, $2, $3, 'gallery', 'ready', 'user-media/test')`,
        [mediaId, inv.id, user.id],
      );

      const thumbKey = mediaKey(inv.id, mediaId, "thumbnail");
      const medKey = mediaKey(inv.id, mediaId, "medium");
      const largeKey = mediaKey(inv.id, mediaId, "large");

      await storage.put("user-media", thumbKey, Buffer.from("thumb"), {
        contentType: "image/webp",
      });
      await storage.put("user-media", medKey, Buffer.from("med"), {
        contentType: "image/webp",
      });
      await storage.put("user-media", largeKey, Buffer.from("large"), {
        contentType: "image/webp",
      });

      expect(await storage.exists("user-media", thumbKey)).toBe(true);

      const hardDeleteMetricBefore = metrics.invitationsHardDeleted.get();

      const hardDeletedCount = await retentionService.sweepHardDelete(30);
      expect(hardDeletedCount).toBe(1);
      expect(metrics.invitationsHardDeleted.get()).toBe(
        hardDeleteMetricBefore + 1,
      );

      // Verify files purged from storage
      expect(await storage.exists("user-media", thumbKey)).toBe(false);
      expect(await storage.exists("user-media", medKey)).toBe(false);
      expect(await storage.exists("user-media", largeKey)).toBe(false);

      // Verify database record deleted (no orders existed, so completely deleted)
      const { rows } = await harness.pool.query(
        "SELECT id FROM invitations WHERE id = $1",
        [inv.id],
      );
      expect(rows.length).toBe(0);
    });

    it("purges individually soft-deleted gallery photos older than 7 days from storage and DB", async () => {
      const user = await createTestUser(harness.pool);
      const inv = await createTestInvitation(harness.pool, {
        owner: user,
        status: "published",
      });

      const mediaId = "99999999-8888-4777-8666-555555555555";
      await harness.pool.query(
        `INSERT INTO media (id, invitation_id, uploaded_by, purpose, status, storage_path, deleted_at)
         VALUES ($1, $2, $3, 'gallery', 'ready', 'user-media/test', now() - interval '8 days')`,
        [mediaId, inv.id, user.id],
      );

      const thumbKey = mediaKey(inv.id, mediaId, "thumbnail");
      const largeKey = mediaKey(inv.id, mediaId, "large");

      await storage.put("user-media", thumbKey, Buffer.from("thumb"), {
        contentType: "image/webp",
      });
      await storage.put("user-media", largeKey, Buffer.from("large"), {
        contentType: "image/webp",
      });

      expect(await storage.exists("user-media", thumbKey)).toBe(true);

      const orphanMetricBefore = metrics.mediaOrphansCleaned.get();

      const cleanedCount = await retentionService.cleanupOrphanedMedia(7);
      expect(cleanedCount).toBe(1);
      expect(metrics.mediaOrphansCleaned.get()).toBe(orphanMetricBefore + 1);

      // Verify files purged from storage
      expect(await storage.exists("user-media", thumbKey)).toBe(false);
      expect(await storage.exists("user-media", largeKey)).toBe(false);

      // Verify media row removed from DB
      const { rows } = await harness.pool.query(
        "SELECT id FROM media WHERE id = $1",
        [mediaId],
      );
      expect(rows.length).toBe(0);
    });
  });
});
