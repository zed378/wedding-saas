import { Inject, Injectable } from "@nestjs/common";
import { eq, and, inArray } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { emailBounces } from "../../infra/db/schema/users";
import { metrics } from "../../shared/metrics/metrics";
import { logger } from "../../shared/logging/logger";

export interface RecordBounceInput {
  readonly email: string;
  readonly bounceType: "hard_bounce" | "complaint" | "transient";
  readonly message?: string | null | undefined;
  readonly provider?: string | undefined;
  readonly providerEmailId?: string | null | undefined;
}

/**
 * `P4-08` — Email delivery bounce suppression and dead-letter monitoring.
 *
 * Persists delivery failures, hard bounces, and spam complaints from delivery providers
 * (e.g. Resend) into `email_bounces` to prevent sending to dead addresses, protecting
 * sender domain reputation and deliverability.
 */
@Injectable()
export class EmailBounceService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Records a bounce or spam complaint, and increments the corresponding Prometheus metric.
   */
  async recordBounce(input: RecordBounceInput): Promise<void> {
    const normalizedEmail = input.email.toLowerCase().trim();
    const provider = input.provider ?? "resend";

    await this.db
      .insert(emailBounces)
      .values({
        email: normalizedEmail,
        bounceType: input.bounceType,
        message: input.message ?? null,
        provider,
        providerEmailId: input.providerEmailId ?? null,
      })
      .returning();

    // Increment metrics for monitoring & alerting (alerts.yml › EmailDeliveryBounceSpike)
    metrics.emailBounces.inc({
      provider,
      type: input.bounceType,
    });

    logger.warn(
      {
        context: {
          event: "email.bounce_recorded",
          email: normalizedEmail,
          type: input.bounceType,
          provider,
        },
      },
      "recorded email delivery bounce/complaint suppression",
    );
  }

  /**
   * Checks whether an address is suppressed due to a prior hard bounce or spam complaint.
   */
  async isSuppressed(email: string): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim();
    const rows = await this.db
      .select({ id: emailBounces.id })
      .from(emailBounces)
      .where(
        and(
          eq(emailBounces.email, normalizedEmail),
          inArray(emailBounces.bounceType, ["hard_bounce", "complaint"]),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  /**
   * Records a permanently failed transactional notification that entered the DLQ,
   * incrementing `wi_notification_dead_letter_total` for Prometheus alerting
   * (deploy/prometheus/alerts.yml › CriticalEmailDeadLettered).
   */
  recordDeadLetter(template: string, details?: unknown): void {
    metrics.notificationDeadLetter.inc({ template });
    logger.error(
      {
        context: {
          event: "notification.critical_dead_letter",
          template,
          details,
        },
      },
      "critical notification permanently failed delivery and entered DLQ",
    );
  }
}
