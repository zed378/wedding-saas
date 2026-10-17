import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";

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
  readonly profanityFilterEnabled: boolean;
}

export interface RsvpSummary {
  readonly total_responses: number;
  readonly attending: number;
  readonly not_attending: number;
  readonly maybe: number;
  readonly total_attending_guests: number;
}

export interface FindRsvpsOptions {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly status?: AttendanceStatus | undefined;
}

/**
 * `P4-01` & `P4-02` — RSVP data access.
 *
 * ## Dual boundary
 *
 * 1. Public submissions (`insertRsvp`, `findPublishedRsvpTarget`): No owner scope. Replaces owner
 *    check with `status = 'published' AND deleted_at IS NULL`, identical to `PublicInvitationRepository`.
 * 2. Owner reads/management (`findRsvpsForOwner`, `getRsvpSummaryForOwner`, etc.): Strictly tenant-scoped
 *    by `owner_id = scope`.
 */
@Injectable()
export class RsvpRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Verify that the invitation exists, is owned by scope, and is not deleted.
   */
  async ownsInvitation(
    scope: TenantScope,
    invitationId: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ one: sql<number>`1` })
      .from(invitations)
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.ownerId, scope),
          isNull(invitations.deletedAt),
        ),
      )
      .limit(1);

    return row !== undefined;
  }

  /**
   * Resolve an invitation by slug for public RSVP submission.
   * Only returns the target if the invitation is currently published.
   */
  async findPublishedRsvpTarget(slug: string): Promise<PublishedRsvpTarget | null> {
    const rows = await this.db
      .select({
        invitationId: invitations.id,
        rsvpEnabled: invitationSettings.rsvpEnabled,
        profanityFilterEnabled: invitationSettings.profanityFilterEnabled,
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
      profanityFilterEnabled: first.profanityFilterEnabled,
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
   * Tenant-scoped paginated list for the invitation owner (P4-02).
   */
  async findRsvpsForOwner(
    scope: TenantScope,
    invitationId: string,
    options: FindRsvpsOptions = {},
  ): Promise<{ items: RsvpRow[]; total: number } | null> {
    const isOwner = await this.ownsInvitation(scope, invitationId);
    if (!isOwner) return null;

    const page = Math.max(1, options.page ?? 1);
    const limit = Math.max(1, Math.min(100, options.limit ?? 20));
    const offset = (page - 1) * limit;

    const conditions = [eq(invitationGuests.invitationId, invitationId)];
    if (options.status !== undefined) {
      conditions.push(eq(invitationGuests.attendanceStatus, options.status));
    }

    const [countResult] = await this.db
      .select({ total: count() })
      .from(invitationGuests)
      .where(and(...conditions));

    const total = Number(countResult?.total ?? 0);

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
      .where(and(...conditions))
      .orderBy(desc(invitationGuests.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map((r) => ({
        ...r,
        attendanceStatus: r.attendanceStatus as AttendanceStatus,
      })),
      total,
    };
  }

  /**
   * Aggregated RSVP summary computed directly in SQL (P4-02).
   */
  async getRsvpSummaryForOwner(
    scope: TenantScope,
    invitationId: string,
  ): Promise<RsvpSummary | null> {
    const isOwner = await this.ownsInvitation(scope, invitationId);
    if (!isOwner) return null;

    const [summary] = await this.db
      .select({
        totalResponses: count(invitationGuests.id),
        attending: sql<number>`count(case when ${invitationGuests.attendanceStatus} = 'attending' then 1 end)::int`,
        notAttending: sql<number>`count(case when ${invitationGuests.attendanceStatus} = 'not_attending' then 1 end)::int`,
        maybe: sql<number>`count(case when ${invitationGuests.attendanceStatus} = 'maybe' then 1 end)::int`,
        totalAttendingGuests: sql<number>`coalesce(sum(case when ${invitationGuests.attendanceStatus} = 'attending' then ${invitationGuests.guestCount} else 0 end), 0)::int`,
      })
      .from(invitationGuests)
      .where(eq(invitationGuests.invitationId, invitationId));

    return {
      total_responses: Number(summary?.totalResponses ?? 0),
      attending: Number(summary?.attending ?? 0),
      not_attending: Number(summary?.notAttending ?? 0),
      maybe: Number(summary?.maybe ?? 0),
      total_attending_guests: Number(summary?.totalAttendingGuests ?? 0),
    };
  }

  /**
   * Fetch all RSVPs for CSV export, returning the invitation slug (P4-02).
   */
  async findAllRsvpsForExport(
    scope: TenantScope,
    invitationId: string,
  ): Promise<{ slug: string; items: RsvpRow[] } | null> {
    const [inv] = await this.db
      .select({ slug: invitations.slug })
      .from(invitations)
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.ownerId, scope),
          isNull(invitations.deletedAt),
        ),
      )
      .limit(1);

    if (!inv) return null;

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
      .where(eq(invitationGuests.invitationId, invitationId))
      .orderBy(invitationGuests.createdAt);

    return {
      slug: inv.slug ?? "invitation",
      items: rows.map((r) => ({
        ...r,
        attendanceStatus: r.attendanceStatus as AttendanceStatus,
      })),
    };
  }

  /**
   * Delete an RSVP row if owned by scope and belonging to invitationId (P4-02).
   */
  async deleteRsvpForOwner(
    scope: TenantScope,
    invitationId: string,
    rsvpId: string,
  ): Promise<boolean> {
    const isOwner = await this.ownsInvitation(scope, invitationId);
    if (!isOwner) return false;

    const rows = await this.db
      .delete(invitationGuests)
      .where(
        and(
          eq(invitationGuests.id, rsvpId),
          eq(invitationGuests.invitationId, invitationId),
        ),
      )
      .returning({ id: invitationGuests.id });

    return rows.length > 0;
  }
}
