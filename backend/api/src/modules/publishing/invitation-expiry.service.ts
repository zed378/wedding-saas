import { Inject, Injectable, Optional } from "@nestjs/common";

import { JOB_QUEUE, type JobQueue } from "../../infra/queue/queue.module";
import { InvitationStatusService } from "../../shared/invitation-status/invitation-status.service";
import { logger } from "../../shared/logging/logger";
import { metrics } from "../../shared/metrics/metrics";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";
import { PublicInvitationCache } from "./public-invitation-cache";

/**
 * `P3-13` — `invitation_expiry_check`, daily 00:05 WIB (`docs/BACKEND/08`).
 *
 * Transitions `published` invitations past `expiry_date` to `expired` with status history,
 * evicts the public cache, and enqueues owner notification.
 *
 * Runs inside the API's jobs process (`api-jobs`, ADR-078).
 */
@Injectable()
export class InvitationExpiryService {
  constructor(
    private readonly repository: InvitationRepository,
    private readonly status: InvitationStatusService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Optional()
    @Inject(PublicInvitationCache)
    private readonly cache?: PublicInvitationCache,
  ) {}

  async expireOverdueInvitations(limit = 200): Promise<{ expiredCount: number }> {
    const overdue = await this.repository.overduePublishedInvitations(limit);
    let expiredCount = 0;

    for (const item of overdue) {
      try {
        await this.repository.transaction(async (tx) => {
          await this.status.transitionWithin(
            tx,
            item.id,
            "expired",
            { kind: "SYSTEM", userId: null },
            "expiry_date passed, daily job",
          );
        });

        expiredCount++;
        metrics.invitationsExpired.inc();

        if (item.slug) {
          await this.cache?.invalidate({ slug: item.slug, invitationId: item.id });
        }

        await this.queue.enqueue(
          "general",
          "notification.send",
          { template: "invitation_expired", invitationId: item.id },
          {
            idempotencyKey: `invitation.expired:${item.id}:${item.expiryDate}`,
            relatedId: item.id,
          },
        );

        logger.info(
          {
            context: {
              event: "invitation.expired",
              invitation_id: item.id,
              slug: item.slug,
              expiry_date: item.expiryDate,
            },
          },
          "invitation expired by scheduled sweep",
        );
      } catch (error) {
        logger.error(
          {
            context: {
              event: "invitation.expire_failed",
              invitation_id: item.id,
              error: error instanceof Error ? error.message : String(error),
            },
          },
          "failed to expire invitation in sweep",
        );
      }
    }

    return { expiredCount };
  }
}
