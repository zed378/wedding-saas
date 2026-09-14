import { InMemoryStorage } from "@wi/storage";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import type { Env } from "../../src/config/env.schema";
import type { JobQueue } from "../../src/infra/queue/queue.module";
import { MediaService } from "../../src/modules/media/media.service";
import { CatalogRepository } from "../../src/modules/order/catalog.repository";
import { EntitlementsService } from "../../src/modules/order/entitlements.service";
import { PricingService } from "../../src/modules/order/pricing.service";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import {
  createTestInvitation,
  createTestOrder,
  createTestUser,
  type TestInvitation,
  type TestUser,
} from "../support/factories";
import { startHarness, type Harness } from "../support/harness";
import { rejection } from "../support/rejection";
import { resetTenantData } from "./helpers.ts";

/**
 * `P3-01` — pricing and entitlements against the real seed and a real database.
 *
 * The unit suite proves the arithmetic against a fixture. This proves the part a fixture
 * cannot: that the numbers come from the `packages` and `addons` **rows**, at request time, so
 * that changing a row changes the next price with no deploy — and that a second tier is only
 * a row.
 */

const SECOND_TIER = "p3_01_test_tier";

describe("pricing and entitlements (P3-01)", () => {
  let harness: Harness;
  let pricing: PricingService;
  let entitlements: EntitlementsService;

  beforeAll(async () => {
    harness = await startHarness();
    const catalog = new CatalogRepository(harness.db);
    pricing = new PricingService(catalog);
    entitlements = new EntitlementsService(catalog);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
  });

  afterEach(async () => {
    // Orders referencing the test tier are gone with the tenant data; then the tier itself.
    await resetTenantData(harness.pool);
    await harness.pool.query("DELETE FROM packages WHERE id = $1", [
      SECOND_TIER,
    ]);
  });

  const standard = async () => {
    const { rows } = await harness.pool.query<{
      price: string;
      duration_months: number;
      max_photos: number;
      has_watermark: boolean;
    }>(
      "SELECT price::text AS price, duration_months, max_photos, has_watermark FROM packages WHERE id = 'standard'",
    );
    return rows[0]!;
  };

  const addSecondTier = async (maxPhotos: number, isActive = true) => {
    await harness.pool.query(
      `INSERT INTO packages (id, name, price, duration_months, max_photos, has_watermark, is_active)
       VALUES ($1, 'Test tier', 4242, 3, $2, true, $3)`,
      [SECOND_TIER, maxPhotos, isActive],
    );
  };

  const invitationOf = async (): Promise<{
    user: TestUser;
    invitation: TestInvitation;
  }> => {
    const user = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, {
      owner: user,
    });
    return { user, invitation };
  };

  // ------------------------------------------------------------------------ pricing

  describe("PricingService against the seed", () => {
    it("prices standard at its row's price and duration", async () => {
      const row = await standard();
      const quote = await pricing.calculate({
        packageId: "standard",
        addonIds: [],
        orderType: "new_publish",
      });
      expect(quote.amountTotal).toBe(BigInt(row.price));
      expect(quote.durationMonths).toBe(row.duration_months);
    });

    it("prices a renewal at Rp 139,000 for another 12 months (ADR-023)", async () => {
      // The card's DoD names the figure, so the test does too — against the seeded row, which
      // is where the figure lives.
      const quote = await pricing.calculate({
        packageId: "standard",
        addonIds: [],
        orderType: "renewal",
      });
      expect(quote.amountTotal).toBe(139_000n);
      expect(quote.durationMonths).toBe(12);
    });

    it("reads the price at request time: a changed row changes the next quote", async () => {
      const original = (await standard()).price;
      try {
        await harness.pool.query(
          "UPDATE packages SET price = price + 1 WHERE id = 'standard'",
        );
        const quote = await pricing.calculate({
          packageId: "standard",
          addonIds: [],
          orderType: "new_publish",
        });
        expect(quote.amountTotal).toBe(BigInt(original) + 1n);
      } finally {
        await harness.pool.query(
          "UPDATE packages SET price = $1 WHERE id = 'standard'",
          [original],
        );
      }
    });

    it("refuses the seeded inactive addons", async () => {
      // ADR-022: `custom_domain` is not for sale until `P7-01`; `extended_validity` is redundant.
      const error = await rejection(() =>
        pricing.calculate({
          packageId: "standard",
          addonIds: ["custom_domain", "extended_validity"],
          orderType: "new_publish",
        }),
      );
      expect(error).toMatchObject({ status: 422, code: "ADDON_NOT_AVAILABLE" });
      expect(error.details).toHaveLength(2);
    });

    it("refuses an inactive package", async () => {
      await addSecondTier(10, false);
      const error = await rejection(() =>
        pricing.calculate({
          packageId: SECOND_TIER,
          addonIds: [],
          orderType: "new_publish",
        }),
      );
      expect(error).toMatchObject({
        status: 422,
        code: "PACKAGE_NOT_AVAILABLE",
      });
    });

    it("prices a second tier that is only a row", async () => {
      await addSecondTier(10);
      const quote = await pricing.calculate({
        packageId: SECOND_TIER,
        addonIds: [],
        orderType: "new_publish",
      });
      expect(quote.amountTotal).toBe(4242n);
      expect(quote.durationMonths).toBe(3);
    });
  });

  // ------------------------------------------------------------------- entitlements

  describe("EntitlementsService.forInvitation", () => {
    it("gives an invitation nobody paid for the seeded quota, watermarked", async () => {
      const { invitation } = await invitationOf();
      const row = await standard();
      expect(await entitlements.forInvitation(invitation.id)).toEqual({
        packageId: null,
        maxPhotos: row.max_photos,
        watermark: true,
        durationMonths: null,
        customDomain: false,
      });
    });

    it.each([
      ["a pending order grants nothing", "pending"],
      ["a refunded order grants nothing", "refunded"],
      ["a failed order grants nothing", "failed"],
      ["an expired order grants nothing", "expired"],
    ])("%s", async (_label, status) => {
      const { user, invitation } = await invitationOf();
      await createTestOrder(harness.pool, { invitation, user, status });
      const got = await entitlements.forInvitation(invitation.id);
      expect(got.packageId).toBeNull();
      expect(got.watermark).toBe(true);
    });

    it("a paid order grants its package", async () => {
      const { user, invitation } = await invitationOf();
      await createTestOrder(harness.pool, { invitation, user, status: "paid" });
      const row = await standard();
      expect(await entitlements.forInvitation(invitation.id)).toEqual({
        packageId: "standard",
        maxPhotos: row.max_photos,
        watermark: row.has_watermark,
        durationMonths: row.duration_months,
        customDomain: false,
      });
    });

    it("follows the latest paid order when there are several", async () => {
      await addSecondTier(7);
      const { user, invitation } = await invitationOf();
      await createTestOrder(harness.pool, {
        invitation,
        user,
        status: "paid",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      await createTestOrder(harness.pool, {
        invitation,
        user,
        status: "paid",
        packageId: SECOND_TIER,
        createdAt: new Date("2026-06-01T00:00:00Z"),
      });
      const got = await entitlements.forInvitation(invitation.id);
      expect(got.packageId).toBe(SECOND_TIER);
      expect(got.maxPhotos).toBe(7);
    });

    it("never reads another invitation's orders", async () => {
      const paid = await invitationOf();
      await createTestOrder(harness.pool, { ...paid, status: "paid" });
      const other = await invitationOf();
      expect(
        (await entitlements.forInvitation(other.invitation.id)).packageId,
      ).toBeNull();
    });

    it("lowers an unpaid draft's quota to the smallest active tier (ADR-073)", async () => {
      await addSecondTier(3);
      const { invitation } = await invitationOf();
      expect((await entitlements.forInvitation(invitation.id)).maxPhotos).toBe(
        3,
      );
    });
  });

  // ------------------------------------------------------- consumers use the entitlement

  describe("the upload quota follows the entitlement, not a constant", () => {
    const queue: JobQueue = { enqueue: async () => {}, close: async () => {} };
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    it("refuses the fourth photo for an invitation paid on a three-photo tier", async () => {
      await addSecondTier(3);
      const { user, invitation } = await invitationOf();
      await createTestOrder(harness.pool, {
        invitation,
        user,
        status: "paid",
        packageId: SECOND_TIER,
      });
      const media = new MediaService(
        new InvitationRepository(harness.db),
        new InMemoryStorage(),
        queue,
        { CDN_BASE_URL: "https://cdn.test" } as Env,
        entitlements,
      );
      const upload = () =>
        media.upload(user.scope, invitation.id, "gallery", {
          originalname: "a.jpg",
          mimetype: "image/jpeg",
          size: jpeg.length,
          buffer: jpeg,
        });

      for (let i = 0; i < 3; i += 1) await upload();
      const error = await rejection(upload);
      expect(error).toMatchObject({ status: 400, code: "QUOTA_EXCEEDED" });
      expect(error.message).toContain("3 foto");
    });
  });
});
