import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { addons, orders, packages } from "../../infra/db/schema";
import type { Transaction } from "../../shared/db/transaction";

export type PackageRow = typeof packages.$inferSelect;
export type AddonRow = typeof addons.$inferSelect;

/** The paid order an invitation's entitlements come from, with its package. */
export interface PaidPurchase {
  readonly package: PackageRow;
  readonly addonIds: readonly string[];
}

/**
 * `P3-01` — the reads behind pricing and entitlements.
 *
 * An interface as well as a class so the services can be unit-tested against a fixture
 * catalogue with more than one tier: the rule "nothing assumes exactly one package" is
 * easiest to prove with a catalogue the seed does not have.
 */
export interface CatalogReader {
  packageById(id: string): Promise<PackageRow | null>;
  addonsByIds(ids: readonly string[]): Promise<AddonRow[]>;
  activePackages(): Promise<PackageRow[]>;
  latestPaidPurchase(invitationId: string): Promise<PaidPurchase | null>;
}

@Injectable()
export class CatalogRepository implements CatalogReader {
  constructor(@Inject(DB) private readonly db: Database | Transaction) {}

  /** The same reads on a transaction's connection (`P3-02`; see `PricingService.calculate`). */
  static within(tx: Transaction): CatalogReader {
    return new CatalogRepository(tx);
  }

  async packageById(id: string): Promise<PackageRow | null> {
    const rows = await this.db
      .select()
      .from(packages)
      .where(eq(packages.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async addonsByIds(ids: readonly string[]): Promise<AddonRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(addons)
      .where(inArray(addons.id, [...ids]));
  }

  async activePackages(): Promise<PackageRow[]> {
    return this.db
      .select()
      .from(packages)
      .where(eq(packages.isActive, true))
      .orderBy(asc(packages.price), asc(packages.id));
  }

  /**
   * The most recent order with `status = 'paid'`, and nothing else counts.
   *
   * `pending` is somebody who opened a payment page — counting it would hand out the product
   * for starting a checkout. `refunded` is BR-5.4: a refund reverses the entitlement, not
   * only the money. `failed` and `expired` never paid.
   *
   * **Not owner-scoped**, and deliberately so: this returns an entitlement, never order data,
   * and every caller has authorized the invitation already or is serving it publicly
   * (`MEMORY/specs/P3-01-pricing-and-entitlements.md` § 6). `orders` is not one of the tables
   * `scripts/check-tenant-scope.mjs` guards.
   */
  async latestPaidPurchase(invitationId: string): Promise<PaidPurchase | null> {
    const rows = await this.db
      .select({ package: packages, addonIds: orders.addonIds })
      .from(orders)
      .innerJoin(packages, eq(orders.packageId, packages.id))
      .where(
        and(eq(orders.invitationId, invitationId), eq(orders.status, "paid")),
      )
      .orderBy(desc(orders.createdAt))
      .limit(1);
    const row = rows[0];
    return row === undefined
      ? null
      : { package: row.package, addonIds: row.addonIds };
  }
}
