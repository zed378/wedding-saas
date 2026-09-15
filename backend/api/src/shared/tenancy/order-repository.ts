import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { invitations, orders } from "../../infra/db/schema/index";
import type { Transaction } from "../db/transaction";
import type { TenantScope } from "./tenant-scope";

export type OrderRow = typeof orders.$inferSelect;

/** What the order service decides with, while the invitation row is locked. */
export interface LockedCheckout {
  readonly tx: Transaction;
  readonly invitationStatus: string;
  /** The invitation's `pending` order, if one exists. At most one can (ADR-074). */
  readonly pendingOrder: OrderRow | null;
  /** `P3-07` — the pending order is already past its `expired_at` (database clock). */
  readonly pendingOverdue: boolean;
}

export interface NewOrder {
  readonly invitationId: string;
  readonly packageId: string;
  readonly addonIds: readonly string[];
  /** From `PricingService`. Never from a request. */
  readonly amountTotal: bigint;
  readonly orderType: "new_publish" | "renewal";
  /** `docs/PLAN/09`: the payment window. */
  readonly paymentWindowHours: number;
}

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/**
 * `P3-02` — orders, reached through their owner.
 *
 * In the tenancy layer because order creation locks an **invitation** row, and
 * `scripts/check-tenant-scope.mjs` allows that table only here. The lock is the ownership check
 * and the concurrency control at once: `WHERE id = :id AND owner_id = :scope … FOR UPDATE`
 * returns nothing for somebody else's invitation, and serialises two checkouts of your own.
 */
@Injectable()
export class OrderRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Run `work` in one transaction holding the caller's invitation row locked, with the pending
   * order read **after** the lock — so a checkout that waited for another to commit sees the
   * order that one created.
   *
   * `null` when the invitation is not the caller's, is deleted, or does not exist.
   */
  async withLockedInvitation<R>(
    invitationId: string,
    scope: TenantScope,
    work: (checkout: LockedCheckout) => Promise<R>,
  ): Promise<R | null> {
    return this.db.transaction(async (tx) => {
      const [invitation] = await tx
        .select({ status: invitations.status })
        .from(invitations)
        .where(
          and(
            eq(invitations.id, invitationId),
            eq(invitations.ownerId, scope),
            isNull(invitations.deletedAt),
          ),
        )
        .for("update")
        .limit(1);

      if (invitation === undefined) return null;

      const [pending] = await tx
        .select({
          order: orders,
          overdue: sql<boolean>`${orders.expiredAt} <= now()`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.invitationId, invitationId),
            eq(orders.status, "pending"),
          ),
        )
        .limit(1);

      return work({
        tx,
        invitationStatus: invitation.status,
        pendingOrder: pending?.order ?? null,
        pendingOverdue: pending?.overdue ?? false,
      });
    });
  }

  /**
   * Insert a `pending` order. `"conflict"` if the partial unique index refuses it.
   *
   * `user_id` is the scope, and `expired_at` is computed by the database clock, so no part of an
   * order's identity or deadline comes from the request.
   *
   * The conflict cannot happen through `withLockedInvitation` — the lock and the pending read
   * precede it. It is handled anyway, because the index exists for the paths that do not take
   * the lock, and turning its error into an opaque 500 would waste it. The transaction is aborted
   * by the violation, so the caller must throw, not continue.
   */
  async insertPendingOrder(
    tx: Transaction,
    scope: TenantScope,
    order: NewOrder,
  ): Promise<OrderRow | "conflict"> {
    try {
      const rows = await tx
        .insert(orders)
        .values({
          invitationId: order.invitationId,
          userId: scope,
          packageId: order.packageId,
          addonIds: [...order.addonIds],
          amountTotal: order.amountTotal,
          status: "pending",
          orderType: order.orderType,
          expiredAt: sql`now() + make_interval(hours => ${order.paymentWindowHours})`,
        })
        .returning();
      return rows[0]!;
    } catch (error) {
      if (isUniqueViolation(error)) return "conflict";
      throw error;
    }
  }

  /**
   * `P3-04` — run `work` in a short transaction holding one of the caller's orders locked.
   *
   * `stillOpen` is `expired_at > now()` by the **database** clock, the same clock that set the
   * deadline. `null` when the order is not the caller's or does not exist.
   */
  async withLockedOwnedOrder<R>(
    orderId: string,
    scope: TenantScope,
    work: (locked: {
      readonly tx: Transaction;
      readonly order: OrderRow;
      readonly stillOpen: boolean;
    }) => Promise<R>,
  ): Promise<R | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          order: orders,
          stillOpen: sql<boolean>`${orders.expiredAt} > now()`,
        })
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.userId, scope)))
        .for("update")
        .limit(1);
      if (row === undefined) return null;
      return work({ tx, order: row.order, stillOpen: row.stillOpen });
    });
  }

  /**
   * `P3-05` — the order a **verified** payment notification settles, locked, with no owner filter.
   *
   * The one unscoped order read, and deliberately so: a provider notification has no user. It is safe
   * because the id comes only from a `payments` row that a signature-verified notification matched —
   * never from a request — which is why it takes a transaction rather than a scope and lives next to
   * this paragraph.
   */
  async lockForSettlement(
    tx: Transaction,
    orderId: string,
  ): Promise<OrderRow | null> {
    const [row] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update")
      .limit(1);
    return row ?? null;
  }

  /** `P3-07` — one transaction for the expiry sweep's per-order work. */
  async transaction<R>(work: (tx: Transaction) => Promise<R>): Promise<R> {
    return this.db.transaction(work);
  }

  /** `P3-07` — ids of pending orders past their deadline, oldest first. Unlocked: a candidate list. */
  async overdueOrderIds(limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(eq(orders.status, "pending"), sql`${orders.expiredAt} <= now()`),
      )
      .orderBy(orders.expiredAt)
      .limit(limit);
    return rows.map((row) => row.id);
  }

  /**
   * `P3-07` — lock an order only if it is still pending and overdue, **skipping it if another
   * transaction holds it**. A webhook settling this order right now holds that lock; waiting would
   * risk a deadlock against callers that lock in the other order, and there is nothing to gain — the
   * next sweep, or the payment, decides it. System path: no owner filter (spec § 6).
   */
  async lockOverdueOrder(
    tx: Transaction,
    orderId: string,
  ): Promise<OrderRow | null> {
    const [row] = await tx
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.status, "pending"),
          sql`${orders.expiredAt} <= now()`,
        ),
      )
      .for("update", { skipLocked: true })
      .limit(1);
    return row ?? null;
  }

  /** Conditional: only from `from`. Returns whether a row changed. */
  async setOrderStatus(
    tx: Transaction,
    orderId: string,
    from: string,
    to: string,
  ): Promise<boolean> {
    const rows = await tx
      .update(orders)
      .set({ status: to, updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.status, from)))
      .returning({ id: orders.id });
    return rows.length === 1;
  }

  /** One of the caller's orders, or `null`. `user_id` in the `WHERE`, never checked after. */
  async findOwnedOrder(
    orderId: string,
    scope: TenantScope,
  ): Promise<OrderRow | null> {
    const rows = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, scope)))
      .limit(1);
    return rows[0] ?? null;
  }
}

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps the driver error; the code is on it or on its cause.
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  return candidates.some(
    (candidate) =>
      (candidate as { code?: unknown } | null)?.code === UNIQUE_VIOLATION,
  );
}
