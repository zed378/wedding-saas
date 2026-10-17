import { createHash } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";

import { BusinessRuleError, NotFoundError } from "../../http/errors";
import { sanitizeFields } from "../../shared/sanitizer/sanitize";
import { TEXT_FIELDS } from "../../shared/sanitizer/registry";
import {
  RsvpRepository,
  type AttendanceStatus,
  type FindRsvpsOptions,
  type RsvpRow,
  type RsvpSummary,
} from "../../shared/tenancy/rsvp-repository";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
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
 * Escape a CSV cell, mitigating spreadsheet formula injection (OWASP).
 * Prepends a single quote if the value begins with '=', '+', '-', '@', '\t', or '\r'.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '""';
  }
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
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

  /**
   * List RSVPs for an invitation owned by the current user (P4-02).
   */
  async getRsvpsForOwner(
    scope: TenantScope,
    invitationId: string,
    options: FindRsvpsOptions = {},
  ): Promise<{ items: RsvpResponse[]; total: number }> {
    const result = await this.rsvpRepository.findRsvpsForOwner(
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
        attendance_status: r.attendanceStatus,
        guest_count: r.guestCount,
        message: r.message,
        created_at: r.createdAt.toISOString(),
      })),
      total: result.total,
    };
  }

  /**
   * Get attendance summary aggregated in SQL for an invitation owned by the current user (P4-02).
   */
  async getRsvpSummaryForOwner(
    scope: TenantScope,
    invitationId: string,
  ): Promise<RsvpSummary> {
    const summary = await this.rsvpRepository.getRsvpSummaryForOwner(
      scope,
      invitationId,
    );

    if (!summary) {
      throw new NotFoundError("Undangan tidak ditemukan.");
    }

    return summary;
  }

  /**
   * Generate CSV export with formula injection mitigation for an invitation owned by the current user (P4-02).
   */
  async exportRsvpsCsv(
    scope: TenantScope,
    invitationId: string,
  ): Promise<{ filename: string; csv: string }> {
    const data = await this.rsvpRepository.findAllRsvpsForExport(
      scope,
      invitationId,
    );

    if (!data) {
      throw new NotFoundError("Undangan tidak ditemukan.");
    }

    const headers = [
      "No",
      "Nama Tamu",
      "Status Kehadiran",
      "Jumlah Tamu",
      "Pesan",
      "Waktu Konfirmasi",
    ];

    const rows: string[] = [headers.join(",")];

    data.items.forEach((item, index) => {
      const row = [
        escapeCsvCell(index + 1),
        escapeCsvCell(item.guestName),
        escapeCsvCell(item.attendanceStatus),
        escapeCsvCell(item.guestCount),
        escapeCsvCell(item.message ?? ""),
        escapeCsvCell(item.createdAt.toISOString()),
      ];
      rows.push(row.join(","));
    });

    return {
      filename: `rsvps-${data.slug}.csv`,
      csv: rows.join("\r\n"),
    };
  }

  /**
   * Delete an RSVP entry belonging to an invitation owned by the current user (P4-02).
   */
  async deleteRsvpForOwner(
    scope: TenantScope,
    invitationId: string,
    rsvpId: string,
  ): Promise<void> {
    const deleted = await this.rsvpRepository.deleteRsvpForOwner(
      scope,
      invitationId,
      rsvpId,
    );

    if (!deleted) {
      throw new NotFoundError("RSVP tidak ditemukan.");
    }
  }
}
