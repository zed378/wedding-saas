import { describe, expect, it } from "vitest";

import type {
  AddonRow,
  CatalogReader,
  PackageRow,
  PaidPurchase,
} from "../src/modules/order/catalog.repository";
import { EntitlementsService } from "../src/modules/order/entitlements.service";
import {
  PricingService,
  type OrderType,
  type PriceRequest,
} from "../src/modules/order/pricing.service";
import { rejection } from "./support/rejection";

/**
 * `P3-01` — pricing and entitlements against a fixture catalogue.
 *
 * The fixture deliberately has **two** active tiers, an inactive one and a mix of addons,
 * because the card's last DoD item is that nothing assumes exactly one package exists — and
 * the seed cannot prove that, having exactly one. Prices here are arbitrary test data.
 */

const pkg = (over: Partial<PackageRow> & { id: string }): PackageRow => ({
  name: over.id,
  price: 0n,
  durationMonths: 12,
  maxPhotos: 100,
  hasWatermark: false,
  isActive: true,
  ...over,
});

const addon = (over: Partial<AddonRow> & { id: string }): AddonRow => ({
  name: over.id,
  price: 0n,
  isActive: true,
  ...over,
});

const PACKAGES = [
  pkg({
    id: "lite",
    price: 50_500n,
    maxPhotos: 40,
    hasWatermark: true,
    durationMonths: 6,
  }),
  pkg({ id: "plus", price: 210_000n, maxPhotos: 500, durationMonths: 24 }),
  pkg({ id: "retired", price: 1n, maxPhotos: 5, isActive: false }),
];

const ADDONS = [
  addon({ id: "domain", price: 75_000n }),
  addon({ id: "music", price: 12_345n }),
  addon({ id: "print", price: 900_000n }),
  addon({ id: "dormant", price: 1n, isActive: false }),
];

function catalog(
  options: {
    packages?: PackageRow[];
    addons?: AddonRow[];
    purchase?: PaidPurchase | null;
  } = {},
): CatalogReader & { asked: string[] } {
  const packages = options.packages ?? PACKAGES;
  const addons = options.addons ?? ADDONS;
  const asked: string[] = [];
  return {
    asked,
    packageById: async (id) => packages.find((p) => p.id === id) ?? null,
    addonsByIds: async (ids) => addons.filter((a) => ids.includes(a.id)),
    activePackages: async () => packages.filter((p) => p.isActive),
    latestPaidPurchase: async (invitationId) => {
      asked.push(invitationId);
      return options.purchase ?? null;
    },
  };
}

const request = (
  packageId: string,
  addonIds: string[] = [],
  orderType: OrderType = "new_publish",
): PriceRequest => ({ packageId, addonIds, orderType });

/** Every subset of the active addons, including the empty one. */
function subsets<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>(
    (all, item) => [...all, ...all.map((set) => [...set, item])],
    [[]],
  );
}

describe("PricingService.calculate", () => {
  const service = new PricingService(catalog());
  const activeAddons = ADDONS.filter((a) => a.isActive);

  describe("every active package with every subset of active addons", () => {
    const cases = PACKAGES.filter((p) => p.isActive).flatMap((p) =>
      subsets(activeAddons).map((set) => ({ p, set })),
    );

    it.each(
      cases.map(
        ({ p, set }) =>
          [
            p.id,
            set.map((a) => a.id).join("+") || "no addons",
            p,
            set,
          ] as const,
      ),
    )("%s with %s totals the rows' prices", async (_id, _label, p, set) => {
      const quote = await service.calculate(
        request(
          p.id,
          set.map((a) => a.id),
        ),
      );

      const expected = set.reduce((sum, a) => sum + a.price, p.price);
      expect(quote.amountTotal).toBe(expected);
      expect(quote.lines.map((l) => l.id)).toEqual([
        p.id,
        ...set.map((a) => a.id),
      ]);
      expect(quote.durationMonths).toBe(p.durationMonths);
    });

    it("covers 2 packages × 8 subsets", () => {
      expect(cases).toHaveLength(16);
    });
  });

  it("ignores any amount smuggled into the input", async () => {
    // `docs/SECURITY/07` § Pricing. The request type has no amount, so a caller that forwards
    // a parsed body wholesale is the realistic way one arrives.
    const smuggled = {
      ...request("lite", ["music"]),
      amountTotal: 1n,
      amount_total: 1,
      price: 1,
      total: 1,
      lines: [{ kind: "package", id: "lite", name: "lite", price: 1n }],
    } as unknown as PriceRequest;

    const quote = await service.calculate(smuggled);

    expect(quote.amountTotal).toBe(50_500n + 12_345n);
    expect(Object.keys(quote).sort()).toEqual([
      "addonIds",
      "amountTotal",
      "durationMonths",
      "lines",
      "orderType",
      "packageId",
    ]);
  });

  it("prices a renewal exactly like a first publish", async () => {
    // `docs/PLAN/09` § Package: renewal costs the same for another period.
    for (const p of PACKAGES.filter((x) => x.isActive)) {
      const first = await service.calculate(request(p.id, [], "new_publish"));
      const renewal = await service.calculate(request(p.id, [], "renewal"));
      expect(renewal.amountTotal).toBe(first.amountTotal);
      expect(renewal.durationMonths).toBe(first.durationMonths);
      expect(renewal.orderType).toBe("renewal");
    }
  });

  it.each([
    ["an inactive package", "retired"],
    ["an unknown package", "platinum"],
    ["an empty id", ""],
  ])("refuses %s with PACKAGE_NOT_AVAILABLE", async (_label, id) => {
    const error = await rejection(() => service.calculate(request(id)));
    expect(error).toMatchObject({ status: 422, code: "PACKAGE_NOT_AVAILABLE" });
  });

  it("refuses inactive and unknown addons with one code, naming each", async () => {
    const error = await rejection(() =>
      service.calculate(request("plus", ["music", "dormant", "ghost"])),
    );
    expect(error).toMatchObject({ status: 422, code: "ADDON_NOT_AVAILABLE" });
    expect(error.details?.map((d) => d.message)).toEqual([
      "Add-on dormant tidak tersedia.",
      "Add-on ghost tidak tersedia.",
    ]);
  });

  it("refuses a repeated addon rather than charging for it twice", async () => {
    const error = await rejection(() =>
      service.calculate(request("plus", ["music", "music"])),
    );
    expect(error).toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
  });

  it("does not mutate the caller's addon list", async () => {
    const ids = ["print", "domain"];
    const quote = await service.calculate(request("plus", ids));
    expect(quote.addonIds).toEqual(["print", "domain"]);
    expect(quote.addonIds).not.toBe(ids);
  });

  it("sums in bigint, past what a double holds exactly", async () => {
    const huge = new PricingService(
      catalog({
        packages: [pkg({ id: "big", price: 9_007_199_254_740_993n })],
        addons: [addon({ id: "one", price: 2n })],
      }),
    );
    const quote = await huge.calculate(request("big", ["one"]));
    expect(quote.amountTotal).toBe(9_007_199_254_740_995n);
  });
});

describe("EntitlementsService", () => {
  const invitationId = "0b8e6a8e-6a5c-4f8e-9a51-2f6a0f9d6c11";

  it("follows the paid package, whichever tier it is", async () => {
    const plus = PACKAGES[1]!;
    const service = new EntitlementsService(
      catalog({ purchase: { package: plus, addonIds: [] } }),
    );
    expect(await service.forInvitation(invitationId)).toEqual({
      packageId: "plus",
      maxPhotos: 500,
      watermark: false,
      durationMonths: 24,
      customDomain: false,
    });
  });

  it("keeps a deactivated package's entitlements for invitations that bought it", async () => {
    const service = new EntitlementsService(
      catalog({ purchase: { package: PACKAGES[2]!, addonIds: [] } }),
    );
    expect((await service.forInvitation(invitationId)).packageId).toBe(
      "retired",
    );
  });

  it("grants a custom domain only when the paid order carried the addon", async () => {
    const service = new EntitlementsService(
      catalog({
        purchase: { package: PACKAGES[0]!, addonIds: ["custom_domain"] },
      }),
    );
    expect((await service.forInvitation(invitationId)).customDomain).toBe(true);
  });

  it("gives an unpaid invitation the smallest active quota, watermarked (ADR-073)", async () => {
    // `retired` has 5 photos but is not for sale, so it does not lower the draft's quota.
    const service = new EntitlementsService(catalog());
    expect(await service.forInvitation(invitationId)).toEqual({
      packageId: null,
      maxPhotos: 40,
      watermark: true,
      durationMonths: null,
      customDomain: false,
    });
  });

  it("does not query orders for an id that cannot be a UUID", async () => {
    const reader = catalog();
    const service = new EntitlementsService(reader);
    expect((await service.forInvitation("not-a-uuid")).packageId).toBeNull();
    expect(reader.asked).toEqual([]);
  });

  it("fails loudly when no package is active, rather than inventing a quota", async () => {
    const service = new EntitlementsService(
      catalog({ packages: [PACKAGES[2]!] }),
    );
    await expect(service.forInvitation(invitationId)).rejects.toThrow(
      /No active package/,
    );
  });
});
