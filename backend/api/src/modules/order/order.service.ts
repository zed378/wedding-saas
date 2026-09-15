import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { CACHE, type CachePort } from "../../infra/cache/cache.port";
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from "../../http/errors";
import { InvitationStatusService } from "../../shared/invitation-status/invitation-status.service";
import { logger } from "../../shared/logging/logger";
import { metrics } from "../../shared/metrics/metrics";
import {
  OrderRepository,
  type OrderRow,
} from "../../shared/tenancy/order-repository";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import type { Transaction } from "../../shared/db/transaction";
import { requireVerifiedEmail } from "../auth/require-verified-email";
import { CatalogRepository } from "./catalog.repository";
import { PricingService, type OrderType } from "./pricing.service";

/** `docs/PLAN/09` § Order Flow: `expired_at = now + 24h`. */
export const PAYMENT_WINDOW_HOURS = 24;

/** How long a replayed `Idempotency-Key` returns the same order. The payment window. */
const IDEMPOTENCY_TTL_SECONDS = PAYMENT_WINDOW_HOURS * 60 * 60;
const IDEMPOTENCY_NAMESPACE = "idem:orders";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SettlementResult =
  | "applied"
  | "late_payment"
  | "duplicate_charge"
  | "refunded_order"
  | "applied_entitlement_skipped";

export interface Settlement {
  readonly result: SettlementResult;
  /** Whether THIS call moved the order to `paid` — the only case that emits `order.paid`. */
  readonly becamePaid: boolean;
  readonly needsReview: boolean;
}

export interface CheckoutUser {
  readonly scope: TenantScope;
  readonly emailVerified: boolean;
}

export interface CreateOrderInput {
  readonly packageId: string;
  readonly addonIds: readonly string[];
  readonly idempotencyKey?: string | undefined;
}

/** `docs/API/06` § Example Response, plus `order_type`. */
export interface OrderDto {
  readonly id: string;
  readonly invitation_id: string;
  readonly package_id: string;
  readonly addons: readonly string[];
  readonly amount_total: number;
  readonly order_type: string;
  readonly status: string;
  readonly expired_at: string;
}

interface IdempotencyRecord {
  readonly orderId: string;
  readonly fingerprint: string;
}

/**
 * `P3-02` — `POST /invitations/:id/orders`. `MEMORY/specs/P3-02-order-creation.md`.
 *
 * ## One pending order, three ways
 *
 * 1. **The invitation row is locked** (`OrderRepository.withLockedInvitation`), so two
 *    checkouts of one invitation run one after the other, and the second reads the first's
 *    order after it commits. That is what turns a double click into one order and one 409.
 * 2. **The service checks** for a pending order under that lock and answers
 *    `ACTIVE_ORDER_EXISTS` with the order's id, so the client can resume it (`docs/API/06`).
 * 3. **A partial unique index** refuses a second pending order from any path that skips 1 and 2
 *    (ADR-074).
 *
 * ## The status moves with the order
 *
 * ADR-022: `draft → pending_payment` happens in the order's transaction, through the status
 * service, so an order never exists beside an invitation that still says `draft`.
 *
 * ## Idempotency
 *
 * `docs/API/00`: an optional `Idempotency-Key`. The record — order id plus a fingerprint of what
 * was asked for — is written **while the lock is held**, before commit, so a concurrent replay
 * waiting on the lock finds it. A record pointing at an order that never committed is ignored.
 * If Redis is down the replay gets the 409 naming the same order instead: degraded, never
 * duplicated.
 */
@Injectable()
export class OrderService {
  constructor(
    private readonly repository: OrderRepository,
    private readonly pricing: PricingService,
    private readonly status: InvitationStatusService,
    @Inject(CACHE) private readonly cache: CachePort,
  ) {}

  async create(
    user: CheckoutUser,
    invitationId: string,
    input: CreateOrderInput,
  ): Promise<OrderDto> {
    // A property of the caller, so it is decided before anything about the invitation is read:
    // it reveals nothing about whose invitation this is (`docs/API/00` § 403 vs 404).
    requireVerifiedEmail(user);

    // A path segment that cannot be a UUID names no invitation. Answered here, as the same 404,
    // rather than sent to Postgres to fail as a cast error.
    if (!UUID.test(invitationId)) throw new NotFoundError();

    const fingerprint = fingerprintOf(invitationId, input);
    const cacheKey =
      input.idempotencyKey === undefined
        ? undefined
        : `${user.scope}:${sha256(input.idempotencyKey)}`;

    if (cacheKey !== undefined) {
      const replayed = await this.replay(user.scope, cacheKey, fingerprint);
      if (replayed !== undefined) return toDto(replayed);
    }

    const created = await this.repository.withLockedInvitation(
      invitationId,
      user.scope,
      async ({
        tx,
        invitationStatus: statusAtLock,
        pendingOrder,
        pendingOverdue,
      }) => {
        let invitationStatus = statusAtLock;

        // `P3-07`: an order past its deadline can no longer be paid; it must not block a new checkout
        // for up to fifteen minutes waiting for the sweep. Expire it here, through the sweep's code.
        if (pendingOrder !== null && pendingOverdue) {
          const expired = await this.expireIfOverdue(tx, pendingOrder.id);
          if (expired === null) throw activeOrderExists(pendingOrder.id);
          if (expired.invitationStatus !== null) {
            invitationStatus = expired.invitationStatus;
          }
        } else if (pendingOrder !== null) {
          // A replay that waited on the lock for the request that created this order.
          if (cacheKey !== undefined) {
            const record = await this.cache.getJson<IdempotencyRecord>(
              IDEMPOTENCY_NAMESPACE,
              cacheKey,
            );
            if (
              record?.orderId === pendingOrder.id &&
              record.fingerprint === fingerprint
            ) {
              return { order: pendingOrder, replay: true };
            }
          }
          throw activeOrderExists(pendingOrder.id);
        }

        const plan = planFor(invitationStatus);

        // On this transaction's connection, not a second one from the pool (see `calculate`).
        const quote = await this.pricing.calculate(
          {
            packageId: input.packageId,
            addonIds: input.addonIds,
            orderType: plan.orderType,
          },
          CatalogRepository.within(tx),
        );

        const order = await this.repository.insertPendingOrder(tx, user.scope, {
          invitationId,
          packageId: quote.packageId,
          addonIds: quote.addonIds,
          // `docs/SECURITY/07` § Pricing: the quote, and nothing else.
          amountTotal: quote.amountTotal,
          orderType: plan.orderType,
          paymentWindowHours: PAYMENT_WINDOW_HOURS,
        });
        if (order === "conflict") throw activeOrderExists();

        if (plan.transition) {
          // BR-2.2, ADR-022 — inside this transaction.
          await this.status.transitionWithin(
            tx,
            invitationId,
            "pending_payment",
            { kind: "USER", userId: user.scope },
          );
        }

        if (cacheKey !== undefined) {
          await this.cache.setJson(
            IDEMPOTENCY_NAMESPACE,
            cacheKey,
            { orderId: order.id, fingerprint } satisfies IdempotencyRecord,
            IDEMPOTENCY_TTL_SECONDS,
          );
        }

        return { order, replay: false };
      },
    );

    if (created === null) throw new NotFoundError();

    if (!created.replay) {
      logger.info(
        {
          context: {
            event: "order.created",
            order_id: created.order.id,
            invitation_id: invitationId,
            user_id: user.scope,
            order_type: created.order.orderType,
            amount_total: created.order.amountTotal.toString(),
          },
        },
        "order created",
      );
    }

    return toDto(created.order);
  }

  /**
   * `P3-04` — the order module's answer to "may this order be paid now", for the payment module.
   *
   * `docs/BACKEND/01`: payment reaches orders through this service, never through the table. The
   * order is locked for the duration of `work`, which must be short and must not call the provider
   * (`PaymentService.initiate` commits before it does).
   *
   * 404 for somebody else's, nonexistent or malformed id; 422 `ORDER_NOT_PAYABLE` unless `pending`
   * and before `expired_at` (`docs/BACKEND/05` § Payment Initiation).
   */
  async withPayableOrder<R>(
    scope: TenantScope,
    orderId: string,
    work: (payable: {
      readonly tx: Transaction;
      readonly orderId: string;
      readonly amountTotal: bigint;
      readonly expiredAt: Date;
    }) => Promise<R>,
  ): Promise<R> {
    if (!UUID.test(orderId)) throw new NotFoundError();

    const result = await this.repository.withLockedOwnedOrder(
      orderId,
      scope,
      async ({ tx, order, stillOpen }) => {
        if (order.status !== "pending" || !stillOpen) {
          throw new BusinessRuleError(
            "ORDER_NOT_PAYABLE",
            order.status === "paid"
              ? "Pesanan ini sudah dibayar."
              : "Pesanan ini sudah tidak bisa dibayar. Buat pesanan baru untuk melanjutkan.",
          );
        }
        return {
          value: await work({
            tx,
            orderId: order.id,
            amountTotal: order.amountTotal,
            expiredAt: order.expiredAt,
          }),
        };
      },
    );
    if (result === null) throw new NotFoundError();
    return result.value;
  }

  /**
   * `P3-05` — apply a verified payment success to its order, inside the webhook's transaction.
   * `MEMORY/specs/P3-05-payment-webhook.md` § 8.
   *
   * The only caller is `PaymentWebhookService`, after the gateway verified the notification and the
   * payment row matched. SYSTEM actor: `docs/PLAN/06` allows `pending_payment → paid` only here.
   */
  async settlePaid(tx: Transaction, orderId: string): Promise<Settlement> {
    const order = await this.repository.lockForSettlement(tx, orderId);
    if (order === null)
      throw new Error(`payment references missing order ${orderId}`);

    let result: SettlementResult;
    switch (order.status) {
      case "pending":
        result = "applied";
        break;
      case "expired":
      case "failed":
        // `docs/SECURITY/07` § Timeout & Expiry: processed as valid, flagged for review.
        result = "late_payment";
        break;
      case "paid":
        // A second payment for one order. The product was granted once; the money needs a human.
        return {
          result: "duplicate_charge",
          becamePaid: false,
          needsReview: true,
        };
      default:
        return {
          result: "refunded_order",
          becamePaid: false,
          needsReview: true,
        };
    }

    const changed = await this.repository.setOrderStatus(
      tx,
      order.id,
      order.status,
      "paid",
    );
    if (!changed) throw new Error(`order ${order.id} changed under its lock`);

    let needsReview = result === "late_payment";
    if (order.orderType === "new_publish") {
      try {
        await this.status.transitionWithin(
          tx,
          order.invitationId,
          "paid",
          { kind: "SYSTEM", userId: null },
          result === "late_payment"
            ? "payment webhook: late payment confirmed after the order expired (review)"
            : "payment webhook confirmed",
        );
      } catch (error) {
        if (
          !(error instanceof BusinessRuleError) ||
          error.code !== "INVALID_STATUS_TRANSITION"
        ) {
          throw error;
        }
        // The invitation is somewhere the machine does not allow `paid` from (deleted, or already
        // published). The order is paid and the money is real; a human decides the rest.
        result = "applied_entitlement_skipped";
        needsReview = true;
      }
    }
    // `renewal`: extending `expiry_date` and `expired → published` belong to `P3-13`, which reads paid
    // renewal orders. Nothing about the invitation changes here.

    return { result, becamePaid: true, needsReview };
  }

  /**
   * `P3-05` — BR-5.3: a failed payment leaves the order `failed` and the invitation `draft`. Called only
   * when the order has no other pending or successful payment.
   */
  async settleFailed(tx: Transaction, orderId: string): Promise<boolean> {
    const order = await this.repository.lockForSettlement(tx, orderId);
    if (order === null || order.status !== "pending") return false;
    await this.repository.setOrderStatus(tx, order.id, "pending", "failed");
    if (order.orderType === "new_publish") {
      try {
        await this.status.transitionWithin(
          tx,
          order.invitationId,
          "draft",
          { kind: "SYSTEM", userId: null },
          "payment webhook: payment failed",
        );
      } catch (error) {
        if (
          !(error instanceof BusinessRuleError) ||
          error.code !== "INVALID_STATUS_TRANSITION"
        ) {
          throw error;
        }
      }
    }
    return true;
  }

  /**
   * `P3-06` — one of the caller's orders, for the payment status endpoint. Read only. 404 for
   * somebody else's, nonexistent or malformed id.
   */
  async ownedOrderStatus(
    scope: TenantScope,
    orderId: string,
  ): Promise<{ readonly id: string; readonly status: string }> {
    if (!UUID.test(orderId)) throw new NotFoundError();
    const order = await this.repository.findOwnedOrder(orderId, scope);
    if (order === null) throw new NotFoundError();
    return { id: order.id, status: order.status };
  }

  /**
   * `P3-07` — `order_expire_check`, every 15 minutes (`docs/BACKEND/08`). `MEMORY/specs/P3-07-order-expiry.md`.
   *
   * Each overdue order in its own short transaction. Idempotent by construction: only a still-pending,
   * still-overdue order is touched, so a second run — or two at once — changes nothing more.
   */
  async expireOverdueOrders(
    limit = 500,
  ): Promise<{ expired: number; skipped: number }> {
    const ids = await this.repository.overdueOrderIds(limit);
    let expired = 0;
    for (const id of ids) {
      const done = await this.repository.transaction((tx) =>
        this.expireIfOverdue(tx, id),
      );
      if (done !== null) expired += 1;
    }
    return { expired, skipped: ids.length - expired };
  }

  /**
   * Expire one order if it is still pending and overdue and nobody else holds it. BR-5.3: the order
   * becomes `expired`, and a `new_publish` invitation returns `pending_payment → draft` with a history row
   * (SYSTEM). `null` when there was nothing to do. Lock order: order, then invitation — the webhook's.
   */
  private async expireIfOverdue(
    tx: Transaction,
    orderId: string,
  ): Promise<{ readonly invitationStatus: string | null } | null> {
    const order = await this.repository.lockOverdueOrder(tx, orderId);
    if (order === null) return null;

    await this.repository.setOrderStatus(tx, order.id, "pending", "expired");
    metrics.ordersExpired.inc({ order_type: order.orderType });
    logger.info(
      {
        context: {
          event: "order.expired",
          order_id: order.id,
          invitation_id: order.invitationId,
          order_type: order.orderType,
        },
      },
      "order expired unpaid",
    );

    if (order.orderType !== "new_publish") return { invitationStatus: null };
    try {
      await this.status.transitionWithin(
        tx,
        order.invitationId,
        "draft",
        { kind: "SYSTEM", userId: null },
        "order expired unpaid",
      );
      return { invitationStatus: "draft" };
    } catch (error) {
      if (
        !(error instanceof BusinessRuleError) ||
        error.code !== "INVALID_STATUS_TRANSITION"
      ) {
        throw error;
      }
      // The invitation is not `pending_payment` (already draft, deleted, …): nothing to return.
      return { invitationStatus: null };
    }
  }

  /** The order a previous request with this key created, if it still exists. */
  private async replay(
    scope: TenantScope,
    cacheKey: string,
    fingerprint: string,
  ): Promise<OrderRow | undefined> {
    const record = await this.cache.getJson<IdempotencyRecord>(
      IDEMPOTENCY_NAMESPACE,
      cacheKey,
    );
    if (record === undefined) return undefined;

    if (record.fingerprint !== fingerprint) {
      // The same key for a different invitation or a different selection. Returning the old
      // order would answer a question the client did not ask; creating a new one would make the
      // key mean nothing.
      throw new BusinessRuleError(
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency-Key ini sudah dipakai untuk pesanan lain.",
      );
    }

    return (
      (await this.repository.findOwnedOrder(record.orderId, scope)) ?? undefined
    );
  }
}

/**
 * Which kind of order an invitation's status allows. `MEMORY/specs/P3-02-order-creation.md` § 8.
 *
 * Decided by the server from the status, never sent by the client: a client that could say
 * `renewal` for a draft would skip the `pending_payment` transition.
 */
function planFor(status: string): {
  orderType: OrderType;
  transition: boolean;
} {
  switch (status) {
    case "draft":
      return { orderType: "new_publish", transition: true };
    case "pending_payment":
      // No pending order exists (checked by the caller), so the last one expired or failed
      // without returning the invitation to `draft`. A new order resumes the checkout.
      return { orderType: "new_publish", transition: false };
    case "published":
    case "expired":
      // `docs/API/06` step 3: a renewal performs no transition. A BR-2.8 trial lands here too.
      return { orderType: "renewal", transition: false };
    case "paid":
      throw new BusinessRuleError(
        "ORDER_NOT_ALLOWED",
        "Undangan ini sudah dibayar. Terbitkan undangan tanpa perlu membayar lagi.",
      );
    default:
      // `soft_deleted` has `deleted_at` set and never reaches here; anything else is not a
      // state an order belongs to.
      throw new NotFoundError();
  }
}

function activeOrderExists(orderId?: string): ConflictError {
  return new ConflictError(
    "ACTIVE_ORDER_EXISTS",
    "Undangan ini sudah memiliki pesanan yang menunggu pembayaran. Lanjutkan pesanan tersebut.",
    orderId === undefined
      ? undefined
      : [{ field: "order_id", message: orderId }],
  );
}

/** What a request asked for. Addon order does not change the purchase, so it is sorted. */
function fingerprintOf(invitationId: string, input: CreateOrderInput): string {
  return sha256(
    JSON.stringify([invitationId, input.packageId, [...input.addonIds].sort()]),
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toDto(order: OrderRow): OrderDto {
  // Rupiah fits a double exactly far beyond any real price, but a bigint that did not would be
  // silently rounded in JSON. Refuse rather than round money.
  const amount = Number(order.amountTotal);
  if (!Number.isSafeInteger(amount)) {
    throw new Error(
      `order ${order.id}: amount_total exceeds a safe JSON number`,
    );
  }
  return {
    id: order.id,
    invitation_id: order.invitationId,
    package_id: order.packageId,
    addons: [...order.addonIds],
    amount_total: amount,
    order_type: order.orderType,
    status: order.status,
    expired_at: order.expiredAt.toISOString(),
  };
}
