import { Inject, Injectable } from "@nestjs/common";

import { BusinessRuleError, ValidationError } from "../../http/errors";
import { CATALOG, type CatalogReader } from "./catalog.token";

export type OrderType = "new_publish" | "renewal";

/**
 * Everything a price can depend on. **There is no amount here**, and that is the control:
 * `docs/SECURITY/07` § Pricing forbids taking a price from the client, and a field that does
 * not exist cannot be trusted by mistake.
 */
export interface PriceRequest {
  readonly packageId: string;
  readonly addonIds: readonly string[];
  readonly orderType: OrderType;
}

export interface PriceLine {
  readonly kind: "package" | "addon";
  readonly id: string;
  readonly name: string;
  /** Rupiah. */
  readonly price: bigint;
}

export interface PriceQuote {
  readonly packageId: string;
  readonly addonIds: readonly string[];
  readonly orderType: OrderType;
  readonly lines: readonly PriceLine[];
  /** Rupiah, the sum of `lines`. What `P3-02` snapshots into `orders.amount_total`. */
  readonly amountTotal: bigint;
  /** How long the purchase keeps the invitation live. */
  readonly durationMonths: number;
}

/**
 * `P3-01` — the one place an order's amount is computed. `docs/SECURITY/07` § Pricing,
 * `docs/DATABASE/07`, `docs/PLAN/09`.
 *
 * ## Read at request time, every time
 *
 * No cache. A price change in `packages` must take effect on the next order, and a cache
 * that outlived it would charge yesterday's price — in either direction. The cost is one
 * primary-key read per checkout.
 *
 * ## No price in code
 *
 * Not a default, not a fallback, not a constant for tests. `scripts/check-price-literals.mjs`
 * refuses the seeded prices anywhere in application code, so the database stays the only
 * place a price can come from (`docs/PLAN/09` § Package).
 *
 * ## Renewal
 *
 * `orderType` is part of the request so a renewal is priced by the same code path as a first
 * publish. Today they cost the same (`docs/PLAN/09` § Package: *"Renewal costs the same"*), and
 * the tests prove it; a future renewal price is a change in this one function.
 */
@Injectable()
export class PricingService {
  constructor(@Inject(CATALOG) private readonly catalog: CatalogReader) {}

  /**
   * `catalog` defaults to the pooled reader. `P3-02` passes one bound to its transaction: pricing
   * on a second pooled connection while the order transaction holds the first starved the pool
   * under ten concurrent checkouts, each waiting for a connection another was holding.
   */
  async calculate(
    request: PriceRequest,
    catalog: CatalogReader = this.catalog,
  ): Promise<PriceQuote> {
    // Copied field by field: whatever else the caller's object carries — an `amountTotal`,
    // an `amount_total`, a `price` — never reaches anything below this line.
    const packageId = request.packageId;
    const addonIds = [...request.addonIds];
    const orderType = request.orderType;

    const repeated = addonIds.filter((id, i) => addonIds.indexOf(id) !== i);
    if (repeated.length > 0) {
      throw new ValidationError(
        [...new Set(repeated)].map((id) => ({
          field: "addon_ids",
          message: `Add-on ${id} dipilih lebih dari sekali.`,
        })),
        "Setiap add-on hanya bisa dipilih satu kali.",
      );
    }

    const pkg = await catalog.packageById(packageId);
    if (pkg === null || !pkg.isActive) {
      // Unknown and inactive are one answer: neither gives the client anything to act on
      // except choosing a package that is for sale.
      throw new BusinessRuleError(
        "PACKAGE_NOT_AVAILABLE",
        "Paket yang dipilih tidak tersedia.",
        [{ field: "package_id", message: "Paket tidak tersedia." }],
      );
    }

    const found = await catalog.addonsByIds(addonIds);
    const byId = new Map(found.map((addon) => [addon.id, addon]));
    const unavailable = addonIds.filter(
      (id) => byId.get(id)?.isActive !== true,
    );
    if (unavailable.length > 0) {
      // ADR-022: `custom_domain` is seeded inactive until `P7-01` ships the feature. Selling it
      // first would take money for something that does not exist.
      throw new BusinessRuleError(
        "ADDON_NOT_AVAILABLE",
        "Add-on yang dipilih tidak tersedia.",
        unavailable.map((id) => ({
          field: "addon_ids",
          message: `Add-on ${id} tidak tersedia.`,
        })),
      );
    }

    const lines: PriceLine[] = [
      { kind: "package", id: pkg.id, name: pkg.name, price: pkg.price },
      ...addonIds.map((id) => {
        const addon = byId.get(id)!;
        return {
          kind: "addon" as const,
          id: addon.id,
          name: addon.name,
          price: addon.price,
        };
      }),
    ];

    return {
      packageId: pkg.id,
      addonIds,
      orderType,
      lines,
      amountTotal: lines.reduce((sum, line) => sum + line.price, 0n),
      durationMonths: pkg.durationMonths,
    };
  }
}
