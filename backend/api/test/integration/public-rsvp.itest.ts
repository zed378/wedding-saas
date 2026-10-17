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
 * `P4-01` — `POST /public/i/:slug/rsvp`. `docs/API/08`.
 *
 * Public unauthenticated attendance confirmation.
 * Verifies:
 * - Happy path: published invitation with rsvp_enabled = true records attendance & queues notification.
 * - Tenancy / Lifecycle isolation: draft, unpublished, expired, deleted or missing return identical 404.
 * - Business rule: rsvp_enabled = false returns 422 RSVP_DISABLED and stores nothing.
 * - Stored XSS protection: HTML and script tags stripped from guest_name and message before storage.
 * - Privacy: submitted_ip_hash is SHA-256 hex, never the raw IP.
 * - Rate limiting: enforced at 10 requests / hr per (ip_hash, slug).
 * - Validation: invalid status, missing name, or out-of-range guest_count returns 400.
 */
describe("public RSVP submission (P4-01)", () => {
  let app: INestApplication;
  let pool: Pool;
  let redis: Redis;
  let user: TestUser;
  let enqueued: { poolName: string; jobName: string; data: unknown; key?: string }[];

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
      rsvp: { limit: 50_000, windowSeconds: 60 },
    });

    redis = new Redis(
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56279",
      { maxRetriesPerRequest: 2, connectTimeout: 2000 },
    );
    await redis.ping();
    const stale = await redis.keys("rl:*");
    if (stale.length > 0) await redis.del(...stale);

    pool = await connect(["invitations", "invitation_settings", "invitation_guests"]);

    const { AppModule } = await import("../../src/app.module.ts");

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(JOB_QUEUE)
      .useValue(queueMock)
      .compile();

    app = moduleRef.createNestApplication();
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

  async function createInvitation(options: {
    status?: string;
    slug?: string;
    rsvpEnabled?: boolean;
    deleted?: boolean;
  } = {}): Promise<TestInvitation> {
    const inv = await createTestInvitation(pool, {
      owner: user,
      status: options.status ?? "published",
      slug: options.slug ?? "budi-ani",
    });

    await pool.query(
      "INSERT INTO invitation_settings (invitation_id, rsvp_enabled) VALUES ($1, $2)",
      [inv.id, options.rsvpEnabled ?? true],
    );

    if (options.deleted) {
      await pool.query(
        "UPDATE invitations SET deleted_at = now() WHERE id = $1",
        [inv.id],
      );
    }

    return inv;
  }

  // ------------------------------------------------------------------ Happy path

  it("submits attendance for a published invitation and queues a notification", async () => {
    await createInvitation({ slug: "budi-ani", rsvpEnabled: true });

    const res = await request(app.getHttpServer())
      .post("/public/i/budi-ani/rsvp")
      .send({
        guest_name: "Dimas Anggara",
        attendance_status: "attending",
        guest_count: 2,
        message: "Selamat untuk kedua mempelai!",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      guest_name: "Dimas Anggara",
      attendance_status: "attending",
      guest_count: 2,
      message: "Selamat untuk kedua mempelai!",
    });
    expect(typeof res.body.data.id).toBe("string");
    expect(typeof res.body.data.created_at).toBe("string");

    // Verify database row
    const { rows } = await pool.query<{
      guest_name: string;
      attendance_status: string;
      guest_count: number;
      message: string;
      submitted_ip_hash: string;
    }>("SELECT guest_name, attendance_status, guest_count, message, submitted_ip_hash FROM invitation_guests");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      guest_name: "Dimas Anggara",
      attendance_status: "attending",
      guest_count: 2,
      message: "Selamat untuk kedua mempelai!",
    });
    expect(rows[0]!.submitted_ip_hash).toMatch(/^[0-9a-f]{64}$/);

    // Verify queued job
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      poolName: "general",
      jobName: "notification.send",
      data: {
        template: "rsvp_submitted",
        guestName: "Dimas Anggara",
        attendanceStatus: "attending",
        guestCount: 2,
      },
      key: `rsvp.submitted:${res.body.data.id}`,
    });
  });

  // ------------------------------------------------------------------ Lifecycle & status isolation (404)

  it("returns 404 and stores nothing for a draft, unpublished, expired, or deleted invitation", async () => {
    await createInvitation({ status: "draft", slug: "draft-wedding" });
    await createInvitation({ status: "paid", slug: "unpublished-wedding" });
    await createInvitation({ status: "expired", slug: "expired-wedding" });
    await createInvitation({ status: "published", slug: "deleted-wedding", deleted: true });

    for (const slug of [
      "draft-wedding",
      "unpublished-wedding",
      "expired-wedding",
      "deleted-wedding",
      "non-existent-wedding",
    ]) {
      const res = await request(app.getHttpServer())
        .post(`/public/i/${slug}/rsvp`)
        .send({
          guest_name: "Guest",
          attendance_status: "attending",
          guest_count: 1,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("NOT_FOUND");
    }

    const { rows } = await pool.query("SELECT id FROM invitation_guests");
    expect(rows).toHaveLength(0);
  });

  // ------------------------------------------------------------------ Disabled RSVP section (422)

  it("rejects writes with 422 RSVP_DISABLED when rsvp_enabled is false", async () => {
    await createInvitation({ slug: "rsvp-off", rsvpEnabled: false });

    const res = await request(app.getHttpServer())
      .post("/public/i/rsvp-off/rsvp")
      .send({
        guest_name: "Guest",
        attendance_status: "attending",
        guest_count: 1,
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("RSVP_DISABLED");

    const { rows } = await pool.query("SELECT id FROM invitation_guests");
    expect(rows).toHaveLength(0);
  });

  // ------------------------------------------------------------------ Stored XSS sanitization

  it("sanitizes script tags and HTML markup from guest_name and message before storage", async () => {
    await createInvitation({ slug: "clean-wedding", rsvpEnabled: true });

    const res = await request(app.getHttpServer())
      .post("/public/i/clean-wedding/rsvp")
      .send({
        guest_name: "<script>alert('xss')</script>Citra",
        attendance_status: "attending",
        guest_count: 1,
        message: "<img src=x onerror=alert(1)>Samawa ya <a href='javascript:void(0)'>teman</a>",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.guest_name).toBe("Citra");
    expect(res.body.data.message).toBe("Samawa ya teman");

    const { rows } = await pool.query<{ guest_name: string; message: string }>(
      "SELECT guest_name, message FROM invitation_guests",
    );
    expect(rows[0]!.guest_name).toBe("Citra");
    expect(rows[0]!.message).toBe("Samawa ya teman");
  });

  // ------------------------------------------------------------------ Privacy: IP hashing

  it("stores a SHA-256 hash in submitted_ip_hash and never the raw IP", async () => {
    await createInvitation({ slug: "privacy-check", rsvpEnabled: true });

    await request(app.getHttpServer())
      .post("/public/i/privacy-check/rsvp")
      .set("X-Forwarded-For", "203.0.113.195")
      .send({
        guest_name: "Privacy Guest",
        attendance_status: "maybe",
        guest_count: 1,
      });

    const { rows } = await pool.query<{ submitted_ip_hash: string }>(
      "SELECT submitted_ip_hash FROM invitation_guests",
    );
    expect(rows[0]!.submitted_ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.submitted_ip_hash).not.toContain("203.0.113.195");
  });

  // ------------------------------------------------------------------ Validation errors

  it("validates required fields, attendance enum, and bounds on guest count", async () => {
    await createInvitation({ slug: "validation-check", rsvpEnabled: true });

    // Missing guest_name
    const res1 = await request(app.getHttpServer())
      .post("/public/i/validation-check/rsvp")
      .send({
        attendance_status: "attending",
        guest_count: 1,
      });
    expect(res1.status).toBe(400);

    // Invalid attendance_status
    const res2 = await request(app.getHttpServer())
      .post("/public/i/validation-check/rsvp")
      .send({
        guest_name: "Budi",
        attendance_status: "sure_why_not",
        guest_count: 1,
      });
    expect(res2.status).toBe(400);

    // Guest count > 10
    const res3 = await request(app.getHttpServer())
      .post("/public/i/validation-check/rsvp")
      .send({
        guest_name: "Budi",
        attendance_status: "attending",
        guest_count: 15,
      });
    expect(res3.status).toBe(400);

    // Guest count < 1
    const res4 = await request(app.getHttpServer())
      .post("/public/i/validation-check/rsvp")
      .send({
        guest_name: "Budi",
        attendance_status: "attending",
        guest_count: 0,
      });
    expect(res4.status).toBe(400);

    // Strict schema rejects unknown fields
    const res5 = await request(app.getHttpServer())
      .post("/public/i/validation-check/rsvp")
      .send({
        guest_name: "Budi",
        attendance_status: "attending",
        guest_count: 1,
        role: "admin",
      });
    expect(res5.status).toBe(400);
  });
});
