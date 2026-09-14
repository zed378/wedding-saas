import { randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { ConflictError, ServiceUnavailableError } from "../../http/errors";
import { logger } from "../../shared/logging/logger";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import { OrderService } from "../order/order.service";
import {
  PAYMENT_GATEWAY,
  PaymentProviderError,
  type PaymentGatewayPort,
} from "./payment-gateway.port";
import { PaymentRepository } from "./payment.repository";

/** A `pending` payment with no checkout younger than this is another request mid-call. */
export const IN_FLIGHT_SECONDS = 30;

export interface PayingUser {
  readonly scope: TenantScope;
  readonly fullName: string;
  readonly email: string;
}

/** `docs/API/07`: what the client needs to reach the payment page. No status of any kind. */
export interface CheckoutDto {
  readonly redirect_url: string;
  readonly token: string;
  readonly expires_at: string;
}

type Plan =
  | { readonly kind: "reuse"; readonly url: string; readonly token: string }
  | {
      readonly kind: "new";
      readonly paymentId: string;
      readonly reference: string;
      readonly amount: bigint;
    };

/**
 * `P3-04` — `POST /orders/:order_id/payment`. `MEMORY/specs/P3-04-payment-initiation.md`, ADR-076.
 *
 * ## The provider is called outside every transaction
 *
 * Step 1 locks the order briefly, decides, and commits a `pending` payment row. Step 2 calls the
 * gateway with nothing locked. A provider that takes ten seconds must not hold a database connection
 * for ten seconds per checkout — `P3-02` found out what a pool does when requests hold one connection
 * and wait for another.
 *
 * ## One payment page per order at a time
 *
 * A second initiation returns the pending payment's stored page. Two live pages for one order is how
 * a customer pays twice (ADR-076).
 */
@Injectable()
export class PaymentService {
  constructor(
    private readonly orders: OrderService,
    private readonly repository: PaymentRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
  ) {}

  async initiate(user: PayingUser, orderId: string): Promise<CheckoutDto> {
    let expiresAt = new Date(0);

    // ---- step 1: decide under the order lock, and commit the row before any provider call.
    const plan = await this.orders.withPayableOrder(
      user.scope,
      orderId,
      async ({ tx, orderId: id, amountTotal, expiredAt }): Promise<Plan> => {
        expiresAt = expiredAt;
        const pending = await this.repository.latestPending(
          tx,
          id,
          this.gateway.provider,
          IN_FLIGHT_SECONDS,
        );

        if (pending !== null) {
          const { payment, recent } = pending;
          if (payment.checkoutUrl !== null && payment.checkoutToken !== null) {
            return {
              kind: "reuse",
              url: payment.checkoutUrl,
              token: payment.checkoutToken,
            };
          }
          if (recent) {
            throw new ConflictError(
              "PAYMENT_IN_PROGRESS",
              "Halaman pembayaran sedang disiapkan. Coba lagi sebentar.",
            );
          }
          // Died between the insert and the provider's answer. It never became a page anyone saw.
          await this.repository.markInitiationFailed(payment.id, tx);
        }

        const reference = `${id}-${randomBytes(4).toString("hex")}`;
        const row = await this.repository.insertPending(tx, {
          orderId: id,
          provider: this.gateway.provider,
          providerReferenceId: reference,
          // `docs/BACKEND/05`: from the order row, never from a request.
          amount: amountTotal,
        });
        return {
          kind: "new",
          paymentId: row.id,
          reference,
          amount: amountTotal,
        };
      },
    );

    if (plan.kind === "reuse") {
      logger.info(
        {
          context: {
            event: "payment.initiated",
            order_id: orderId,
            reused: true,
          },
        },
        "payment page reused",
      );
      return toDto(plan.url, plan.token, expiresAt);
    }

    // ---- step 2: the provider, with nothing locked.
    try {
      const created = await this.gateway.createTransaction({
        providerReferenceId: plan.reference,
        amount: plan.amount,
        // `docs/SECURITY/09`: the minimum the provider needs.
        customer: { name: user.fullName, email: user.email },
      });
      await this.repository.storeCheckout(plan.paymentId, {
        url: created.redirectUrl,
        token: created.token,
      });
      logger.info(
        {
          context: {
            event: "payment.initiated",
            order_id: orderId,
            payment_id: plan.paymentId,
            provider_reference_id: plan.reference,
            reused: false,
          },
        },
        "payment page created",
      );
      return toDto(created.redirectUrl, created.token, expiresAt);
    } catch (error) {
      // The order and everything it belongs to are untouched (card DoD 4). Only this attempt's row records the failure.
      await this.repository.markInitiationFailed(plan.paymentId);
      if (error instanceof PaymentProviderError) {
        throw new ServiceUnavailableError(
          "Pembayaran sedang tidak dapat diproses. Silakan coba lagi dalam beberapa saat.",
          "PAYMENT_UNAVAILABLE",
        );
      }
      throw error;
    }
  }
}

function toDto(url: string, token: string, expiresAt: Date): CheckoutDto {
  return {
    redirect_url: url,
    token,
    expires_at: expiresAt.toISOString(),
  };
}
