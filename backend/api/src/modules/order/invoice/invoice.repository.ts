import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, lt } from "drizzle-orm";

import { DB, type Database } from "../../../infra/db/client";
import {
  addons,
  invoices,
  orders,
  packages,
  payments,
  users,
} from "../../../infra/db/schema";

export type InvoiceRow = typeof invoices.$inferSelect;

/** Everything an invoice is rendered from, for one paid order. */
export interface InvoiceSource {
  readonly orderId: string;
  readonly orderStatus: string;
  readonly orderType: string;
  readonly amountTotal: bigint;
  readonly packageName: string;
  readonly addonNames: readonly string[];
  readonly buyerName: string;
  readonly buyerEmail: string;
  readonly paidAt: Date | null;
  readonly paymentMethod: string | null;
  /**
   * Whether an EARLIER order for the same invitation was paid. `P3-02` types a BR-2.8 trial's first
   * payment as `renewal` (its status is `published`/`expired`), but for the customer it is their first
   * purchase — the invoice says "renewal" only when there was something to renew.
   */
  readonly renewsEarlierPurchase: boolean;
}

/**
 * `P3-08` — invoice rows and the data behind them.
 *
 * No method here has an owner filter. Each is reached from a paid order's id: by the jobs process after a
 * verified payment, or by `InvoiceService.ownedInvoice` only after `OrderRepository.findOwnedOrder` (with
 * `user_id` in its `WHERE`) found the order.
 */
@Injectable()
export class InvoiceRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async source(orderId: string): Promise<InvoiceSource | null> {
    const [row] = await this.db
      .select({
        order: orders,
        packageName: packages.name,
        buyerName: users.fullName,
        buyerEmail: users.email,
      })
      .from(orders)
      .innerJoin(packages, eq(orders.packageId, packages.id))
      .innerJoin(users, eq(orders.userId, users.id))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (row === undefined) return null;

    const [paid] = await this.db
      .select({ verifiedAt: payments.verifiedAt, method: payments.method })
      .from(payments)
      .where(and(eq(payments.orderId, orderId), eq(payments.status, "success")))
      .orderBy(desc(payments.verifiedAt))
      .limit(1);

    const [earlier] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.invitationId, row.order.invitationId),
          inArray(orders.status, ["paid", "refunded"]),
          lt(orders.createdAt, row.order.createdAt),
        ),
      )
      .limit(1);

    const addonRows =
      row.order.addonIds.length === 0
        ? []
        : await this.db
            .select({ id: addons.id, name: addons.name })
            .from(addons)
            .where(inArray(addons.id, [...row.order.addonIds]));
    const names = new Map(addonRows.map((a) => [a.id, a.name]));

    return {
      orderId: row.order.id,
      orderStatus: row.order.status,
      orderType: row.order.orderType,
      amountTotal: row.order.amountTotal,
      packageName: row.packageName,
      addonNames: row.order.addonIds.map((id) => names.get(id) ?? id),
      buyerName: row.buyerName,
      buyerEmail: row.buyerEmail,
      paidAt: paid?.verifiedAt ?? null,
      paymentMethod: paid?.method ?? null,
      renewsEarlierPurchase: earlier !== undefined,
    };
  }

  /** Insert once. A second generation of the same invoice is a no-op, never an overwrite. */
  async insertOnce(values: {
    readonly orderId: string;
    readonly number: string;
    readonly pdf: Buffer;
  }): Promise<void> {
    await this.db.insert(invoices).values(values).onConflictDoNothing();
  }

  async findByOrder(orderId: string): Promise<InvoiceRow | null> {
    const [row] = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.orderId, orderId))
      .limit(1);
    return row ?? null;
  }
}
