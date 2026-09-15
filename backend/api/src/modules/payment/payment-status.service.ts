import { Inject, Injectable } from "@nestjs/common";

import { CACHE, type CachePort } from "../../infra/cache/cache.port";
import { logger } from "../../shared/logging/logger";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import { OrderService } from "../order/order.service";
import {
  PAYMENT_GATEWAY,
  type PaymentGatewayPort,
} from "./payment-gateway.port";
import { PaymentWebhookService } from "./payment-webhook.service";
import { PaymentRepository } from "./payment.repository";

/** A payment still pending after this long is worth asking the provider about. */
export const QUERY_AFTER_SECONDS = 120;
/** At most one provider query per payment in this window, however often the page polls. */
export const QUERY_THROTTLE_SECONDS = 30;
const THROTTLE_NAMESPACE = "payment:query";

/** `docs/API/07` § Status Polling. */
export interface PaymentStatusDto {
  readonly order_status: string;
  readonly payment_status: string | null;
  readonly paid_at: string | null;
}

/**
 * `P3-06` — `GET /orders/:order_id/payment/status`. `MEMORY/specs/P3-06-payment-status.md`.
 *
 * **Display only, by construction.** Nothing here writes a status. The one thing it may do beyond
 * reading is ask the provider — server to server — about a payment that has been pending for a
 * while, and hand a verified answer to `PaymentWebhookService.applyVerified`, the same transition
 * path the webhook uses. The endpoint takes no parameter that could carry a status; there is nothing
 * for a client to tell it.
 *
 * The provider query is throttled per payment, so a page polling every two seconds asks the provider at
 * most once every thirty. A query that fails is logged and ignored: the answer is the database's
 * state either way.
 */
@Injectable()
export class PaymentStatusService {
  constructor(
    private readonly orders: OrderService,
    private readonly repository: PaymentRepository,
    private readonly settlement: PaymentWebhookService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    @Inject(CACHE) private readonly cache: CachePort,
  ) {}

  async status(scope: TenantScope, orderId: string): Promise<PaymentStatusDto> {
    const order = await this.orders.ownedOrderStatus(scope, orderId);
    const shown = await this.repository.displayPayment(
      order.id,
      QUERY_AFTER_SECONDS,
    );

    if (
      shown !== null &&
      order.status === "pending" &&
      shown.payment.status === "pending" &&
      shown.stale &&
      shown.payment.provider === this.gateway.provider
    ) {
      const asked = await this.askProvider(shown.payment.providerReferenceId);
      if (asked) return this.read(scope, orderId);
    }

    return toDto(order.status, shown?.payment ?? null);
  }

  private async read(
    scope: TenantScope,
    orderId: string,
  ): Promise<PaymentStatusDto> {
    const order = await this.orders.ownedOrderStatus(scope, orderId);
    const shown = await this.repository.displayPayment(
      order.id,
      QUERY_AFTER_SECONDS,
    );
    return toDto(order.status, shown?.payment ?? null);
  }

  /** Whether a verified answer was applied. */
  private async askProvider(reference: string): Promise<boolean> {
    const throttled = await this.cache.getJson<boolean>(
      THROTTLE_NAMESPACE,
      reference,
    );
    if (throttled === true) return false;
    await this.cache.setJson(
      THROTTLE_NAMESPACE,
      reference,
      true,
      QUERY_THROTTLE_SECONDS,
    );

    try {
      const event = await this.gateway.queryStatus(reference);
      if (event === null || event.outcome === "pending") return false;
      await this.settlement.applyVerified(event, "query");
      return true;
    } catch (error) {
      logger.warn(
        {
          context: {
            event: "payment.status_query_failed",
            provider_reference_id: reference,
            reason: error instanceof Error ? error.name : "unknown",
          },
        },
        "provider status query failed; answering from the database",
      );
      return false;
    }
  }
}

function toDto(
  orderStatus: string,
  payment: { status: string; verifiedAt: Date | null } | null,
): PaymentStatusDto {
  return {
    order_status: orderStatus,
    payment_status: payment?.status ?? null,
    paid_at:
      payment?.status === "success" && payment.verifiedAt !== null
        ? payment.verifiedAt.toISOString()
        : null,
  };
}
