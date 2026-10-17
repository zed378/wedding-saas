import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import Redis from "ioredis";

import { JOB_QUEUE, type JobQueue } from "../../src/infra/queue/queue.module";
import {
  createTestInvitation,
  createTestUser,
  type TestInvitation,
  type TestUser,
} from "../support/factories";
import { connect, resetTenantData } from "./helpers.ts";

/**
 * `P4-03` — Public Guestbook Submission and Listing. `docs/API/08`.
 *
 * Verifies:
 * - Happy path: published invitation with moderation=off records entry as 'approved' & queues notification.
 * - Moderation: when moderation=on, initial status is 'pending' and entry is excluded from public list.
 * - Tenancy / Lifecycle isolation: draft, unpublished, expired, deleted or missing return 404.
 * - Business rule: guestbook_enabled = false returns 422 GUESTBOOK_DISABLED and stores nothing.
 * - Stored XSS protection: HTML and script tags stripped from guest_name and message before storage.
 * - Privacy: submitted_ip_hash is SHA-256 hex, never the raw IP.
 * - Duplicate spam guard: identical message from a different IP in 5 min is forced to 'pending'.
 * - Validation: invalid / empty / oversized inputs or extra fields return 400.
 */
describe("public guestbook submission and listing (P4-03)", () => {
  let app: INestApplication;
  let pool: Pool;
  let redis: Redis;
  let user: TestUser;
  let enqueued: {
    poolName: string;
    jobName: string;
    data: unknown;
    key?: string;
  }[];

  const queueMock: JobQueue = {
    enqueue: async (poolName, jobName, data, options) => {
      enqueued.push({
        poolName,
        jobName,
        data,
        ...(options?.idempotencyKey ? { key: options.idempotencyKey } : {}),
      });
    },
    close: async () => {},
  };

  beforeAll(async () => {
    process.env["DATABASE_URL"] = (
      process.env["MIGRATION_DATABASE_URL"] ??
      "postgres://wedding_owner:wedding_owner_dev@localhost:55432/wedding"
    ).replace(/\/\/[^@]+@/, "//wedding_app:wedding_app_dev@");
    process.env["REDIS_URL"] =
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56279";
    process.env["RATE_LIMIT_OVERRIDES"] = JSON.stringify({
      guestbook: { limit: 50_000, windowSeconds: 60 },
      "general-public": { limit: 50_000, windowSeconds: 60 },
    });

    redis = new Redis(
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56279",
      { maxRetriesPerRequest: 2, connectTimeout: 2000 },
    );
    await redis.ping();
    const stale = await redis.keys("rl:*");
    if (stale.length > 0) await redis.del(...stale);

    pool = await connect([
      "invitations",
      "invitation_settings",
      "invitation_guestbook",
    ]);

    const { AppModule } = await import("../../src/app.module.ts");

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(JOB_QUEUE)
      .useValue(queueMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await redis?.quit().catch(() => redis.disconnect());
  });

  beforeEach(async () => {
    await resetTenantData(pool);
    const stale = await redis.keys("rl:*");
    if (stale.length > 0) await redis.del(...stale);
    user = await createTestUser(pool);
    enqueued = [];
  });

  async function createInvitation(
    options: {
      status?: string;
      slug?: string;
      guestbookEnabled?: boolean;
      guestbookModeration?: boolean;
      deleted?: boolean;
    } = {},
  ): Promise<TestInvitation> {
    const inv = await createTestInvitation(pool, {
      owner: user,
      status: options.status ?? "published",
      slug: options.slug ?? "budi-ani",
    });

    await pool.query(
      `INSERT INTO invitation_settings
         (invitation_id, guestbook_enabled, guestbook_moderation)
       VALUES ($1, $2, $3)`,
      [
        inv.id,
        options.guestbookEnabled ?? true,
        options.guestbookModeration ?? false,
      ],
    );

    if (options.deleted) {
      await pool.query(
        "UPDATE invitations SET deleted_at = now() WHERE id = $1",
        [inv.id],
      );
    }

    return inv;
  }

  // ------------------------------------------------------------------ Happy path (moderation off)

  it("submits message with status approved when moderation is off and displays in public list", async () => {
    await createInvitation({
      slug: "budi-ani",
      guestbookEnabled: true,
      guestbookModeration: false,
    });

    const res = await request(app.getHttpServer())
      .post("/public/i/budi-ani/guestbook")
      .send({
        guest_name: "Sarah Wijaya",
        message: "Selamat ya untuk kalian berdua! Semoga bahagia selalu.",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      guest_name: "Sarah Wijaya",
      message: "Selamat ya untuk kalian berdua! Semoga bahagia selalu.",
      status: "approved",
    });
    expect(typeof res.body.data.id).toBe("string");
    expect(typeof res.body.data.created_at).toBe("string");

    // Check DB row
    const { rows } = await pool.query<{
      guest_name: string;
      message: string;
      status: string;
      submitted_ip_hash: string;
    }>("SELECT guest_name, message, status, submitted_ip_hash FROM invitation_guestbook");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      guest_name: "Sarah Wijaya",
      message: "Selamat ya untuk kalian berdua! Semoga bahagia selalu.",
      status: "approved",
    });
    expect(rows[0]!.submitted_ip_hash).toMatch(/^[0-9a-f]{64}$/);

    // Check notification job enqueued
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      poolName: "general",
      jobName: "notification.send",
      data: {
        template: "guestbook_submitted",
        guestName: "Sarah Wijaya",
        status: "approved",
      },
      key: `guestbook.submitted:${res.body.data.id}`,
    });

    // Check public list includes the approved message
    const listRes = await request(app.getHttpServer()).get(
      "/public/i/budi-ani/guestbook",
    );

    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0]).toMatchObject({
      id: res.body.data.id,
      guest_name: "Sarah Wijaya",
      message: "Selamat ya untuk kalian berdua! Semoga bahagia selalu.",
    });
    expect(listRes.body.meta).toMatchObject({
      page: 1,
      per_page: 20,
      total: 1,
    });
  });

  // ------------------------------------------------------------------ Moderation on

  it("submits message with status pending when moderation is on and hides from public list until approved", async () => {
    await createInvitation({
      slug: "moderated-wedding",
      guestbookEnabled: true,
      guestbookModeration: true,
    });

    const res = await request(app.getHttpServer())
      .post("/public/i/moderated-wedding/guestbook")
      .send({
        guest_name: "Guest",
        message: "Menunggu persetujuan pemilik...",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending");

    // Must be hidden from public listing
    const listBefore = await request(app.getHttpServer()).get(
      "/public/i/moderated-wedding/guestbook",
    );
    expect(listBefore.status).toBe(200);
    expect(listBefore.body.data).toHaveLength(0);
    expect(listBefore.body.meta.total).toBe(0);

    // Simulate owner approving the message
    await pool.query(
      "UPDATE invitation_guestbook SET status = 'approved' WHERE id = $1",
      [res.body.data.id],
    );

    // Must now appear in public listing
    const listAfter = await request(app.getHttpServer()).get(
      "/public/i/moderated-wedding/guestbook",
    );
    expect(listAfter.status).toBe(200);
    expect(listAfter.body.data).toHaveLength(1);
    expect(listAfter.body.data[0].id).toBe(res.body.data.id);
  });

  // ------------------------------------------------------------------ Duplicate message spam guard

  it("flags identical message from a different IP in 5 min as pending for moderation", async () => {
    await createInvitation({
      slug: "anti-spam",
      guestbookEnabled: true,
      guestbookModeration: false, // moderation is normally off!
    });

    // First post from IP 1.1.1.1
    const res1 = await request(app.getHttpServer())
      .post("/public/i/anti-spam/guestbook")
      .set("X-Forwarded-For", "1.1.1.1")
      .send({
        guest_name: "Original Poster",
        message: "Spam message broadcast",
      });

    expect(res1.status).toBe(201);
    expect(res1.body.data.status).toBe("approved");

    // Second post with identical text from IP 2.2.2.2 within 5 minutes
    const res2 = await request(app.getHttpServer())
      .post("/public/i/anti-spam/guestbook")
      .set("X-Forwarded-For", "2.2.2.2")
      .send({
        guest_name: "Bot Copycat",
        message: "Spam message broadcast",
      });

    expect(res2.status).toBe(201);
    // Forced to pending by duplicate spam guard
    expect(res2.body.data.status).toBe("pending");
  });

  // ------------------------------------------------------------------ Disabled guestbook (422)

  it("rejects writes with 422 GUESTBOOK_DISABLED when guestbook_enabled is false", async () => {
    await createInvitation({
      slug: "guestbook-off",
      guestbookEnabled: false,
    });

    const res = await request(app.getHttpServer())
      .post("/public/i/guestbook-off/guestbook")
      .send({
        guest_name: "Guest",
        message: "Harusnya ditolak",
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("GUESTBOOK_DISABLED");

    const { rows } = await pool.query("SELECT id FROM invitation_guestbook");
    expect(rows).toHaveLength(0);
  });

  // ------------------------------------------------------------------ Lifecycle & status isolation (404)

  it("returns 404 for draft, unpublished, expired, or deleted invitations on submit and list", async () => {
    await createInvitation({ status: "draft", slug: "draft-gb" });
    await createInvitation({ status: "paid", slug: "unpublished-gb" });
    await createInvitation({ status: "expired", slug: "expired-gb" });
    await createInvitation({
      status: "published",
      slug: "deleted-gb",
      deleted: true,
    });

    for (const slug of [
      "draft-gb",
      "unpublished-gb",
      "expired-gb",
      "deleted-gb",
      "non-existent-gb",
    ]) {
      // POST returns 404
      const postRes = await request(app.getHttpServer())
        .post(`/public/i/${slug}/guestbook`)
        .send({
          guest_name: "Guest",
          message: "Halo",
        });
      expect(postRes.status).toBe(404);

      // GET returns 404
      const getRes = await request(app.getHttpServer()).get(
        `/public/i/${slug}/guestbook`,
      );
      expect(getRes.status).toBe(404);
    }
  });

  // ------------------------------------------------------------------ Stored XSS sanitization

  it("sanitizes script tags and HTML markup from guest_name and message before storage", async () => {
    await createInvitation({ slug: "clean-gb", guestbookEnabled: true });

    const res = await request(app.getHttpServer())
      .post("/public/i/clean-gb/guestbook")
      .send({
        guest_name: "<script>alert('xss')</script>Budi Santoso",
        message:
          "<img src=x onerror=alert(1)>Semoga langgeng <a href='javascript:void(0)'>selamanya</a>",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.guest_name).toBe("Budi Santoso");
    expect(res.body.data.message).toBe("Semoga langgeng selamanya");

    const { rows } = await pool.query<{ guest_name: string; message: string }>(
      "SELECT guest_name, message FROM invitation_guestbook",
    );
    expect(rows[0]!.guest_name).toBe("Budi Santoso");
    expect(rows[0]!.message).toBe("Semoga langgeng selamanya");
  });

  // ------------------------------------------------------------------ Privacy: IP hashing

  it("stores a SHA-256 hash in submitted_ip_hash and never the raw IP", async () => {
    await createInvitation({ slug: "privacy-gb", guestbookEnabled: true });

    await request(app.getHttpServer())
      .post("/public/i/privacy-gb/guestbook")
      .set("X-Forwarded-For", "198.51.100.42")
      .send({
        guest_name: "Privacy Guest",
        message: "Salam bahagia",
      });

    const { rows } = await pool.query<{ submitted_ip_hash: string }>(
      "SELECT submitted_ip_hash FROM invitation_guestbook",
    );
    expect(rows[0]!.submitted_ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.submitted_ip_hash).not.toContain("198.51.100.42");
  });

  // ------------------------------------------------------------------ Validation errors

  it("validates required fields, maximum length, and rejects unexpected properties", async () => {
    await createInvitation({ slug: "validation-gb", guestbookEnabled: true });

    // Missing guest_name
    const res1 = await request(app.getHttpServer())
      .post("/public/i/validation-gb/guestbook")
      .send({ message: "Pesan saja" });
    expect(res1.status).toBe(400);

    // Empty message
    const res2 = await request(app.getHttpServer())
      .post("/public/i/validation-gb/guestbook")
      .send({ guest_name: "Nama", message: "   " });
    expect(res2.status).toBe(400);

    // Message > 1000 characters
    const res3 = await request(app.getHttpServer())
      .post("/public/i/validation-gb/guestbook")
      .send({ guest_name: "Nama", message: "a".repeat(1001) });
    expect(res3.status).toBe(400);

    // Strict schema rejects extra fields
    const res4 = await request(app.getHttpServer())
      .post("/public/i/validation-gb/guestbook")
      .send({
        guest_name: "Nama",
        message: "Pesan",
        status: "approved",
      });
    expect(res4.status).toBe(400);
  });
});
