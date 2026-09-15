import { Inject, Injectable } from "@nestjs/common";

import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import { JOB_QUEUE, type JobQueue } from "../../infra/queue/queue.module";
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from "../../http/errors";
import { InvitationStatusService } from "../../shared/invitation-status/invitation-status.service";
import { logger } from "../../shared/logging/logger";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import { requireVerifiedEmail } from "../auth/require-verified-email";
import { PublishCheckService } from "../invitation/publish-check.service";
import { SlugService } from "../invitation/slug.service";
import { EntitlementsService } from "../order/entitlements.service";

/** BR-2.8: how long a free trial publish stays live. */
export const TRIAL_DAYS = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PublishingUser {
  readonly scope: TenantScope;
  readonly emailVerified: boolean;
}

export interface PublishedDto {
  readonly status: "published";
  readonly slug: string;
  readonly url: string;
  readonly published_at: string;
  readonly expiry_date: string;
  readonly trial: boolean;
}

/**
 * `P3-09` — `POST /invitations/:id/publish`. `MEMORY/specs/P3-09-publish.md`, ADR-080.
 *
 * `docs/BACKEND/02`'s order, with BR-2.8's trial beside the paid path:
 *
 * 1. verified email (a property of the caller);
 * 2. ownership + required fields, through `PublishCheckService` in strict mode — the same resolver and
 *    the same `details[]` as the editor's checklist, so the gate and the checklist cannot disagree;
 * 3. the slug, re-checked from its stored value (a blocklist term may have been added since it was set);
 * 4. under the invitation's lock: the status decides paid or trial, the trial's eligibility is read from
 *    history, the transition and the dates are written in one transaction.
 *
 * Steps 2–3 run before the lock and step 4 re-reads the status under it, so a double click publishes once.
 */
@Injectable()
export class PublishService {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly check: PublishCheckService,
    private readonly slugs: SlugService,
    private readonly entitlements: EntitlementsService,
    private readonly status: InvitationStatusService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async publish(
    user: PublishingUser,
    invitationId: string,
  ): Promise<PublishedDto> {
    requireVerifiedEmail(user);
    if (!UUID.test(invitationId)) throw new NotFoundError();

    // Ownership (404) and BR-4.2, in one call.
    const readiness = await this.check.check(user.scope, invitationId, {
      strict: true,
    });
    if (!readiness.ready) {
      throw new BusinessRuleError(
        "INCOMPLETE_INVITATION",
        "Lengkapi data berikut sebelum menerbitkan undangan.",
        readiness.details,
      );
    }

    const current = await this.invitations.findOwned(invitationId, user.scope);
    if (current === null) throw new NotFoundError();
    await this.assertSlugUsable(current.slug, invitationId);

    // Read before the lock: it only matters for the paid path, and it reads no locked row.
    const entitlement = await this.entitlements.forInvitation(invitationId);

    const result = await this.invitations.withLockedOwned(
      invitationId,
      user.scope,
      async ({ tx, invitation }) => {
        const trial = await this.decide(tx, invitation.id, invitation.status);

        if (!trial && entitlement.durationMonths === null) {
          // `paid` status with no paid order behind it — data that should not exist. Refuse loudly.
          logger.error(
            {
              context: {
                event: "publish.paid_without_order",
                invitation_id: invitation.id,
              },
            },
            "invitation is paid but no paid order grants a validity period",
          );
          throw new BusinessRuleError(
            "PAYMENT_NOT_FOUND",
            "Pembayaran untuk undangan ini tidak ditemukan. Hubungi dukungan.",
          );
        }

        await this.status.transitionWithin(
          tx,
          invitation.id,
          "published",
          { kind: "USER", userId: user.scope },
          trial ? "user: free trial publish (BR-2.8)" : "user: publish",
        );
        const dates = await this.invitations.recordPublication(
          tx,
          invitation.id,
          user.scope,
          trial
            ? { days: TRIAL_DAYS }
            : { months: entitlement.durationMonths! },
        );
        return { trial, slug: invitation.slug!, ...dates };
      },
    );
    if (result === null) throw new NotFoundError();

    logger.info(
      {
        context: {
          event: "invitation.published",
          invitation_id: invitationId,
          trial: result.trial,
          expiry_date: result.expiryDate,
        },
      },
      "invitation published",
    );
    // `docs/BACKEND/06`: the owner's confirmation email (`P4-06` sends it). After the commit.
    await this.queue.enqueue(
      "general",
      "notification.send",
      { template: "invitation_published", invitationId, trial: result.trial },
      { relatedId: invitationId },
    );

    return {
      status: "published",
      slug: result.slug,
      url: `${this.env.PUBLIC_INVITE_ORIGIN}/${result.slug}`,
      published_at: result.publishedAt.toISOString(),
      expiry_date: result.expiryDate,
      trial: result.trial,
    };
  }

  /**
   * Whether this publish is a trial, or why it may not happen. Under the lock.
   * `MEMORY/specs/P3-09-publish.md` § 4 and § 8.
   */
  private async decide(
    tx: Parameters<
      Parameters<InvitationRepository["withLockedOwned"]>[2]
    >[0]["tx"],
    invitationId: string,
    status: string,
  ): Promise<boolean> {
    switch (status) {
      case "paid":
        return false;
      case "draft": {
        // BR-2.8: never paid AND never published. The second half is what makes it once.
        const used = await this.invitations.everReached(tx, invitationId, [
          "paid",
          "published",
        ]);
        if (used) throw trialAlreadyUsed();
        return true;
      }
      case "published":
        throw new BusinessRuleError(
          "INVITATION_ALREADY_PUBLISHED",
          "Undangan ini sudah diterbitkan.",
        );
      case "pending_payment":
        throw new BusinessRuleError(
          "PAYMENT_PENDING",
          "Selesaikan pembayaran untuk menerbitkan undangan ini.",
        );
      case "expired": {
        const everPaid = await this.invitations.everReached(tx, invitationId, [
          "paid",
        ]);
        if (!everPaid) throw trialAlreadyUsed();
        throw new BusinessRuleError(
          "RENEWAL_REQUIRED",
          "Masa aktif undangan ini sudah berakhir. Perpanjang untuk menerbitkannya kembali.",
        );
      }
      default:
        throw new NotFoundError();
    }
  }

  private async assertSlugUsable(
    slug: string | null,
    invitationId: string,
  ): Promise<void> {
    if (slug === null || slug.length === 0) {
      throw new BusinessRuleError(
        "SLUG_REQUIRED",
        "Tentukan alamat undangan sebelum menerbitkannya.",
        [{ field: "slug", message: "Alamat undangan belum diisi." }],
      );
    }
    const rejection = await this.slugs.check(slug, invitationId);
    if (rejection === undefined) return;
    if (rejection.kind === "taken") {
      throw new ConflictError("SLUG_TAKEN", rejection.message);
    }
    throw new BusinessRuleError(
      rejection.kind === "blocked" ? "SLUG_BLOCKED" : "SLUG_INVALID",
      rejection.message,
      [{ field: "slug", message: rejection.message }],
    );
  }
}

function trialAlreadyUsed(): BusinessRuleError {
  // BR-2.8 / ADR-052: the upgrade path is named, because it is the only way on.
  return new BusinessRuleError(
    "TRIAL_ALREADY_USED",
    "Masa uji coba gratis undangan ini sudah dipakai. Lakukan pembayaran untuk menerbitkannya kembali.",
  );
}
