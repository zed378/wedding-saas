import { Inject, Injectable } from "@nestjs/common";

import { logger } from "../../shared/logging/logger";
import { metrics } from "../../shared/metrics/metrics";
import {
  PAYMENT_GATEWAY,
  type PaymentGatewayPort,
} from "./payment-gateway.port";
import { PaymentWebhookService } from "./payment-webhook.service";
import { PaymentRepository, type PaymentRow } from "./payment.repository";

export interface ReconciliationSummary {
  readonly checked: number;
  /** Provider said success where we had pending: applied through the webhook path, flagged. */
  readonly recovered: number;
  /** Disagreements that change nothing and need a person. */
  readonly flagged: number;
  /** The provider could not be asked about these. Retried on the next run. */
  readonly errors: number;
}

/**
 * `P3-06` step 4 — `payment_reconciliation`, daily. `docs/BACKEND/05` § Supporting Jobs: "compare the
 * transaction list from the Payment Gateway API vs. local data, flag mismatches for manual review" —
 * the control that catches a webhook the system never received.
 *
 * The configured provider's documented API has no transaction listing; it has a per-order status query. So this asks
 * about each local payment that could be wrong: still `pending` after ten minutes (a webhook may be
 * lost), or `success` in the last two days (the provider may disagree).
 *
 * | Local     | Provider says                 | Action                                                      |
 * |-----------|-------------------------------|-------------------------------------------------------------|
 * | pending   | success / failed / ignored    | `applyVerified(…, "reconciliation")`, always flagged        |
 * | pending   | pending, or no such order     | nothing                                                     |
 * | success   | success                       | nothing                                                     |
 * | success   | anything else, or no such     | `reconciliation_mismatch` / `reconciliation_missing`, flagged, nothing changed |
 *
 * A success is never undone here. Only an admin refund reverses a payment (BR-5.4).
 */
@Injectable()
export class PaymentReconciliationService {
  constructor(
    private readonly repository: PaymentRepository,
    private readonly settlement: PaymentWebhookService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
  ) {}

  async run(
    options: {
      readonly minPendingAgeMinutes?: number;
      readonly lookbackHours?: number;
      readonly limit?: number;
    } = {},
  ): Promise<ReconciliationSummary> {
    const candidates = await this.repository.reconciliationCandidates(
      this.gateway.provider,
      {
        minPendingAgeMinutes: options.minPendingAgeMinutes ?? 10,
        lookbackHours: options.lookbackHours ?? 48,
        limit: options.limit ?? 1000,
      },
    );

    let recovered = 0;
    let flagged = 0;
    let errors = 0;

    for (const payment of candidates) {
      try {
        const outcome = await this.reconcile(payment);
        if (outcome === "recovered") recovered += 1;
        if (outcome === "recovered" || outcome === "flagged") flagged += 1;
      } catch (error) {
        errors += 1;
        logger.warn(
          {
            context: {
              event: "payment.reconciliation_error",
              payment_id: payment.id,
              reason: error instanceof Error ? error.name : "unknown",
            },
          },
          "could not reconcile a payment; the next run retries it",
        );
      }
    }

    const summary = { checked: candidates.length, recovered, flagged, errors };
    logger.info(
      { context: { event: "payment.reconciliation_finished", ...summary } },
      "payment reconciliation finished",
    );
    return summary;
  }

  private async reconcile(
    payment: PaymentRow,
  ): Promise<"recovered" | "flagged" | "agreed"> {
    const event = await this.gateway.queryStatus(payment.providerReferenceId);

    if (payment.status === "pending") {
      if (event === null || event.outcome === "pending") return "agreed";
      // The webhook for this never arrived (or never succeeded). Same path, flagged regardless.
      await this.settlement.applyVerified(event, "reconciliation", {
        forceReview: true,
      });
      return "recovered";
    }

    // Local success.
    if (event !== null && event.outcome === "success") return "agreed";

    const result =
      event === null ? "reconciliation_missing" : "reconciliation_mismatch";
    await this.repository.recordReconciliationFinding({
      provider: this.gateway.provider,
      payment,
      result,
      providerStatus: event?.providerStatus ?? null,
      outcome: event?.outcome ?? null,
      amount: event?.amount ?? null,
      rawPayload: event?.raw ?? null,
    });
    metrics.paymentNeedsReview.inc({ provider: this.gateway.provider, result });
    logger.error(
      {
        context: {
          event: "payment.needs_review",
          source: "reconciliation",
          result,
          payment_id: payment.id,
          order_id: payment.orderId,
        },
      },
      "a paid payment does not match the provider",
    );
    return "flagged";
  }
}
