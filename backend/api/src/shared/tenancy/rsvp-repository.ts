import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import {
  invitations,
  invitationSettings,
  invitationGuests,
} from "../../infra/db/schema/index";
import type { TenantScope } from "./tenant-scope";

export type AttendanceStatus = "attending" | "not_attending" | "maybe";

export interface InsertRsvpParams {
  readonly invitationId: string;
  readonly guestName: string;
  readonly attendanceStatus: AttendanceStatus;
  readonly guestCount: number;
  readonly message?: string | null;
  readonly submittedIpHash?: string | null;
}

export interface RsvpRow {
  readonly id: string;
  readonly invitationId: string;
  readonly guestName: string;
  readonly attendanceStatus: AttendanceStatus;
  readonly guestCount: number;
  readonly message: string | null;
  readonly submittedIpHash: string | null;
  readonly createdAt: Date;
}

export interface PublishedRsvpTarget {
  readonly invitationId: string;
  readonly rsvpEnabled: boolean;
}

/**
 * `P4-01` & `P4-02` — RSVP data access.
 *
 * ## Dual boundary
 *
 * 1. Public submissions (`insertRsvp`, `findPublishedRsvpTarget`): No owner scope. Replaces owner
 *    check with `status = 'published' AND deleted_at IS NULL`, identical to `PublicInvitationRepository`.
 * 2. Owner reads/management (`findRsvpsForOwner`): Strictly tenant-scoped by `owner_id = scope.userId`.
 */
@Injectable()
export class RsvpRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Resolve an invitation by slug for public RSVP submission.
   * Only returns the target if the invitation is currently published.
   */
  async findPublishedRsvpTarget(slug: string): Promise<PublishedRsvpTarget | null> {
    const rows = await this.db
      .select({
        invitationId: invitations.id,
        rsvpEnabled: invitationSettings.rsvpEnabled,
      })
      .from(invitations)
      .innerJoin(
        invitationSettings,
        eq(invitationSettings.invitationId, invitations.id),
      )
      .where(
        and(
          eq(invitations.slug, slug),
          eq(invitations.status, "published"),
          isNull(invitations.deletedAt),
        ),
      )
      .limit(1);

    const first = rows[0];
    if (!first) return null;

    return {
      invitationId: first.invitationId,
      rsvpEnabled: first.rsvpEnabled,
    };
  }

  /**
   * Insert a public RSVP submission.
   */
  async insertRsvp(params: InsertRsvpParams): Promise<RsvpRow> {
    const rows = await this.db
      .insert(invitationGuests)
      .values({
        invitationId: params.invitationId,
        guestName: params.guestName,
        attendanceStatus: params.attendanceStatus,
        guestCount: params.guestCount,
        message: params.message ?? null,
        submittedIpHash: params.submittedIpHash ?? null,
      })
      .returning();

    const row = rows[0]!;
    return {
      id: row.id,
      invitationId: row.invitationId,
      guestName: row.guestName,
      attendanceStatus: row.attendanceStatus as AttendanceStatus,
      guestCount: row.guestCount,
      message: row.message,
      submittedIpHash: row.submittedIpHash,
      createdAt: row.createdAt,
    };
  }

  /**
   * Tenant-scoped list for the invitation owner (P4-02).
   */
  async findRsvpsForOwner(
    scope: TenantScope,
    invitationId: string,
  ): Promise<RsvpRow[]> {
    const rows = await this.db
      .select({
        id: invitationGuests.id,
        invitationId: invitationGuests.invitationId,
        guestName: invitationGuests.guestName,
        attendanceStatus: invitationGuests.attendanceStatus,
        guestCount: invitationGuests.guestCount,
        message: invitationGuests.message,
        submittedIpHash: invitationGuests.submittedIpHash,
        createdAt: invitationGuests.createdAt,
      })
      .from(invitationGuests)
      .innerJoin(invitations, eq(invitations.id, invitationGuests.invitationId))
      .where(
        and(
          eq(invitationGuests.invitationId, invitationId),
          eq(invitations.ownerId, scope),
          isNull(invitations.deletedAt),
        ),
      )
      .orderBy(desc(invitationGuests.createdAt));

    return rows.map((r) => ({
      ...r,
      attendanceStatus: r.attendanceStatus as AttendanceStatus,
    }));
  }
}
