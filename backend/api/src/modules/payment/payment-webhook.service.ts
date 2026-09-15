import { Inject, Injectable } from "@nestjs/common";

import { JOB_QUEUE, type JobQueue } from "../../infra/queue/queue.module";
import { NotFoundError, UnauthenticatedError } from "../../http/errors";
import { logger } from "../../shared/logging/logger";
import { metrics } from "../../shared/metrics/metrics";
import { OrderService } from "../order/order.service";
import {
  PAYMENT_GATEWAY,
  type PaymentGatewayPort,
  type VerifiedPaymentEvent,
} from "./payment-gateway.port";
import { PaymentRepository } from "./payment.repository";

/** An invalid notification's payload is kept only if it is a JSON object this small. */
const MAX_INVALID_PAYLOAD_BYTES = 8 * 1024;

/** Where a verified event came from (`payment_notifications.source`, migration `0013`). */
export type NotificationSource = "webhook" | "query" | "reconciliation";

export type WebhookResult =
  | "applied"
  | "late_payment"
  | "duplicate_charge"
  | "refunded_order"
  | "applied_entitlement_skipped"
  | "duplicate"
  | "failed"
  | "failed_other_payment_live"
  | "no_change"
  | "ignored"
  | "unknown_reference"
  | "amount_mismatch";

/**
 * `P3-05` — `POST /api/webhooks/payment/:provider`. `MEMORY/specs/P3-05-payment-webhook.md`, ADR-077.
 *
 * **The only code path that grants what an order paid for.** Read in this order:
 *
 * 1. Every arrival is recorded in `payment_notifications` first, in its own statement, so a forged
 *    callback is kept even though it changes nothing, and a processing failure still leaves a trace.
 * 2. The gateway verifies. Invalid → metric, security log, 401. Nothing else runs: the claimed
 *    reference is stored as text and never used to look anything up.
 * 3. Verified → one transaction: lock the payment by `(provider, reference)`, check the amount, apply
 *    the outcome (§ 8 of the spec), mark the notification processed. Payment, order and what the order settles
 *    commit together or not at all.
 * 4. After the commit, and only if this delivery moved the order to `paid`: queue `order.paid`.
 *
 * Idempotency is the lock plus conditional updates: a second delivery of a success waits for the first
 * to commit, then finds the payment already `success` and does nothing.
 */
@Injectable()
export class PaymentWebhookService {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    private readonly repository: PaymentRepository,
    private readonly orders: OrderService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async handle(provider: string, body: unknown): Promise<WebhookResult> {
    if (provider !== this.gateway.provider) throw new NotFoundError();

    const verdict = this.gateway.verifyNotification(body);

    if (!verdict.valid) {
      await this.recordInvalid(
        provider,
        verdict.reason,
        verdict.claimedReference,
        body,
      );
      metrics.paymentWebhookSignatureInvalid.inc({
        provider,
        reason: verdict.reason,
      });
      logger.warn(
        {
          context: {
            event: "payment.invalid_signature",
            provider,
            reason: verdict.reason,
            // Unverified claim, logged so an attempt against a real payment is visible. Not a lookup.
            claimed_reference: verdict.claimedReference ?? null,
          },
        },
        "payment notification refused: signature did not verify",
      );
      // `docs/SECURITY/07`: respond 401 and do not process the payload at all.
      throw new UnauthenticatedError("Notification signature is not valid.");
    }

    return this.applyVerified(verdict.event, "webhook");
  }

  /**
   * `P3-06` — THE state transition path for a verified provider event, whatever brought it: the
   * webhook, a status query from the polling endpoint, or the reconciliation job. `docs/BACKEND/05`
   * § Status Polling: a query result "ALSO goes through the same verification process before
   * changing state" — here it goes through the same transitions too, so a provider query is a second
   * source, not a second rulebook.
   *
   * `forceReview`: reconciliation finding a success the webhook never delivered is itself worth a
   * human's attention, even when applying it is routine.
   */
  async applyVerified(
    event: VerifiedPaymentEvent,
    source: NotificationSource,
    options: { readonly forceReview?: boolean } = {},
  ): Promise<WebhookResult> {
    const provider = this.gateway.provider;
    const notificationId = await this.repository.recordNotification({
      source,
      provider,
      claimedReference: event.providerReferenceId.slice(0, 150),
      signatureValid: true,
      outcome: event.outcome,
      providerStatus: event.providerStatus.slice(0, 40),
      amount: event.amount,
      rawPayload: event.raw,
    });

    const outcome = await this.repository.transaction(async (tx) => {
      const payment = await this.repository.lockByReference(
        tx,
        provider,
        event.providerReferenceId,
      );

      const finish = async (
        result: WebhookResult,
        options: {
          needsReview?: boolean;
          becamePaid?: boolean;
          orderId?: string;
        } = {},
      ) => {
        await this.repository.completeNotification(tx, notificationId, {
          paymentId: payment?.id ?? null,
          result,
          needsReview: options.needsReview ?? false,
        });
        return {
          result,
          needsReview: options.needsReview ?? false,
          becamePaid: options.becamePaid ?? false,
          orderId: options.orderId ?? payment?.orderId ?? null,
        };
      };

      if (payment === null)
        return finish("unknown_reference", { needsReview: true });

      // A verified notification for a different amount is not a payment for this order.
      if (event.amount !== payment.amount) {
        return finish("amount_mismatch", { needsReview: true });
      }

      return this.apply(tx, event, payment, finish);
    });

    if (options.forceReview === true && !outcome.needsReview) {
      await this.repository.flagForReview(notificationId);
      outcome.needsReview = true;
    }

    metrics.paymentWebhookProcessed.inc({ provider, result: outcome.result });
    if (outcome.needsReview) {
      metrics.paymentNeedsReview.inc({ provider, result: outcome.result });
      logger.error(
        {
          context: {
            event: "payment.needs_review",
            provider,
            result: outcome.result,
            provider_reference_id: event.providerReferenceId,
            order_id: outcome.orderId,
            notification_id: notificationId,
            source,
          },
        },
        "payment notification needs manual review",
      );
    }

    if (outcome.becamePaid && outcome.orderId !== null) {
      logger.info(
        {
          context: {
            event: "payment.confirmed",
            provider,
            order_id: outcome.orderId,
            provider_reference_id: event.providerReferenceId,
          },
        },
        "payment confirmed",
      );
      // After the commit (`docs/BACKEND/05` step 5): the invoice cannot describe a rolled-back payment.
      await this.queue.enqueue(
        "general",
        "notification.send",
        { template: "order_paid", orderId: outcome.orderId },
        {
          idempotencyKey: `order.paid:${outcome.orderId}`,
          relatedId: outcome.orderId,
        },
      );
      // `P3-08`: the invoice, rendered by the jobs process — never inside this transaction, so a
      // rendering failure cannot touch the payment. The owner's download generates it if this is lost.
      await this.queue.enqueue(
        "general",
        "invoice.generate",
        { orderId: outcome.orderId },
        {
          idempotencyKey: `invoice.generate:${outcome.orderId}`,
          relatedId: outcome.orderId,
        },
      );
    }

    return outcome.result;
  }

  private async apply<R>(
    tx: Parameters<Parameters<PaymentRepository["transaction"]>[0]>[0],
    event: VerifiedPaymentEvent,
    payment: {
      id: string;
      orderId: string;
      status: string;
      method: string | null;
    },
    finish: (
      result: WebhookResult,
      options?: {
        needsReview?: boolean;
        becamePaid?: boolean;
        orderId?: string;
      },
    ) => Promise<R>,
  ): Promise<R> {
    switch (event.outcome) {
      case "success": {
        if (payment.status === "success") return finish("duplicate");

        const recorded = await this.repository.recordVerifiedOutcome(
          tx,
          payment.id,
          {
            status: "success",
            method: event.method ?? payment.method,
            rawPayload: event.raw,
          },
        );
        // Belt and braces with the row lock: the update is conditional on the payment not already
        // being `success`, so if another delivery got there first this one does nothing further —
        // even if the lock were ever lost in a refactor. A mutation run showed the lock alone was not
        // what the tests were proving.
        if (!recorded) return finish("duplicate");
        const settlement = await this.orders.settlePaid(tx, payment.orderId);
        return finish(settlement.result, {
          needsReview: settlement.needsReview || payment.status === "failed",
          becamePaid: settlement.becamePaid,
        });
      }

      case "failed": {
        // Never downgrade a success; a repeated failure changes nothing.
        if (payment.status !== "pending") return finish("no_change");

        await this.repository.recordVerifiedOutcome(tx, payment.id, {
          status: "failed",
          method: event.method ?? payment.method,
          rawPayload: event.raw,
        });
        if (
          await this.repository.hasOtherLivePayment(
            tx,
            payment.orderId,
            payment.id,
          )
        ) {
          return finish("failed_other_payment_live");
        }
        await this.orders.settleFailed(tx, payment.orderId);
        return finish("failed");
      }

      case "pending": {
        if (event.method !== null && payment.method === null) {
          await this.repository.recordMethod(tx, payment.id, event.method);
        }
        return finish("no_change");
      }

      case "ignored":
        // A refund, a chargeback, a pre-authorisation, a status nobody mapped. BR-5.4: refunds are
        // an admin action; this records the provider's word and asks a human.
        return finish("ignored", { needsReview: true });
    }
  }

  private async recordInvalid(
    provider: string,
    reason: string,
    claimedReference: string | undefined,
    body: unknown,
  ): Promise<void> {
    try {
      await this.repository.recordNotification({
        source: "webhook",
        provider,
        claimedReference: claimedReference?.slice(0, 150) ?? null,
        signatureValid: false,
        rejectionReason: reason,
        rawPayload: boundedObject(body),
      });
    } catch (error) {
      // Recording must not turn a refusal into a 500 the forger can retry against.
      logger.error(
        {
          context: {
            event: "payment.invalid_signature",
            provider,
            reason: error instanceof Error ? error.name : "unknown",
          },
        },
        "could not record an invalid payment notification",
      );
    }
  }
}

/** An attacker-controlled payload is stored only if it is a plain JSON object of bounded size. */
function boundedObject(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return null;
  const size = Buffer.byteLength(JSON.stringify(body));
  return size <= MAX_INVALID_PAYLOAD_BYTES ? body : null;
}
