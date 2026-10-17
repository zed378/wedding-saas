import { createHash } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";

import { BusinessRuleError, NotFoundError } from "../../http/errors";
import { sanitizeFields } from "../../shared/sanitizer/sanitize";
import { TEXT_FIELDS } from "../../shared/sanitizer/registry";
import {
  GuestbookRepository,
  type FindGuestbookOptions,
  type GuestbookEntryStatus,
  type GuestbookRow,
} from "../../shared/tenancy/guestbook-repository";
import { JOB_QUEUE, type JobQueue } from "../../infra/queue/queue.module";
import { logger } from "../../shared/logging/logger";

export interface SubmitGuestbookDto {
  readonly guest_name: string;
  readonly message: string;
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

/**
 * `P4-03` — Service managing public guestbook submissions and approved listings.
 */
@Injectable()
export class GuestbookService {
  constructor(
    private readonly guestbookRepository: GuestbookRepository,
    @Optional() @Inject(JOB_QUEUE) private readonly queue?: JobQueue,
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

    const sanitized = sanitizeFields(
      {
        guest_name: dto.guest_name,
        message: dto.message,
      },
      TEXT_FIELDS,
    );

    const ipHash = createHash("sha256").update(clientIp).digest("hex");

    // Default status according to owner moderation setting (BR-7.3)
    const defaultStatus: GuestbookEntryStatus = target.guestbookModeration
      ? "pending"
      : "approved";

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
}
