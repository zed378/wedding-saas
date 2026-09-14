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
import {
  OrderRepository,
  type OrderRow,
} from "../../shared/tenancy/order-repository";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import { requireVerifiedEmail } from "../auth/require-verified-email";
import { CatalogRepository } from "./catalog.repository";
import { PricingService, type OrderType } from "./pricing.service";

/** `docs/PLAN/09` § Order Flow: `expired_at = now + 24h`. */
export const PAYMENT_WINDOW_HOURS = 24;

/** How long a replayed `Idempotency-Key` returns the same order. The payment window. */
const IDEMPOTENCY_TTL_SECONDS = PAYMENT_WINDOW_HOURS * 60 * 60;
const IDEMPOTENCY_NAMESPACE = "idem:orders";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      async ({ tx, invitationStatus, pendingOrder }) => {
        if (pendingOrder !== null) {
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
