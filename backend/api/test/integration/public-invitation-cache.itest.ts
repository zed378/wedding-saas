import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { Pool } from "pg";
import Redis from "ioredis";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

import { connect, resetTenantData } from "./helpers.ts";
import {
  createTestInvitation,
  createTestTemplateVersion,
  createTestUser,
  type TestInvitation,
  type TestUser,
} from "../support/factories";
import { PublicInvitationRepository } from "../../src/shared/tenancy/public-invitation-repository";
import { PublicInvitationCache } from "../../src/modules/publishing/public-invitation-cache";
import { UnpublishService } from "../../src/modules/publishing/unpublish.service";
import { metrics } from "../../src/shared/metrics/metrics";

const SECTIONS = [
  {
    section_key: "hero",
    component: "HeroClassic",
    enabled_by_default: true,
    configurable: false,
    required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
  },
  {
    section_key: "couple",
    component: "CoupleProfile",
    enabled_by_default: true,
    configurable: true,
  },
];

describe("P3-12 — Public Page Caching and Invalidation", () => {
  let owner: Pool;
  let app: INestApplication;
  let server: unknown;
  let alice: TestUser;
  let redis: Redis;
  let repo: PublicInvitationRepository;
  let cache: PublicInvitationCache;
  let unpublishService: UnpublishService;

  const get = (slug: string) =>
    request(server as never).get(`/public/i/${slug}`);

  beforeAll(async () => {
    owner = await connect(["invitations", "template_versions", "orders"]);
    await resetTenantData(owner);

    process.env["DATABASE_URL"] = (
      process.env["MIGRATION_DATABASE_URL"] ??
      "postgres://wedding_owner:wedding_owner_dev@localhost:55432/wedding"
    ).replace(/\/\/[^@]+@/, "//wedding_app:wedding_app_dev@");
    process.env["REDIS_URL"] =
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56279";
    process.env["JWT_SIGNING_KEY"] = "public-invitation-cache-key-000000000";
    process.env["CDN_BASE_URL"] = "https://cdn.test";

    // Rate limit raised for tests
    process.env["RATE_LIMIT_OVERRIDES"] = JSON.stringify({
      "general-public": { limit: 50_000, windowSeconds: 60 },
    });

    redis = new Redis(
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56279",
      { maxRetriesPerRequest: 2, connectTimeout: 2000 },
    );
    await redis.ping();

    // Clear rate limiter and cache keys
    const stale = await redis.keys("cache:public_invitation:*");
    if (stale.length > 0) await redis.del(...stale);

    const { AppModule } = await import("../../src/app.module.ts");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();

    repo = app.get(PublicInvitationRepository);
    cache = app.get(PublicInvitationCache);
    unpublishService = app.get(UnpublishService);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await owner?.end();
    await redis?.quit().catch(() => redis.disconnect());
  });

  beforeEach(async () => {
    await resetTenantData(owner);
    alice = await createTestUser(owner, { fullName: "Alice" });

    // Clean up Redis public invitation cache
    const stale = await redis.keys("cache:public_invitation:*");
    if (stale.length > 0) await redis.del(...stale);
  });

  const publishInvitation = async (
    options: {
      slug?: string;
      status?: string;
      templateVersionId?: string;
    } = {},
  ): Promise<TestInvitation & { slug: string; templateVersionId: string }> => {
    let templateVersionId = options.templateVersionId;
    let templateId: string | undefined;
    if (!templateVersionId) {
      const template = await createTestTemplateVersion(owner, {
        sections: SECTIONS,
      });
      templateVersionId = template.versionId;
      templateId = template.templateId;
    }

    const slug =
      options.slug ?? `alice-${Math.random().toString(36).slice(2, 8)}`;

    const invitation = await createTestInvitation(owner, {
      owner: alice,
      template: { templateId: templateId ?? "test-template", versionId: templateVersionId },
      status: options.status ?? "published",
      slug,
      internalName: "Pernikahan Alice Cache Test",
    });

    await owner.query(
      `INSERT INTO invitation_people (invitation_id, role, full_name, nickname)
       VALUES ($1, 'groom', 'Budi Santoso', 'Budi'), ($1, 'bride', 'Siti Rahayu', 'Siti')`,
      [invitation.id],
    );

    return { ...invitation, slug, templateVersionId };
  };

  it("100 concurrent requests on a cold cache query origin exactly once (DoD 2 singleflight)", async () => {
    const inv = await publishInvitation();

    const spy = vi.spyOn(repo, "findPublishedBySlug");

    // Launch 100 concurrent requests
    const responses = await Promise.all(
      Array.from({ length: 100 }, () => get(inv.slug)),
    );

    // All 100 must succeed with status 200
    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("published");
    }

    // Origin DB query must have executed exactly once
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it("serves subsequent requests from Redis cache without querying DB, recording hit metrics", async () => {
    const inv = await publishInvitation();

    // First request: cache miss
    const res1 = await get(inv.slug);
    expect(res1.status).toBe(200);

    const initialHits = metrics.publicInvitationCacheHits.get();

    const spy = vi.spyOn(repo, "findPublishedBySlug");

    // Second request: cache hit
    const res2 = await get(inv.slug);
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual(res1.body);

    // DB was never called on cache hit
    expect(spy).not.toHaveBeenCalled();

    const newHits = metrics.publicInvitationCacheHits.get();
    expect(newHits).toBeGreaterThan(initialHits);

    spy.mockRestore();
  });

  it("serves fresh content when template version changes (DoD 3)", async () => {
    const inv = await publishInvitation();

    // Warm cache with initial version
    const resInitial = await get(inv.slug);
    expect(resInitial.status).toBe(200);

    // Create a new template version with additional sections
    const newTemplate = await createTestTemplateVersion(owner, {
      sections: [
        {
          section_key: "hero",
          component: "HeroClassic",
          enabled_by_default: true,
          configurable: false,
          required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
        },
        {
          section_key: "couple",
          component: "CoupleProfile",
          enabled_by_default: true,
          configurable: true,
        },
        {
          section_key: "quote",
          component: "QuoteBanner",
          enabled_by_default: true,
          configurable: true,
        },
      ],
    });

    // Update invitation's template_version_id in the DB
    await owner.query(
      `UPDATE invitations SET template_version_id = $1 WHERE id = $2`,
      [newTemplate.versionId, inv.id],
    );

    // Invalidate the slug pointer (as changeTemplate / worker invalidator does)
    await cache.invalidate({ slug: inv.slug, invitationId: inv.id });

    // Fetch again: should fetch fresh template version without serving stale cache
    const resUpdated = await get(inv.slug);
    expect(resUpdated.status).toBe(200);
    expect(resUpdated.body.data.template.sections).toHaveLength(3);
  });

  it("an owner edit is visible publicly immediately after invalidation (DoD 1)", async () => {
    const inv = await publishInvitation();

    // Populate cache
    const resInitial = await get(inv.slug);
    expect(resInitial.status).toBe(200);
    expect(resInitial.body.data.invitation.couple.groom.nickname).toBe("Budi");

    // Owner edits groom nickname in database
    await owner.query(
      `UPDATE invitation_people SET nickname = 'Budi Baru' WHERE invitation_id = $1 AND role = 'groom'`,
      [inv.id],
    );

    // Invalidate cache entry
    await cache.invalidate({ slug: inv.slug, invitationId: inv.id });

    // Subsequent read returns fresh data
    const resUpdated = await get(inv.slug);
    expect(resUpdated.status).toBe(200);
    expect(resUpdated.body.data.invitation.couple.groom.nickname).toBe("Budi Baru");
  });

  it("public page 404s immediately after unpublish through the cache layer (DoD 5, P3-10 obligation)", async () => {
    const inv = await publishInvitation();

    // Read through cache: verify it is cached and returns 200
    const resBefore = await get(inv.slug);
    expect(resBefore.status).toBe(200);
    expect(resBefore.body.data.status).toBe("published");

    // Ensure it was cached in Redis
    const cached = await cache.get(inv.slug);
    expect(cached).toBeDefined();

    // Unpublish invitation via UnpublishService
    await unpublishService.unpublish(alice.scope, inv.id);

    // Immediate read of the public page through the cache layer must return 404
    const resAfter = await get(inv.slug);
    expect(resAfter.status).toBe(404);
    expect(resAfter.body.success).toBe(false);

    // Redis cache for this slug must be purged
    const cachedAfter = await cache.get(inv.slug);
    expect(cachedAfter).toBeUndefined();
  });

  it("fails open gracefully to origin DB when Redis encounters an error", async () => {
    const inv = await publishInvitation();

    // Mock cache.get to throw an unexpected Redis error
    const spy = vi.spyOn(cache, "get").mockRejectedValueOnce(new Error("Redis connection refused"));

    const res = await get(inv.slug);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("published");

    spy.mockRestore();
  });
});
