import { createHash } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";

import { BusinessRuleError, NotFoundError } from "../../http/errors";
import { sanitizeFields } from "../../shared/sanitizer/sanitize";
import { TEXT_FIELDS } from "../../shared/sanitizer/registry";
import {
  GuestbookRepository,
  type FindGuestbookOptions,
  type FindOwnerGuestbookOptions,
  type GuestbookEntryStatus,
  type GuestbookRow,
} from "../../shared/tenancy/guestbook-repository";
export type { GuestbookEntryStatus };
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import { JOB_QUEUE, type JobQueue } from "../../infra/queue/queue.module";
import { logger } from "../../shared/logging/logger";
import { PublicInvitationCache } from "../publishing/public-invitation-cache";
import { AbuseProtectionService } from "../../shared/abuse/abuse-protection.service";

export interface SubmitGuestbookDto {
  readonly guest_name: string;
  readonly message: string;
  readonly captcha_token?: string;
}

export interface GuestbookResponse {
  readonly id: string;
  readonly guest_name: string;
  readonly message: string;
  readonly status: GuestbookEntryStatus;
  readonly created_at: string;
}

export interface PublicGuestbookListItem {
  readonly id: string;
  readonly guest_name: string;
  readonly message: string;
  readonly created_at: string;
}

export interface OwnerGuestbookListItem {
  readonly id: string;
  readonly guest_name: string;
  readonly message: string;
  readonly status: GuestbookEntryStatus;
  readonly submitted_ip_hash: string | null;
  readonly moderated_by: string | null;
  readonly moderated_at: string | null;
  readonly created_at: string;
}

/**
 * `P4-03`, `P4-04` & `P4-05` — Service managing public guestbook, abuse protection, and owner moderation.
 */
@Injectable()
export class GuestbookService {
  constructor(
    private readonly guestbookRepository: GuestbookRepository,
    @Optional() private readonly abuseProtection?: AbuseProtectionService,
    @Optional() @Inject(JOB_QUEUE) private readonly queue?: JobQueue,
    @Optional() private readonly cache?: PublicInvitationCache,
  ) {}

  /**
   * Submit a congratulatory message from a guest on the public invitation page.
   *
   * 1. Resolves published invitation by slug. Throws NotFoundError (404) if not found/unpublished.
   * 2. Checks guestbook_enabled. Throws BusinessRuleError (422) if disabled.
   * 3. Sanitizes free text inputs against stored XSS.
   * 4. Hashes client IP to preserve visitor privacy.
   * 5. Sets initial status: 'pending' if guestbook_moderation is on or if identical message was
   *    recently posted from another IP (duplicate spam guard); otherwise 'approved'.
   * 6. Inserts into invitation_guestbook.
   * 7. Queues guestbook.submitted notification.
   */
  async submitEntry(
    slug: string,
    dto: SubmitGuestbookDto,
    clientIp: string,
  ): Promise<GuestbookResponse> {
    const target =
      await this.guestbookRepository.findPublishedGuestbookTarget(slug);
    if (!target) {
      throw new NotFoundError(
        "Undangan tidak ditemukan atau belum dipublikasikan.",
      );
    }

    if (!target.guestbookEnabled) {
      throw new BusinessRuleError(
        "GUESTBOOK_DISABLED",
        "Fitur buku tamu dinonaktifkan untuk undangan ini.",
      );
    }

    if (this.abuseProtection) {
      await this.abuseProtection.verifySubmission(
        slug,
        dto.captcha_token,
        clientIp,
      );
    }

    const sanitized = sanitizeFields(
      {
        guest_name: dto.guest_name,
        message: dto.message,
      },
      TEXT_FIELDS,
    );

    const ipHash = createHash("sha256").update(clientIp).digest("hex");

    // Check profanity if enabled on invitation settings (P4-05)
    const hasProfanity =
      target.profanityFilterEnabled && this.abuseProtection
        ? (await this.abuseProtection.containsProfanity(
            sanitized.message as string,
            "guestbook",
          )) ||
          (await this.abuseProtection.containsProfanity(
            sanitized.guest_name as string,
            "guestbook",
          ))
        : false;

    // Default status according to owner moderation setting (BR-7.3) or profanity flag
    const defaultStatus: GuestbookEntryStatus =
      target.guestbookModeration || hasProfanity ? "pending" : "approved";

    // Simple duplicate content spam guard: identical message from another IP in 5 min forces pending
    const isDuplicate =
      await this.guestbookRepository.hasRecentDuplicateMessage(
        target.invitationId,
        sanitized.message as string,
        ipHash,
        300,
      );

    const status: GuestbookEntryStatus = isDuplicate
      ? "pending"
      : defaultStatus;

    const row = await this.guestbookRepository.insertGuestbookEntry({
      invitationId: target.invitationId,
      guestName: sanitized.guest_name as string,
      message: sanitized.message as string,
      status,
      submittedIpHash: ipHash,
    });

    if (this.queue) {
      try {
        await this.queue.enqueue(
          "general",
          "notification.send",
          {
            template: "guestbook_submitted",
            invitationId: target.invitationId,
            guestbookId: row.id,
            guestName: row.guestName,
            status: row.status,
          },
          { idempotencyKey: `guestbook.submitted:${row.id}` },
        );
      } catch (err) {
        logger.warn(
          { err },
          "failed to enqueue guestbook.submitted notification",
        );
      }
    }

    return {
      id: row.id,
      guest_name: row.guestName,
      message: row.message,
      status: row.status,
      created_at: row.createdAt.toISOString(),
    };
  }

  /**
   * List approved guestbook entries for display on the public invitation page.
   * Scoped to published invitations, filtered by status = 'approved', newest first.
   */
  async listApprovedEntries(
    slug: string,
    options: FindGuestbookOptions = {},
  ): Promise<{ items: PublicGuestbookListItem[]; total: number }> {
    const target =
      await this.guestbookRepository.findPublishedGuestbookTarget(slug);
    if (!target) {
      throw new NotFoundError(
        "Undangan tidak ditemukan atau belum dipublikasikan.",
      );
    }

    const result = await this.guestbookRepository.findApprovedEntries(
      target.invitationId,
      options,
    );

    return {
      items: result.items.map((r) => ({
        id: r.id,
        guest_name: r.guestName,
        message: r.message,
        created_at: r.createdAt.toISOString(),
      })),
      total: result.total,
    };
  }

  /**
   * Paginated list of all guestbook entries for the invitation owner (P4-04).
   * Throws 404 if invitation does not exist or does not belong to owner.
   */
  async findForOwner(
    scope: TenantScope,
    invitationId: string,
    options: FindOwnerGuestbookOptions = {},
  ): Promise<{ items: OwnerGuestbookListItem[]; total: number }> {
    const result = await this.guestbookRepository.findGuestbookForOwner(
      scope,
      invitationId,
      options,
    );

    if (!result) {
      throw new NotFoundError("Undangan tidak ditemukan.");
    }

    return {
      items: result.items.map((r) => ({
        id: r.id,
        guest_name: r.guestName,
        message: r.message,
        status: r.status,
        submitted_ip_hash: r.submittedIpHash,
        moderated_by: r.moderatedBy,
        moderated_at: r.moderatedAt ? r.moderatedAt.toISOString() : null,
        created_at: r.createdAt.toISOString(),
      })),
      total: result.total,
    };
  }

  /**
   * Moderate a guestbook entry (approve / reject) as the invitation owner (P4-04).
   * Enforces ownership, records moderator and timestamp, and invalidates public cache if visibility changed.
   */
  async moderateEntry(
    scope: TenantScope,
    invitationId: string,
    entryId: string,
    newStatus: GuestbookEntryStatus,
    moderatorUserId: string,
  ): Promise<OwnerGuestbookListItem> {
    const result =
      await this.guestbookRepository.moderateGuestbookEntryForOwner(
        scope,
        invitationId,
        entryId,
        newStatus,
        moderatorUserId,
      );

    if (!result) {
      throw new NotFoundError(
        "Undangan atau pesan buku tamu tidak ditemukan.",
      );
    }

    // Invalidate public page cache if entry was approved or became approved
    if (
      result.slug &&
      (newStatus === "approved" || result.previousStatus === "approved")
    ) {
      try {
        await this.cache?.invalidate({
          slug: result.slug,
          invitationId,
        });
      } catch (err) {
        logger.warn(
          { err, invitationId, entryId },
          "failed to invalidate public invitation cache on guestbook moderation",
        );
      }
    }

    return {
      id: result.row.id,
      guest_name: result.row.guestName,
      message: result.row.message,
      status: result.row.status,
      submitted_ip_hash: result.row.submittedIpHash,
      moderated_by: result.row.moderatedBy,
      moderated_at: result.row.moderatedAt
        ? result.row.moderatedAt.toISOString()
        : null,
      created_at: result.row.createdAt.toISOString(),
    };
  }

  /**
   * Delete a guestbook entry as the invitation owner (P4-04).
   * Enforces ownership and invalidates public cache if the deleted entry was approved.
   */
  async deleteEntry(
    scope: TenantScope,
    invitationId: string,
    entryId: string,
  ): Promise<{ id: string; deleted: true }> {
    const result = await this.guestbookRepository.deleteGuestbookEntryForOwner(
      scope,
      invitationId,
      entryId,
    );

    if (!result) {
      throw new NotFoundError(
        "Undangan atau pesan buku tamu tidak ditemukan.",
      );
    }

    if (result.slug && result.previousStatus === "approved") {
      try {
        await this.cache?.invalidate({
          slug: result.slug,
          invitationId,
        });
      } catch (err) {
        logger.warn(
          { err, invitationId, entryId },
          "failed to invalidate public invitation cache on guestbook deletion",
        );
      }
    }

    return {
      id: entryId,
      deleted: true,
    };
  }

  /**
   * Check whether adaptive CAPTCHA is currently required for a given slug (P4-05).
   */
  async isCaptchaRequired(slug: string): Promise<boolean> {
    if (!this.abuseProtection) return false;
    return this.abuseProtection.isCaptchaRequired(slug);
  }
}
