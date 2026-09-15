import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { paymentNotifications, payments } from "../../infra/db/schema";
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

  // ------------------------------------------------------------------ P3-05 webhook

  /** One transaction for everything a webhook changes, so it commits together or not at all. */
  async transaction<R>(work: (tx: Transaction) => Promise<R>): Promise<R> {
    return this.db.transaction(work);
  }

  /** Record an arrival. Its own statement: it survives a processing failure that rolls back. */
  async recordNotification(values: {
    readonly source: "webhook" | "query" | "reconciliation";
    readonly provider: string;
    readonly claimedReference: string | null;
    readonly signatureValid: boolean;
    readonly rejectionReason?: string;
    readonly outcome?: string;
    readonly providerStatus?: string;
    readonly amount?: bigint;
    readonly rawPayload: unknown;
  }): Promise<string> {
    const rows = await this.db
      .insert(paymentNotifications)
      .values({
        source: values.source,
        provider: values.provider,
        claimedReference: values.claimedReference,
        signatureValid: values.signatureValid,
        rejectionReason: values.rejectionReason ?? null,
        outcome: values.outcome ?? null,
        providerStatus: values.providerStatus ?? null,
        amount: values.amount ?? null,
        rawPayload: values.rawPayload ?? null,
      })
      .returning({ id: paymentNotifications.id });
    return rows[0]!.id;
  }

  /** `P3-06` — reconciliation marks a routine-looking outcome for review. */
  async flagForReview(notificationId: string): Promise<void> {
    await this.db
      .update(paymentNotifications)
      .set({ needsReview: true })
      .where(eq(paymentNotifications.id, notificationId));
  }

  async completeNotification(
    tx: Transaction,
    notificationId: string,
    values: {
      readonly paymentId: string | null;
      readonly result: string;
      readonly needsReview: boolean;
    },
  ): Promise<void> {
    await tx
      .update(paymentNotifications)
      .set({
        paymentId: values.paymentId,
        result: values.result,
        needsReview: values.needsReview,
        processedAt: new Date(),
      })
      .where(eq(paymentNotifications.id, notificationId));
  }

  /**
   * The payment a verified notification names, locked. The unique `(provider, provider_reference_id)`
   * index guarantees at most one; the lock makes concurrent deliveries of one notification run one
   * after another.
   */
  async lockByReference(
    tx: Transaction,
    provider: string,
    providerReferenceId: string,
  ): Promise<PaymentRow | null> {
    const [row] = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.provider, provider),
          eq(payments.providerReferenceId, providerReferenceId),
        ),
      )
      .for("update")
      .limit(1);
    return row ?? null;
  }

  /** From a verified notification only. Never from `success` (idempotency), never to anything else. */
  async recordVerifiedOutcome(
    tx: Transaction,
    paymentId: string,
    values: {
      readonly status: "success" | "failed";
      readonly method: string | null;
      readonly rawPayload: unknown;
    },
  ): Promise<boolean> {
    const rows = await tx
      .update(payments)
      .set({
        status: values.status,
        method: values.method,
        rawCallbackPayload: values.rawPayload,
        signatureValid: true,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(payments.id, paymentId), ne(payments.status, "success")))
      .returning({ id: payments.id });
    return rows.length === 1;
  }

  async recordMethod(
    tx: Transaction,
    paymentId: string,
    method: string,
  ): Promise<void> {
    await tx
      .update(payments)
      .set({ method, updatedAt: new Date() })
      .where(eq(payments.id, paymentId));
  }

  /** Whether the order has a `pending` or `success` payment other than this one. */
  async hasOtherLivePayment(
    tx: Transaction,
    orderId: string,
    exceptPaymentId: string,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.orderId, orderId),
          ne(payments.id, exceptPaymentId),
          inArray(payments.status, ["pending", "success"]),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  // ------------------------------------------------------------------ P3-06 status

  /**
   * The order's most relevant payment for display: a `success` if one exists, otherwise the newest.
   * `stale` is whether a still-pending one is older than `staleSeconds` by the database clock.
   */
  async displayPayment(
    orderId: string,
    staleSeconds: number,
  ): Promise<{ payment: PaymentRow; stale: boolean } | null> {
    const [row] = await this.db
      .select({
        payment: payments,
        stale: sql<boolean>`${payments.createdAt} < now() - make_interval(secs => ${staleSeconds})`,
      })
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .orderBy(
        sql`CASE WHEN ${payments.status} = 'success' THEN 0 ELSE 1 END`,
        desc(payments.createdAt),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * `P3-06` — payments reconciliation re-checks with the provider: still `pending` between
   * `minPendingAgeMinutes` and `lookbackHours` old (a webhook may never have come), and `success`
   * verified within `lookbackHours` (the provider may not agree).
   */
  async reconciliationCandidates(
    provider: string,
    options: {
      readonly minPendingAgeMinutes: number;
      readonly lookbackHours: number;
      readonly limit: number;
    },
  ): Promise<PaymentRow[]> {
    return this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.provider, provider),
          sql`(
            (${payments.status} = 'pending'
              AND ${payments.createdAt} < now() - make_interval(mins => ${options.minPendingAgeMinutes})
              AND ${payments.createdAt} > now() - make_interval(hours => ${options.lookbackHours}))
            OR
            (${payments.status} = 'success'
              AND ${payments.verifiedAt} > now() - make_interval(hours => ${options.lookbackHours}))
          )`,
        ),
      )
      .orderBy(payments.createdAt)
      .limit(options.limit);
  }

  /** A reconciliation finding that changes nothing but needs a person. */
  async recordReconciliationFinding(values: {
    readonly provider: string;
    readonly payment: PaymentRow;
    readonly result: string;
    readonly providerStatus: string | null;
    readonly outcome: string | null;
    readonly amount: bigint | null;
    readonly rawPayload: unknown;
  }): Promise<void> {
    await this.db.insert(paymentNotifications).values({
      source: "reconciliation",
      provider: values.provider,
      claimedReference: values.payment.providerReferenceId,
      paymentId: values.payment.id,
      signatureValid: true,
      outcome: values.outcome,
      providerStatus: values.providerStatus,
      amount: values.amount,
      result: values.result,
      needsReview: true,
      rawPayload: values.rawPayload ?? null,
      processedAt: new Date(),
    });
  }
}
