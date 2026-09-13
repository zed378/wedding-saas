import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { Pool } from "pg";
import Redis from "ioredis";

import { connect, resetTenantData } from "./helpers.ts";
import { expectSuccess } from "../support/envelope-assertions";
import {
  createTestInvitation,
  createTestMedia,
  createTestOrder,
  createTestTemplateVersion,
  createTestUser,
  type TestInvitation,
  type TestUser,
} from "../support/factories";

/**
 * `P2-07` — `GET /public/i/:slug`. `docs/API/08`.
 *
 * This is the only unauthenticated read of user data in the product, so the whole test
 * file is really about two questions:
 *
 *   1. **Does anything that is not currently published leak?** There is no ownership
 *      check to test here — the `status = 'published' AND deleted_at IS NULL` predicate
 *      IS the authorization model, and the test that proves it is the one asserting that
 *      a draft, an unpublished, an expired and a deleted invitation are byte-identical to
 *      a slug that never existed.
 *   2. **Does anything appear in the payload that should not?** Asserted against an
 *      explicit forbidden-key list rather than by reading the response and nodding.
 *
 * Everything runs over HTTP against the real `AppModule`, because both questions are about
 * bytes on the wire and a service-level assertion cannot see them.
 */

/**
 * A template whose sections each reference only their own data.
 *
 * The reference template deliberately shares paths between sections — its `hero` lists
 * `gallery.photos.*.media_id`, because it draws a photo behind the couple's names — which
 * is realistic and is the wrong fixture for a per-section omission test: disabling
 * `gallery` there correctly keeps the photos, and the test would be asserting the
 * sharing rather than the omission. There is a dedicated test for the sharing below.
 */
const SECTIONS = [
  {
    section_key: "couple",
    component: "CoupleProfile",
    enabled_by_default: true,
    configurable: true,
    required_fields: ["couple.groom.full_name", "couple.bride.full_name"],
    optional_fields: ["couple.groom.photo", "couple.bride.photo"],
  },
  {
    section_key: "event",
    component: "EventCardDouble",
    enabled_by_default: true,
    configurable: true,
    required_fields: ["events.*.title", "events.*.venue_name"],
    optional_fields: [],
  },
  {
    section_key: "gallery",
    component: "GalleryGrid",
    enabled_by_default: true,
    configurable: true,
    required_fields: ["gallery.photos"],
    optional_fields: [],
  },
  {
    section_key: "quote",
    component: "QuoteBanner",
    enabled_by_default: true,
    configurable: true,
    required_fields: ["quote.text"],
    optional_fields: [],
  },
  {
    section_key: "gift",
    component: "GiftAccountList",
    enabled_by_default: true,
    configurable: true,
    required_fields: ["gift.accounts.*.account_number"],
    optional_fields: [],
  },
];

const ALL_SECTIONS = ["couple", "event", "gallery", "quote", "gift"];

/**
 * Keys that must never appear anywhere in the payload.
 *
 * Owner and internal identity, commercial data, and the moderation flag. Checked over the
 * serialized JSON rather than over the object's own keys, so a field nested three levels
 * down is caught too.
 */
const FORBIDDEN_KEYS = [
  "owner_id",
  "internal_name",
  "template_id",
  "template_version_id",
  "invitation_id",
  "media_id",
  "photo_media_id",
  "published_at",
  "expiry_date",
  "created_at",
  "updated_at",
  "deleted_at",
  "guestbook_moderation",
  "order_id",
  "package_id",
  "amount_total",
  "uploaded_by",
  "storage_path",
];

describe("P2-07 — GET /public/i/:slug", () => {
  let owner: Pool;
  let app: INestApplication;
  let server: unknown;
  let alice: TestUser;
  let redis: Redis;

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
    process.env["JWT_SIGNING_KEY"] = "public-invitation-signing-key-000000000";
    process.env["CDN_BASE_URL"] = "https://cdn.test";
    /*
     * The suite makes far more than `general-public`'s 100 requests a minute from one
     * address, and every one of them is the same IP. Raised so the file measures what it
     * claims to measure -- the first run passed and the second returned 429 for most of
     * it, which is a fixture problem masquerading as a finding.
     *
     * That the route IS limited is asserted below from the policy's own headers rather
     * than by exhausting a budget: `rate-limit.itest.ts` owns the limiter's behaviour,
     * and a second suite racing the same counter is how both become flaky.
     */
    process.env["RATE_LIMIT_OVERRIDES"] = JSON.stringify({
      "general-public": { limit: 50_000, windowSeconds: 60 },
    });

    /*
     * Clear the limiter's counters and, more importantly, its BLOCKS.
     *
     * This cost an hour. Raising the limit above is not enough on its own: the first run
     * of this suite exceeded `general-public` and earned an escalating auto-block
     * (`docs/SECURITY/10` § Monitoring & Auto-block), which is stored under `rl:block:*`
     * and lasts fifteen minutes. Every later run then returned 429 for two thirds of the
     * file whatever the limit said — and it looks exactly like a broken endpoint.
     */
    redis = new Redis(
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56279",
      { maxRetriesPerRequest: 2, connectTimeout: 2000 },
    );
    await redis.ping();
    const stale = await redis.keys("rl:*");
    if (stale.length > 0) await redis.del(...stale);

    const { AppModule } = await import("../../src/app.module.ts");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await owner?.end();
    await redis?.quit().catch(() => redis.disconnect());
  });

  beforeEach(async () => {
    await resetTenantData(owner);
    alice = await createTestUser(owner, { fullName: "Alice" });
  });

  /** A published invitation with one of everything, at `slug`. */
  const publish = async (
    options: {
      slug?: string;
      status?: string;
      enabled?: readonly string[];
      sections?: unknown;
      deleted?: boolean;
    } = {},
  ): Promise<TestInvitation & { slug: string }> => {
    const template = await createTestTemplateVersion(owner, {
      sections: options.sections ?? SECTIONS,
    });
    const slug =
      options.slug ?? `alice-${Math.random().toString(36).slice(2, 8)}`;

    const invitation = await createTestInvitation(owner, {
      owner: alice,
      template,
      status: options.status ?? "published",
      slug,
      internalName: "Pernikahan Alice",
    });

    await owner.query(
      `INSERT INTO invitation_people (invitation_id, role, full_name, nickname)
       VALUES ($1, 'groom', 'Budi Santoso', 'Budi'), ($1, 'bride', 'Siti Rahayu', 'Siti')`,
      [invitation.id],
    );
    await owner.query(
      `INSERT INTO invitation_events
         (invitation_id, type, title, event_date, start_time, venue_name, address, display_order)
       VALUES ($1, 'akad', 'Akad Nikah', '2026-12-01', '08:00', 'Masjid Agung', 'Jl. Merdeka 1', 0)`,
      [invitation.id],
    );
    await owner.query(
      `INSERT INTO invitation_bank_accounts
         (invitation_id, type, provider_name, account_number, account_holder, display_order)
       VALUES ($1, 'bank', 'BCA', '1234567890', 'Pemilik Rekening', 0)`,
      [invitation.id],
    );
    await owner.query(
      `INSERT INTO invitation_quote (invitation_id, text, source)
       VALUES ($1, 'Cinta adalah perjalanan.', 'QS Ar-Rum 21')`,
      [invitation.id],
    );

    const photo = await createTestMedia(owner, {
      invitation,
      uploadedBy: alice,
      status: "ready",
    });
    await owner.query(
      `INSERT INTO invitation_gallery (invitation_id, media_id, caption, display_order, is_cover)
       VALUES ($1, $2, 'Pre-wedding', 0, true)`,
      [invitation.id, photo.id],
    );

    await owner.query(
      `INSERT INTO invitation_settings (invitation_id, enabled_sections)
       VALUES ($1, $2)`,
      [invitation.id, [...(options.enabled ?? ALL_SECTIONS)]],
    );

    if (options.deleted === true) {
      await owner.query(
        "UPDATE invitations SET deleted_at = now() WHERE id = $1",
        [invitation.id],
      );
    }

    return { ...invitation, slug };
  };

  // ------------------------------------------------------------------ DoD item 1

  describe("nothing that is not published is served", () => {
    it("answers a draft, an unpublished, an expired and a deleted invitation identically to a slug that never existed", async () => {
      const absent = await get("nobody-lives-here");

      const cases: { label: string; slug: string }[] = [];
      for (const status of ["draft", "paid", "expired"]) {
        const { slug } = await publish({ status });
        cases.push({ label: status, slug });
      }
      const deleted = await publish({ deleted: true });
      cases.push({ label: "soft-deleted", slug: deleted.slug });

      expect(absent.status).toBe(404);

      for (const { label, slug } of cases) {
        const res = await get(slug);

        // The status AND the body. A shared status with a differing message is still an
        // oracle -- "not found" against "this invitation has ended" tells an attacker
        // which slugs are real, which is exactly what `docs/API/08` forbids.
        expect(res.status, label).toBe(absent.status);
        expect(res.body, label).toEqual(absent.body);
      }
    });

    it("answers a malformed slug the same way, without touching the database", async () => {
      // `docs/BACKEND/06`: validate the shape BEFORE querying. Asserted by behaviour --
      // an uppercase slug is rejected identically -- since the point is the response, and
      // the round trip saved is why the check is first.
      const absent = await get("nobody-lives-here");

      for (const bad of ["AB", "x", "-leading", "trailing-", "spaced%20out"]) {
        const res = await get(bad);
        expect(res.status, bad).toBe(404);
        expect(res.body, bad).toEqual(absent.body);
      }
    });

    it("serves the invitation once it is published, so the 404 is not vacuous", async () => {
      // The control. Without it every assertion above would pass against an endpoint
      // that returns 404 for everything.
      const { slug } = await publish();

      const data = await expectSuccess<{ status: string }>(await get(slug));
      expect(data.status).toBe("published");
    });
  });

  // ------------------------------------------------------------------ DoD item 2

  describe("a disabled section's data is absent", () => {
    it("omits bank_accounts entirely when the gift section is off", async () => {
      // `docs/API/08` calls this one out by name: "respect the user's toggle even if data
      // exists in the DB". The row IS in the database -- `publish()` always writes one --
      // so this asserts omission, not absence of data.
      const { slug } = await publish({
        enabled: ALL_SECTIONS.filter((s) => s !== "gift"),
      });

      const res = await get(slug);
      const data = expectSuccess<{ invitation: Record<string, unknown> }>(res);

      expect(data.invitation).not.toHaveProperty("bank_accounts");
      expect(JSON.stringify(res.body)).not.toContain("1234567890");
    });

    it.each([
      ["couple", "Budi Santoso"],
      ["event", "Masjid Agung"],
      ["gallery", "Pre-wedding"],
      ["quote", "Cinta adalah perjalanan."],
      ["gift", "1234567890"],
    ])("omits %s data when that section is off", async (section, needle) => {
      const { slug } = await publish({
        enabled: ALL_SECTIONS.filter((s) => s !== section),
      });

      const res = await get(slug);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(needle);
    });

    it.each([
      ["couple", "Budi Santoso"],
      ["event", "Masjid Agung"],
      ["gallery", "Pre-wedding"],
      ["quote", "Cinta adalah perjalanan."],
      ["gift", "1234567890"],
    ])("serves %s data when that section is on", async (_section, needle) => {
      // The mirror of each case above. A payload builder that omitted everything would
      // pass the whole block otherwise.
      const { slug } = await publish();

      const res = await get(slug);
      expect(JSON.stringify(res.body)).toContain(needle);
    });

    it("keeps data a section that is STILL displayed needs, even when another section is off", async () => {
      // The reason the rule is expressed over field paths rather than section keys. Here
      // `couple` declares the gallery photo among its optional fields -- as the reference
      // template's `hero` really does -- so turning the gallery section off must not take
      // the photo away from a section that is still drawing it.
      const shared = SECTIONS.map((section) =>
        section.section_key === "couple"
          ? { ...section, optional_fields: ["gallery.photos.*.media_id"] }
          : section,
      );

      const { slug } = await publish({
        sections: shared,
        enabled: ALL_SECTIONS.filter((s) => s !== "gallery"),
      });

      const res = await get(slug);
      const data = expectSuccess<{
        invitation: { gallery: unknown[] };
      }>(res);

      expect(data.invitation.gallery).toHaveLength(1);
    });

    it("still serves a NON-configurable section the settings omit", async () => {
      // `docs/FRONTEND/04` § Render Flow step 2. A settings row that omits a section the
      // template always displays must not strip the data that section renders -- it would
      // blank part of a live page.
      const { slug } = await publish({
        sections: SECTIONS.map((section) =>
          section.section_key === "couple"
            ? { ...section, configurable: false }
            : section,
        ),
        enabled: [],
      });

      const res = await get(slug);
      expect(JSON.stringify(res.body)).toContain("Budi Santoso");
    });
  });

  // ------------------------------------------------------------------ DoD item 3

  describe("no owner or commercial field is exposed", () => {
    it("contains none of the forbidden keys", async () => {
      const { slug } = await publish();
      const res = await get(slug);
      const serialized = JSON.stringify(res.body);

      for (const key of FORBIDDEN_KEYS) {
        expect(serialized, key).not.toContain(`"${key}"`);
      }
    });

    it("contains no identifier of the owner, the template or the invitation itself", async () => {
      const invitation = await publish();
      const res = await get(invitation.slug);
      const serialized = JSON.stringify(res.body);

      for (const [label, value] of [
        ["owner id", invitation.ownerId],
        ["template id", invitation.templateId],
        ["template version id", invitation.templateVersionId],
        ["internal name", "Pernikahan Alice"],
      ] as const) {
        expect(serialized, label).not.toContain(value);
      }

      /*
       * The invitation id is the exception, and it is worth being precise rather than
       * dropping the assertion. `docs/ARCHITECTURE/05` § Path Structure puts it in the
       * storage key —
       *
       *   invitations/{invitation_id}/media/{media_id}/{variant}.webp
       *
       * — so every photo URL on a public page contains it. That is the documented layout
       * and not something this endpoint chose. What it must not do is put the id anywhere
       * ELSE, which is what this asserts: strip the media URLs and the id is gone.
       *
       * The id is not a capability. Every `:id` endpoint filters on `owner_id`
       * (`docs/SECURITY/05`), so holding it buys a guest nothing — `P1-25`'s sweep is the
       * standing proof of that, not this test.
       */
      const withoutMediaUrls = serialized.replace(
        /https:\/\/cdn\.test\/[^"]*/g,
        "",
      );
      expect(withoutMediaUrls).not.toContain(invitation.id);
    });

    it("exposes the top level of the payload and nothing else", async () => {
      const { slug } = await publish();
      const data = await expectSuccess<Record<string, unknown>>(
        await get(slug),
      );

      expect(Object.keys(data).sort()).toEqual([
        "display",
        "invitation",
        "status",
        "template",
      ]);
    });
  });

  // --------------------------------------------------------------- the watermark

  describe("display.watermark", () => {
    it("is true for an invitation nobody has paid for", async () => {
      // BR-2.8's free trial publish lands here, and watermarked is the correct answer.
      const { slug } = await publish();

      const data = await expectSuccess<{ display: { watermark: boolean } }>(
        await get(slug),
      );
      expect(data.display.watermark).toBe(true);
    });

    it("stays true for an order that is only pending", async () => {
      // Otherwise the watermark comes off by opening a payment page and walking away.
      const invitation = await publish();
      await createTestOrder(owner, {
        invitation,
        user: alice,
        status: "pending",
      });

      const data = await expectSuccess<{ display: { watermark: boolean } }>(
        await get(invitation.slug),
      );
      expect(data.display.watermark).toBe(true);
    });

    it("follows the paid package", async () => {
      const invitation = await publish();
      await createTestOrder(owner, {
        invitation,
        user: alice,
        status: "paid",
      });

      const data = await expectSuccess<{ display: { watermark: boolean } }>(
        await get(invitation.slug),
      );

      const { rows } = await owner.query<{ has_watermark: boolean }>(
        "SELECT has_watermark FROM packages WHERE id = 'standard'",
      );
      expect(data.display.watermark).toBe(rows[0]!.has_watermark);
    });
  });

  // ----------------------------------------------------------------- the contract

  describe("the contract", () => {
    it("carries the template's sections, theme and customizable keys", async () => {
      const { slug } = await publish();

      const data = await expectSuccess<{
        template: Record<string, unknown>;
      }>(await get(slug));

      expect(Object.keys(data.template).sort()).toEqual([
        "customizable_theme_keys",
        "sections",
        "theme",
      ]);
      expect(Array.isArray(data.template.sections)).toBe(true);
    });

    it("serves media as URLs, never as ids", async () => {
      const { slug } = await publish();

      const data = await expectSuccess<{
        invitation: { gallery: { url?: string; thumbnail_url?: string }[] };
      }>(await get(slug));

      expect(data.invitation.gallery[0]?.url).toMatch(/^https:\/\/cdn\.test\//);
      expect(data.invitation.gallery[0]?.thumbnail_url).toMatch(
        /^https:\/\/cdn\.test\//,
      );
    });

    it("omits the URL of a photo that is still processing", async () => {
      // `docs/ARCHITECTURE/05` § Access Control: no bucket URL as a fallback. A variant
      // that does not exist yet has no URL, and inventing one would 404 on the page.
      const invitation = await publish();
      await owner.query(
        "UPDATE media SET status = 'processing' WHERE invitation_id = $1",
        [invitation.id],
      );

      const data = await expectSuccess<{
        invitation: { gallery: { url?: string }[] };
      }>(await get(invitation.slug));

      expect(data.invitation.gallery[0]).toBeDefined();
      expect(data.invitation.gallery[0]).not.toHaveProperty("url");
    });

    it("is deterministic — two requests produce identical bytes", async () => {
      // `docs/API/08` § Caching. A response that varied per request could not be cached
      // at the edge, which is the whole delivery model for the public page.
      const { slug } = await publish();

      const [first, second] = await Promise.all([get(slug), get(slug)]);

      expect(JSON.stringify(first.body)).toBe(JSON.stringify(second.body));
    });

    it("is rate limited as a public route", async () => {
      // `docs/SECURITY/10`: there is no session to key on, so the IP is the key and the
      // limit is the only control against walking the slug space. Asserted from the
      // headers, which say which policy ran, rather than by spending a budget another
      // suite is also counting against.
      const { slug } = await publish();

      const res = await get(slug);
      expect(res.headers["x-ratelimit-limit"]).toBeDefined();
      expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    });

    it("ignores query parameters, including personalization", async () => {
      // `?to=Nama` is handled on the frontend. Reading it here would make the response
      // vary per visitor and stop it being cacheable.
      const { slug } = await publish();

      const plain = await get(slug);
      const personalized = await request(server as never).get(
        `/public/i/${slug}?to=Dewi&utm_source=wa`,
      );

      expect(JSON.stringify(personalized.body)).toBe(
        JSON.stringify(plain.body),
      );
    });
  });
});
