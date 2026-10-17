import { createHash } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";

import { BusinessRuleError, NotFoundError } from "../../http/errors";
import { sanitizeFields } from "../../shared/sanitizer/sanitize";
import { TEXT_FIELDS } from "../../shared/sanitizer/registry";
import {
  RsvpRepository,
  type AttendanceStatus,
  type RsvpRow,
} from "../../shared/tenancy/rsvp-repository";
import { JOB_QUEUE, type JobQueue } from "../../infra/queue/queue.module";
import { logger } from "../../shared/logging/logger";

export interface SubmitRsvpDto {
  readonly guest_name: string;
  readonly attendance_status: AttendanceStatus;
  readonly guest_count?: number;
  readonly message?: string | null;
}

export interface RsvpResponse {
  readonly id: string;
  readonly guest_name: string;
  readonly attendance_status: AttendanceStatus;
  readonly guest_count: number;
  readonly message: string | null;
  readonly created_at: string;
}

/**
 * `P4-01` — Service managing RSVP attendance submissions.
 */
@Injectable()
export class RsvpService {
  constructor(
    private readonly rsvpRepository: RsvpRepository,
    @Optional() @Inject(JOB_QUEUE) private readonly queue?: JobQueue,
  ) {}

  /**
   * Submit an attendance confirmation from the public invitation page.
   *
   * 1. Resolves published invitation by slug. Throws NotFoundError (404) if not found/unpublished.
   * 2. Checks rsvp_enabled. Throws BusinessRuleError (422) if disabled.
   * 3. Sanitizes free text inputs against stored XSS.
   * 4. Hashes client IP to preserve visitor privacy.
   * 5. Inserts into invitation_guests.
   * 6. Queues rsvp.submitted notification.
   */
  async submitRsvp(
    slug: string,
    dto: SubmitRsvpDto,
    clientIp: string,
  ): Promise<RsvpResponse> {
    const target = await this.rsvpRepository.findPublishedRsvpTarget(slug);
    if (!target) {
      throw new NotFoundError("Undangan tidak ditemukan atau belum dipublikasikan.");
    }

    if (!target.rsvpEnabled) {
      throw new BusinessRuleError(
        "RSVP_DISABLED",
        "Fitur RSVP dinonaktifkan untuk undangan ini.",
      );
    }

    const sanitized = sanitizeFields(
      {
        guest_name: dto.guest_name,
        message: dto.message ?? null,
      },
      TEXT_FIELDS,
    );

    const ipHash = createHash("sha256").update(clientIp).digest("hex");

    // Clamp guest_count between 1 and 10 per database check constraint
    const guestCount = Math.max(1, Math.min(10, dto.guest_count ?? 1));

    const row = await this.rsvpRepository.insertRsvp({
      invitationId: target.invitationId,
      guestName: sanitized.guest_name as string,
      attendanceStatus: dto.attendance_status,
      guestCount,
      message: (sanitized.message as string | null) ?? null,
      submittedIpHash: ipHash,
    });

    if (this.queue) {
      try {
        await this.queue.enqueue(
          "general",
          "notification.send",
          {
            template: "rsvp_submitted",
            invitationId: target.invitationId,
            rsvpId: row.id,
            guestName: row.guestName,
            attendanceStatus: row.attendanceStatus,
            guestCount: row.guestCount,
          },
          { idempotencyKey: `rsvp.submitted:${row.id}` },
        );
      } catch (err) {
        logger.warn({ err }, "failed to enqueue rsvp.submitted notification");
      }
    }

    return {
      id: row.id,
      guest_name: row.guestName,
      attendance_status: row.attendanceStatus,
      guest_count: row.guestCount,
      message: row.message,
      created_at: row.createdAt.toISOString(),
    };
  }
}
