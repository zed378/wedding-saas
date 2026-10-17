import { Inject, Injectable } from "@nestjs/common";

import { JOB_QUEUE, type JobQueue } from "../../infra/queue/queue.module";
import { logger } from "../../shared/logging/logger";
import { metrics } from "../../shared/metrics/metrics";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";

export interface ReminderSweepResult {
  readonly remindersSent: number;
  readonly h7Count: number;
  readonly h1Count: number;
}

/**
 * `P4-07` — `reminder_email_h7_h1`, daily 08:00 WIB (`docs/BACKEND/08`).
 *
 * Scans published invitations expiring in exactly 7 days (H-7) or 1 day (H-1) in WIB,
 * enqueuing `notification.send` with an idempotent key. A double-run on the same day
 * produces identical job keys, ensuring no duplicate emails are sent (DoD 2).
 *
 * Runs inside the API's jobs process (`api-jobs`, ADR-078).
 */
@Injectable()
export class InvitationReminderService {
  constructor(
    private readonly repository: InvitationRepository,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async sendExpiryReminders(
    days: readonly number[] = [7, 1],
    limit = 200,
  ): Promise<ReminderSweepResult> {
    const dueInvitations = await this.repository.invitationsExpiringInDays(
      days,
      limit,
    );

    let remindersSent = 0;
    let h7Count = 0;
    let h1Count = 0;

    for (const item of dueInvitations) {
      try {
        const idempotencyKey = `invitation.reminder:${item.daysRemaining}:${item.id}:${item.expiryDate}`;

        await this.queue.enqueue(
          "general",
          "notification.send",
          {
            template: "invitation_expiry_reminder",
            invitationId: item.id,
            daysRemaining: item.daysRemaining,
          },
          {
            idempotencyKey,
            relatedId: item.id,
          },
        );

        remindersSent++;
        if (item.daysRemaining === 7) h7Count++;
        if (item.daysRemaining === 1) h1Count++;

        logger.info(
          {
            context: {
              event: "invitation.reminder_enqueued",
              invitation_id: item.id,
              slug: item.slug,
              days_remaining: item.daysRemaining,
              expiry_date: item.expiryDate,
              idempotency_key: idempotencyKey,
            },
          },
          "expiry reminder notification enqueued",
        );
      } catch (error) {
        logger.error(
          {
            context: {
              event: "invitation.reminder_enqueue_failed",
              invitation_id: item.id,
              days_remaining: item.daysRemaining,
              error: error instanceof Error ? error.message : String(error),
            },
          },
          "failed to enqueue expiry reminder notification",
        );
      }
    }

    return { remindersSent, h7Count, h1Count };
  }
}
