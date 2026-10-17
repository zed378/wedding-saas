import { Inject, Injectable } from "@nestjs/common";

import { JOB_QUEUE, type JobQueue } from "../../infra/queue/queue.module";
import { BusinessRuleError, NotFoundError } from "../../http/errors";
import { InvitationStatusService } from "../../shared/invitation-status/invitation-status.service";
import { logger } from "../../shared/logging/logger";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import { PublicInvitationCache } from "./public-invitation-cache";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UnpublishedDto {
  readonly status: "paid" | "draft";
  readonly slug: string | null;
}

/**
 * `P3-10` — `POST /invitations/:id/unpublish`. `docs/BACKEND/06` § Unpublish, BR-2.5,
 * `MEMORY/specs/P3-10-unpublish-republish.md`, ADR-081.
 *
 * **To `paid`, never `draft`** — for an invitation that was paid for: republishing must not cost again.
 * **To `draft`** for a BR-2.8 trial, which was never paid: `paid` would hand it the product. Which one is
 * read from history under the lock, the same predicate the trial rule uses.
 *
 * `published_at` and `expiry_date` are untouched: the first is history (BR-6.2 reads it), and the second is
 * what a republish returns to. The slug stays on the row, so the partial unique index keeps it reserved
 * (`docs/PLAN/10` § Unpublish).
 */
@Injectable()
export class UnpublishService {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly status: InvitationStatusService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly cache?: PublicInvitationCache,
  ) {}

  async unpublish(
    scope: TenantScope,
    invitationId: string,
  ): Promise<UnpublishedDto> {
    if (!UUID.test(invitationId)) throw new NotFoundError();

    const result = await this.invitations.withLockedOwned(
      invitationId,
      scope,
      async ({ tx, invitation }) => {
        if (invitation.status !== "published") {
          throw new BusinessRuleError(
            "INVITATION_NOT_PUBLISHED",
            "Undangan ini tidak sedang diterbitkan.",
          );
        }
        const everPaid = await this.invitations.everReached(tx, invitation.id, [
          "paid",
        ]);
        const to = everPaid ? "paid" : "draft";
        await this.status.transitionWithin(
          tx,
          invitation.id,
          to,
          { kind: "USER", userId: scope },
          everPaid ? "user: unpublish" : "user: unpublish a free trial",
        );
        return { status: to, slug: invitation.slug } as UnpublishedDto;
      },
    );
    if (result === null) throw new NotFoundError();

    logger.info(
      {
        context: {
          event: "invitation.unpublished",
          invitation_id: invitationId,
          to: result.status,
        },
      },
      "invitation unpublished",
    );
    // `docs/BACKEND/06`: invalidate IMMEDIATELY.
    if (result.slug !== null) {
      await this.cache?.invalidate({ slug: result.slug, invitationId });
      await this.queue.enqueue(
        "general",
        "cache.invalidate",
        { slug: result.slug, invitationId, reason: "unpublished" },
        { relatedId: invitationId },
      );
    }
    return result;
  }
}
