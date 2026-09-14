import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { payments } from "../../infra/db/schema";
import type { Transaction } from "../../shared/db/transaction";

export type PaymentRow = typeof payments.$inferSelect;

/**
 * `P3-04` — payment rows. No owner column exists on `payments`; every method here is reached with
 * an order id the order module has already proven belongs to the caller (and locked).
 */
@Injectable()
export class PaymentRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * The order's newest `pending` payment for this provider, with whether it is younger than
   * `inFlightSeconds` by the database clock.
   */
  async latestPending(
    tx: Transaction,
    orderId: string,
    provider: string,
    inFlightSeconds: number,
  ): Promise<{ payment: PaymentRow; recent: boolean } | null> {
    const [row] = await tx
      .select({
        payment: payments,
        recent: sql<boolean>`${payments.createdAt} > now() - make_interval(secs => ${inFlightSeconds})`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.orderId, orderId),
          eq(payments.provider, provider),
          eq(payments.status, "pending"),
        ),
      )
      .orderBy(desc(payments.createdAt))
      .limit(1);
    return row ?? null;
  }

  async insertPending(
    tx: Transaction,
    values: {
      readonly orderId: string;
      readonly provider: string;
      readonly providerReferenceId: string;
      readonly amount: bigint;
    },
  ): Promise<PaymentRow> {
    const rows = await tx
      .insert(payments)
      .values({ ...values, status: "pending" })
      .returning();
    return rows[0]!;
  }

  /**
   * An initiation that never produced a payment page — the provider refused, was unreachable, or the
   * request died mid-call. Only a still-`pending` row with no checkout is changed: a row the webhook
   * has already moved, or one that has a page, is never touched from here.
   */
  async markInitiationFailed(
    paymentId: string,
    tx?: Transaction,
  ): Promise<void> {
    await (tx ?? this.db)
      .update(payments)
      .set({ status: "failed", updatedAt: new Date() })
      .where(
        and(
          eq(payments.id, paymentId),
          eq(payments.status, "pending"),
          sql`${payments.checkoutUrl} IS NULL`,
        ),
      );
  }

  async storeCheckout(
    paymentId: string,
    checkout: { readonly url: string; readonly token: string },
  ): Promise<void> {
    await this.db
      .update(payments)
      .set({
        checkoutUrl: checkout.url,
        checkoutToken: checkout.token,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));
  }
}
