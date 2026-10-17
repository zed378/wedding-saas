import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import Redis from "ioredis";

import { JOB_QUEUE, type JobQueue } from "../../src/infra/queue/queue.module";
import { RateLimiter, RATE_LIMIT_REDIS } from "../../src/shared/rate-limit/rate-limiter";
import { RATE_LIMITER } from "../../src/shared/rate-limit/rate-limit.guard";
import { DEFAULT_POLICIES } from "../../src/shared/rate-limit/policies";
import { ProfanityService } from "../../src/shared/abuse/profanity.service";
import {
  createTestInvitation,
  createTestUser,
  type TestInvitation,
  type TestUser,
} from "../support/factories";
import { connect, resetTenantData } from "./helpers.ts";

/**
 * `P4-05` — Public Abuse Controls and Adaptive CAPTCHA Integration Test.
 *
 * Verifies:
 * - Public endpoint returns captcha_required flag for a given slug.
 * - Under normal volume, submissions succeed with no CAPTCHA required.
 * - Under simulated flood (20 requests within 10 minutes), CAPTCHA mode activates automatically.
 * - Under CAPTCHA mode, requests without token are rejected with 422 CAPTCHA_REQUIRED.
 * - Under CAPTCHA mode, requests with invalid token are rejected with 422 CAPTCHA_INVALID.
 * - Under CAPTCHA mode, Cloudflare Turnstile test token (1x00000000000000000000AA) succeeds.
 * - Profanity filter: when profanity_filter_enabled=true, messages containing profanity terms
 *   (including leetspeak folded variations) are routed to status 'pending'.
 * - Profanity filter: when profanity_filter_enabled=false, approved status is preserved.
 * - Rate-limit escalation: repeat rate limit violators receive escalating block durations,
 *   and admin unblock clears the block immediately.
 */
describe("public abuse controls and adaptive CAPTCHA (P4-05)", () => {
  let app: INestApplication;
  let pool: Pool;
  let redis: Redis;
  let user: TestUser;
  let rateLimiter: RateLimiter;
  let profanityService: ProfanityService;

  const queueMock: JobQueue = {
    enqueue: async () => {},
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
      rsvp: { limit: 50_000, windowSeconds: 60 },
      "general-public": { limit: 50_000, windowSeconds: 60 },
    });

    redis = new Redis(
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56279",
      { maxRetriesPerRequest: 2, connectTimeout: 2000 },
    );
    await redis.ping();

    pool = await connect([
      "invitations",
      "invitation_settings",
      "invitation_guestbook",
      "invitation_guests",
      "slug_blocklist",
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

    rateLimiter = app.get(RATE_LIMITER);
    profanityService = app.get(ProfanityService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await redis?.quit().catch(() => redis.disconnect());
  });

  beforeEach(async () => {
    await resetTenantData(pool);
    const abuseKeys = await redis.keys("abuse:*");
    const rlKeys = await redis.keys("rl:*");
    const stale = [...abuseKeys, ...rlKeys];
    if (stale.length > 0) await redis.del(...stale);
    user = await createTestUser(pool);
    profanityService.clearCache();
  });

  async function createInvitation(
    options: {
      slug?: string;
      guestbookEnabled?: boolean;
      guestbookModeration?: boolean;
      rsvpEnabled?: boolean;
      profanityFilterEnabled?: boolean;
    } = {},
  ): Promise<TestInvitation & { slug: string }> {
    const slug = options.slug ?? "budi-ani";
    const inv = await createTestInvitation(pool, {
      owner: user,
      status: "published",
      slug,
    });

    await pool.query(
      `INSERT INTO invitation_settings
         (invitation_id, guestbook_enabled, guestbook_moderation, rsvp_enabled, profanity_filter_enabled)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        inv.id,
        options.guestbookEnabled ?? true,
        options.guestbookModeration ?? false,
        options.rsvpEnabled ?? true,
        options.profanityFilterEnabled ?? false,
      ],
    );

    return { ...inv, slug };
  }

  it("returns captcha_required flag for a given slug", async () => {
    const inv = await createInvitation({ slug: "captcha-status-test" });

    // Initially false
    const res1 = await request(app.getHttpServer())
      .get(`/public/i/${inv.slug}/captcha-status`)
      .expect(200);

    expect(res1.body.data).toEqual({ captcha_required: false });

    // When CAPTCHA mode is active in Redis
    await redis.set(`abuse:captcha:${inv.slug}`, "1", "EX", 1800);

    const res2 = await request(app.getHttpServer())
      .get(`/public/i/${inv.slug}/captcha-status`)
      .expect(200);

    expect(res2.body.data).toEqual({ captcha_required: true });
  });

  it("activates CAPTCHA automatically under a simulated flood and rejects requests without token", async () => {
    const inv = await createInvitation({ slug: "flood-test" });

    // 19 submissions succeed without CAPTCHA challenge
    for (let i = 1; i <= 19; i++) {
      const res = await request(app.getHttpServer())
        .post(`/public/i/${inv.slug}/guestbook`)
        .set("X-Forwarded-For", `192.0.2.${i}`)
        .send({
          guest_name: `Guest ${i}`,
          message: `Selamat berbahagia pesan ke-${i}`,
        })
        .expect(201);
      expect(res.body.data.id).toBeDefined();
    }

    // 20th submission crosses the threshold and activates CAPTCHA
    const res20 = await request(app.getHttpServer())
      .post(`/public/i/${inv.slug}/guestbook`)
      .set("X-Forwarded-For", "192.0.2.20")
      .send({
        guest_name: "Guest 20",
        message: "Selamat berbahagia pesan ke-20",
      })
      .expect(201);
    expect(res20.body.data.id).toBeDefined();

    // Verify Redis has abuse:captcha:<slug> set
    const isCaptchaActive = await redis.exists(`abuse:captcha:${inv.slug}`);
    expect(isCaptchaActive).toBe(1);

    // 21st submission without CAPTCHA token is rejected with 422 CAPTCHA_REQUIRED
    const res21 = await request(app.getHttpServer())
      .post(`/public/i/${inv.slug}/guestbook`)
      .set("X-Forwarded-For", "192.0.2.21")
      .send({
        guest_name: "Guest 21",
        message: "Selamat berbahagia pesan ke-21",
      })
      .expect(422);

    expect(res21.body.error.code).toBe("CAPTCHA_REQUIRED");

    // Also rejected for RSVP on the same flooded slug
    const rsvpRes = await request(app.getHttpServer())
      .post(`/public/i/${inv.slug}/rsvp`)
      .set("X-Forwarded-For", "192.0.2.22")
      .send({
        guest_name: "RSVP Flooder",
        attendance_status: "attending",
      })
      .expect(422);

    expect(rsvpRes.body.error.code).toBe("CAPTCHA_REQUIRED");
  });

  it("rejects invalid Turnstile token with 422 CAPTCHA_INVALID", async () => {
    const inv = await createInvitation({ slug: "invalid-token-test" });

    // Manually activate CAPTCHA mode
    await redis.set(`abuse:captcha:${inv.slug}`, "1", "EX", 1800);

    const res = await request(app.getHttpServer())
      .post(`/public/i/${inv.slug}/guestbook`)
      .set("X-Forwarded-For", "198.51.100.5")
      .send({
        guest_name: "Hacker",
        message: "Spam message",
        captcha_token: "invalid-forged-token",
      })
      .expect(422);

    expect(res.body.error.code).toBe("CAPTCHA_INVALID");
  });

  it("accepts Cloudflare Turnstile test token 1x00000000000000000000AA when CAPTCHA is required", async () => {
    const inv = await createInvitation({ slug: "valid-token-test" });

    // Activate CAPTCHA mode
    await redis.set(`abuse:captcha:${inv.slug}`, "1", "EX", 1800);

    const res = await request(app.getHttpServer())
      .post(`/public/i/${inv.slug}/guestbook`)
      .set("X-Forwarded-For", "198.51.100.10")
      .send({
        guest_name: "Genuine Visitor",
        message: "Pesan dengan captcha valid",
        captcha_token: "1x00000000000000000000AA",
      })
      .expect(201);

    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.status).toBe("approved");
  });

  it("routes guestbook submission to pending when profanity filter is enabled and profanity is detected", async () => {
    const inv = await createInvitation({
      slug: "profanity-filter-test",
      profanityFilterEnabled: true,
      guestbookModeration: false,
    });

    // Seed a profanity term in slug_blocklist
    await pool.query("DELETE FROM slug_blocklist WHERE lower(term) = 'kasarkata'");
    await pool.query(
      `INSERT INTO slug_blocklist (term, category, match_type, reason)
       VALUES ('kasarkata', 'profanity', 'substring', 'Profanity test term')`,
    );
    profanityService.clearCache();

    // Submit with profanity (using leetspeak substitution 'k4s4rk4t4')
    const res = await request(app.getHttpServer())
      .post(`/public/i/${inv.slug}/guestbook`)
      .set("X-Forwarded-For", "203.0.113.1")
      .send({
        guest_name: "Tamu Usil",
        message: "Selamat ya tapi ada k4s4rk4t4 di sini",
      })
      .expect(201);

    // Status MUST be pending because profanity was detected
    expect(res.body.data.status).toBe("pending");

    // Verify in database that status is pending
    const dbRow = await pool.query(
      `SELECT status FROM invitation_guestbook WHERE id = $1`,
      [res.body.data.id],
    );
    expect(dbRow.rows[0]?.status).toBe("pending");
  });

  it("preserves approved status when profanity filter is disabled even if text contains profanity", async () => {
    const inv = await createInvitation({
      slug: "profanity-disabled-test",
      profanityFilterEnabled: false,
      guestbookModeration: false,
    });

    await pool.query("DELETE FROM slug_blocklist WHERE lower(term) = 'kasarkata'");
    await pool.query(
      `INSERT INTO slug_blocklist (term, category, match_type, reason)
       VALUES ('kasarkata', 'profanity', 'substring', 'Profanity test term')`,
    );
    profanityService.clearCache();

    const res = await request(app.getHttpServer())
      .post(`/public/i/${inv.slug}/guestbook`)
      .set("X-Forwarded-For", "203.0.113.2")
      .send({
        guest_name: "Tamu Biasa",
        message: "Selamat ya tapi ada kasarkata di sini",
      })
      .expect(201);

    // Filter disabled -> status remains approved
    expect(res.body.data.status).toBe("approved");
  });

  it("escalates temporary blocks on repeat rate-limit violations and allows manual admin override", async () => {
    const policy = DEFAULT_POLICIES.find((p) => p.name === "general-public")!;
    const testIp = "192.168.100.99";
    const testKey = testIp;

    // Initial check: not blocked
    expect(await rateLimiter.isBlocked(policy, testKey)).toBe(false);

    // 1. First block: strike 1 (15 minutes = 900s)
    await rateLimiter.block(policy, testKey);
    expect(await rateLimiter.isBlocked(policy, testKey)).toBe(true);

    const ttl1 = await redis.ttl(`rl:block:general-public:${testKey}`);
    expect(ttl1).toBeGreaterThan(800);
    expect(ttl1).toBeLessThanOrEqual(900);

    // 2. Second block: strike 2 (30 minutes = 1800s)
    await rateLimiter.block(policy, testKey);
    const ttl2 = await redis.ttl(`rl:block:general-public:${testKey}`);
    expect(ttl2).toBeGreaterThan(1700);
    expect(ttl2).toBeLessThanOrEqual(1800);

    // 3. Third block: strike 3 (1 hour = 3600s)
    await rateLimiter.block(policy, testKey);
    const ttl3 = await redis.ttl(`rl:block:general-public:${testKey}`);
    expect(ttl3).toBeGreaterThan(3500);
    expect(ttl3).toBeLessThanOrEqual(3600);

    // 4. Admin override: unblock key
    await rateLimiter.unblockKey("general-public", testKey);
    expect(await rateLimiter.isBlocked(policy, testKey)).toBe(false);

    // Verification: subsequent check is unblocked
    const ttlAfter = await redis.ttl(`rl:block:general-public:${testKey}`);
    expect(ttlAfter).toBe(-2); // key does not exist
  });
});
