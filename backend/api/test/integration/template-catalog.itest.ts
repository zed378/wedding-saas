import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Redis as IORedis } from "ioredis";
import type { Pool } from "pg";

import { connect, resetTenantData } from "./helpers.ts";
import { startHarness, type Harness } from "../support/harness";
import { createTestTemplateVersion } from "../support/factories";
import { RedisCache } from "../../src/infra/cache/redis-cache";
import { TemplateRepository } from "../../src/modules/template/template.repository";
import {
  TemplateService,
  TEMPLATE_CACHE_NAMESPACE,
} from "../../src/modules/template/template.service";
import type { CachePort } from "../../src/infra/cache/cache.port";

/**
 * P2-01 — the catalog, against a real database and a real Redis.
 *
 * The cache is the reason this is an integration test rather than a unit one. Its whole
 * behaviour is "what Redis returns", and the property the card's DoD asks about —
 * invalidation on publish — is a property of the key layout and the generation counter,
 * not of any logic a mock would exercise.
 */

const REDIS_URL =
  process.env["TEST_REDIS_URL"] ??
  process.env["REDIS_URL"] ??
  "redis://localhost:56379";

/** A section list with a known set of keys, so `supported_sections` has something to say. */
const SECTIONS = [
  {
    section_key: "hero",
    component: "HeroClassic",
    enabled_by_default: true,
    configurable: false,
    required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
  },
  {
    section_key: "gallery",
    component: "GalleryGrid",
    enabled_by_default: true,
    configurable: true,
    max_items: 20,
    required_fields: [],
  },
];

describe("P2-01 — the template catalog", () => {
  let harness: Harness;
  let owner: Pool;
  let redis: IORedis;
  let cache: CachePort;
  let service: TemplateService;

  beforeAll(async () => {
    harness = await startHarness();
    owner = await connect(["templates", "template_versions"]);

    redis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    await redis.ping();

    cache = new RedisCache(redis);
    service = new TemplateService(new TemplateRepository(harness.db), cache);
  }, 60_000);

  afterAll(async () => {
    await owner?.end();
    await redis?.quit().catch(() => redis.disconnect());
    await harness?.stop();
  });

  beforeEach(async () => {
    await resetTenantData(owner);
    // A fresh generation per test, so one test's cached page cannot answer another's.
    await service.invalidate();
  });

  /** Publish a template row and one published version of it. */
  const publish = async (
    slug: string,
    overrides: {
      name?: string;
      category?: string[];
      isPremium?: boolean;
      version?: string;
      sections?: unknown;
      status?: string;
      versionStatus?: string;
    } = {},
  ): Promise<{ templateId: string; versionId: string }> => {
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO templates (slug, name, category, is_premium, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        slug,
        overrides.name ?? slug,
        overrides.category ?? ["modern"],
        overrides.isPremium ?? false,
        overrides.status ?? "published",
      ],
    );
    const templateId = rows[0]!.id;

    const created = await createTestTemplateVersion(owner, {
      templateId,
      version: overrides.version ?? "1.0.0",
      sections: overrides.sections ?? SECTIONS,
    });

    await owner.query(
      `UPDATE template_versions SET status = $2, released_at = now() WHERE id = $1`,
      [created.versionId, overrides.versionStatus ?? "published"],
    );

    return { templateId, versionId: created.versionId };
  };

  // ------------------------------------------------------------ DoD item 1

  describe("only published work reaches the catalog", () => {
    it("lists a template that has a published version", async () => {
      await publish("elegant-rose", { name: "Elegant Rose" });

      const { items, total } = await service.list({ limit: 20, offset: 0 });

      expect(total).toBe(1);
      expect(items[0]?.slug).toBe("elegant-rose");
    });

    it("hides a template whose only version is a draft", async () => {
      // The normal state between an administrator creating a template and releasing it.
      // The template row itself is `published`; there is nothing to render.
      await publish("unreleased", { versionStatus: "draft" });

      const { items, total } = await service.list({ limit: 20, offset: 0 });

      expect(items).toEqual([]);
      expect(total).toBe(0);
    });

    it("hides a template whose only version is deprecated", async () => {
      // BR-3.3: still renderable for invitations locked to it, gone from the catalog.
      await publish("retired", { versionStatus: "deprecated" });

      const { items } = await service.list({ limit: 20, offset: 0 });

      expect(items).toEqual([]);
    });

    it("hides a draft template even when its version is published", async () => {
      await publish("draft-template", { status: "draft" });

      const { items } = await service.list({ limit: 20, offset: 0 });

      expect(items).toEqual([]);
    });

    it("counts a template once, however many published versions it has", async () => {
      const { templateId } = await publish("many-versions", {
        version: "1.0.0",
      });
      const second = await createTestTemplateVersion(owner, {
        templateId,
        version: "1.1.0",
        sections: SECTIONS,
      });
      await owner.query(
        `UPDATE template_versions SET status = 'published', released_at = now() WHERE id = $1`,
        [second.versionId],
      );

      const { items, total } = await service.list({ limit: 20, offset: 0 });

      // A join would report two. The page and the count must agree, or pagination
      // promises a second page that does not exist.
      expect(total).toBe(1);
      expect(items).toHaveLength(1);
    });

    it("refuses the detail of a template with no published version", async () => {
      await publish("unreleased", { versionStatus: "draft" });

      await expect(service.detail("unreleased")).rejects.toMatchObject({
        status: 404,
      });
    });

    it("answers 404 identically for a template that does not exist", async () => {
      // The same answer for "never existed" and "exists but unreleased": distinguishing
      // them leaks the release schedule.
      await expect(service.detail("no-such-template")).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  // ------------------------------------------------------------ DoD item 2

  describe("the detail response", () => {
    it("carries every field docs/API/03's example names", async () => {
      await publish("elegant-rose", {
        name: "Elegant Rose",
        category: ["modern", "floral"],
        isPremium: true,
        version: "1.2.0",
      });

      const detail = await service.detail("elegant-rose");

      expect(Object.keys(detail).sort()).toEqual([
        "category",
        "current_version",
        "id",
        "is_premium",
        "name",
        "slug",
        "supported_sections",
        "thumbnail_url",
      ]);
      expect(detail.category).toEqual(["modern", "floral"]);
      expect(detail.is_premium).toBe(true);
      expect(detail.current_version.version).toBe("1.2.0");
      // The sections come back as STORED, which is the validator's normalised form --
      // `P0-20` fills in `optional_fields: []` on the way in. Comparing against the
      // literal that was written would be asserting that no normalisation happened, and
      // the editor's dynamic form is built from the stored shape, not the authored one.
      expect(detail.current_version.sections).toEqual(
        SECTIONS.map((section) => ({ optional_fields: [], ...section })),
      );
      expect(detail.current_version.customizable_theme_keys).toEqual([
        "colors.primary",
      ]);
    });

    it("never exposes the template's own status column", async () => {
      await publish("elegant-rose");

      const detail = await service.detail("elegant-rose");

      // How the catalog decides what to show is not the catalog's business to publish.
      expect(detail).not.toHaveProperty("status");
      expect(JSON.stringify(detail)).not.toContain('"draft"');
    });

    it("lists the sections the template supports, in canonical order", async () => {
      // Authored gallery-first; the badge list must still read hero, gallery -- a user
      // comparing two templates should find the same badge in the same place.
      await publish("out-of-order", {
        sections: [SECTIONS[1], SECTIONS[0]],
      });

      const detail = await service.detail("out-of-order");

      expect(detail.supported_sections).toEqual(["hero", "gallery"]);
    });

    it("serves the NEWEST published version when there are several", async () => {
      const { templateId } = await publish("evolving", { version: "1.9.0" });

      const newer = await createTestTemplateVersion(owner, {
        templateId,
        // Lexically BEFORE '1.9.0'. A string sort would pick the wrong one, which is why
        // the query orders by released_at.
        version: "1.10.0",
        sections: SECTIONS,
      });
      await owner.query(
        `UPDATE template_versions SET status = 'published', released_at = now() + interval '1 day' WHERE id = $1`,
        [newer.versionId],
      );

      const detail = await service.detail("evolving");

      expect(detail.current_version.version).toBe("1.10.0");
    });
  });

  // ------------------------------------------------------------ DoD item 3

  describe("a specific version by name", () => {
    it("serves a deprecated version on explicit request", async () => {
      await publish("retired", {
        version: "1.0.0",
        versionStatus: "deprecated",
      });

      const detail = await service.version("retired", "1.0.0");

      expect(detail.current_version.version).toBe("1.0.0");
      expect(detail.current_version.status).toBe("deprecated");
    });

    it("still refuses a draft version", async () => {
      // Deprecated was released and has invitations depending on it. A draft never was,
      // and serving one would let anyone with the URL preview unreleased work.
      await publish("unreleased", { version: "2.0.0", versionStatus: "draft" });

      await expect(
        service.version("unreleased", "2.0.0"),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("does not serve a version belonging to a different template", async () => {
      await publish("first", { version: "1.0.0" });
      await publish("second", { version: "2.0.0" });

      await expect(service.version("first", "2.0.0")).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  // ------------------------------------------------------------ DoD item 4

  describe("caching and invalidation", () => {
    it("answers the second read from the cache", async () => {
      await publish("cached", { name: "Before" });
      await service.detail("cached");

      // Change the row underneath, without invalidating. A cached read must not see it --
      // that is what makes the next test meaningful.
      await owner.query("UPDATE templates SET name = 'After' WHERE slug = $1", [
        "cached",
      ]);

      expect((await service.detail("cached")).name).toBe("Before");
    });

    it("serves the new version after invalidate(), which is what a publish calls", async () => {
      await publish("cached", { name: "Before" });
      await service.detail("cached");

      await owner.query("UPDATE templates SET name = 'After' WHERE slug = $1", [
        "cached",
      ]);
      await service.invalidate();

      expect((await service.detail("cached")).name).toBe("After");
    });

    it("invalidates the list as well as the detail, in one bump", async () => {
      await publish("first");
      await service.list({ limit: 20, offset: 0 });

      await publish("second");
      // Without invalidation the cached page still shows one template.
      expect((await service.list({ limit: 20, offset: 0 })).total).toBe(1);

      await service.invalidate();

      expect((await service.list({ limit: 20, offset: 0 })).total).toBe(2);
    });

    it("does not confuse two filter combinations", async () => {
      await publish("free-one", { isPremium: false });
      await publish("premium-one", { isPremium: true });

      const free = await service.list({
        isPremium: false,
        limit: 20,
        offset: 0,
      });
      const premium = await service.list({
        isPremium: true,
        limit: 20,
        offset: 0,
      });

      expect(free.items.map((i) => i.slug)).toEqual(["free-one"]);
      expect(premium.items.map((i) => i.slug)).toEqual(["premium-one"]);
    });

    it("keeps serving when Redis is unreachable", async () => {
      // The property that matters more than the cache itself: a cache is an optimisation,
      // and an optimisation that can take the catalog down is a liability.
      const broken = new IORedis("redis://127.0.0.1:59997", {
        maxRetriesPerRequest: 1,
        connectTimeout: 300,
        commandTimeout: 300,
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      const degraded = new TemplateService(
        new TemplateRepository(harness.db),
        new RedisCache(broken),
      );

      await publish("still-works");

      const { items } = await degraded.list({ limit: 20, offset: 0 });
      expect(items.map((i) => i.slug)).toEqual(["still-works"]);

      await broken.quit().catch(() => broken.disconnect());
    });

    it("scopes its keys to its own namespace", async () => {
      await publish("scoped");
      await service.detail("scoped");

      const keys = await redis.keys(`cache:${TEMPLATE_CACHE_NAMESPACE}:*`);
      expect(keys.length).toBeGreaterThan(0);
      // Nothing outside the namespace, so an invalidation here cannot reach the rate
      // limiter's keys or the queue's on the same server.
      for (const key of keys) {
        expect(key.startsWith(`cache:${TEMPLATE_CACHE_NAMESPACE}:`)).toBe(true);
      }
    });
  });

  // ------------------------------------------------------------ filters

  describe("filters", () => {
    it("filters by one category out of several on a template", async () => {
      await publish("floral", { category: ["modern", "floral"] });
      await publish("rustic", { category: ["rustic"] });

      const { items } = await service.list({
        category: "floral",
        limit: 20,
        offset: 0,
      });

      expect(items.map((i) => i.slug)).toEqual(["floral"]);
    });

    it("searches name and category", async () => {
      await publish("a-template", { name: "Mawar Elegan" });
      await publish("b-template", { name: "Something", category: ["mawar"] });
      await publish("c-template", { name: "Unrelated", category: ["other"] });

      const { items } = await service.list({
        search: "mawar",
        limit: 20,
        offset: 0,
      });

      expect(items.map((i) => i.slug).sort()).toEqual([
        "a-template",
        "b-template",
      ]);
    });

    it("treats a percent sign in a search as text, not a wildcard", async () => {
      await publish("literal", { name: "100% Katun" });
      await publish("other", { name: "Nothing alike" });

      const { items } = await service.list({
        search: "100%",
        limit: 20,
        offset: 0,
      });

      // Unescaped, `%` matches everything and this returns both.
      expect(items.map((i) => i.slug)).toEqual(["literal"]);
    });

    it("paginates without repeating or skipping a row", async () => {
      for (let i = 0; i < 5; i += 1) {
        await publish(`template-${String(i)}`);
      }

      const first = await service.list({ limit: 2, offset: 0 });
      const second = await service.list({ limit: 2, offset: 2 });
      const third = await service.list({ limit: 2, offset: 4 });

      const seen = [...first.items, ...second.items, ...third.items].map(
        (i) => i.slug,
      );
      expect(first.total).toBe(5);
      expect(new Set(seen).size).toBe(5);
    });
  });
});
