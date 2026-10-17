import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import {
  invitations,
  invitationSettings,
  invitationGuestbook,
} from "../../infra/db/schema/index";
import type { TenantScope } from "./tenant-scope";

export type GuestbookEntryStatus = "pending" | "approved" | "rejected";

export interface PublishedGuestbookTarget {
  readonly invitationId: string;
  readonly guestbookEnabled: boolean;
  readonly guestbookModeration: boolean;
  readonly profanityFilterEnabled: boolean;
}

export interface InsertGuestbookParams {
  readonly invitationId: string;
  readonly guestName: string;
  readonly message: string;
  readonly status: GuestbookEntryStatus;
  readonly submittedIpHash?: string | null;
}

export interface GuestbookRow {
  readonly id: string;
  readonly invitationId: string;
  readonly guestName: string;
  readonly message: string;
  readonly status: GuestbookEntryStatus;
  readonly submittedIpHash: string | null;
  readonly moderatedBy: string | null;
  readonly moderatedAt: Date | null;
  readonly createdAt: Date;
}

export interface FindGuestbookOptions {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

/**
 * `P4-03` & `P4-04` — Guestbook data access.
 *
 * ## Dual boundary
 *
 * 1. Public reads and submissions (`findPublishedGuestbookTarget`, `findApprovedEntries`, `insertGuestbookEntry`):
 *    No owner scope. Constrained to `status = 'published' AND deleted_at IS NULL`.
 * 2. Owner moderation (`P4-04`): Strictly tenant-scoped by `invitations.owner_id = scope`.
 */
@Injectable()
export class GuestbookRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Resolve an invitation by slug for public guestbook interactions.
   * Only returns the target if the invitation is published and not soft-deleted.
   */
  async findPublishedGuestbookTarget(
    slug: string,
  ): Promise<PublishedGuestbookTarget | null> {
    const rows = await this.db
      .select({
        invitationId: invitations.id,
        guestbookEnabled: invitationSettings.guestbookEnabled,
        guestbookModeration: invitationSettings.guestbookModeration,
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
      guestbookEnabled: first.guestbookEnabled,
      guestbookModeration: first.guestbookModeration,
      profanityFilterEnabled: first.profanityFilterEnabled,
    };
  }

  /**
   * Check for identical messages submitted within the last `windowSeconds` from a DIFFERENT IP hash.
   * Simple duplicate-content spam detector (`docs/SECURITY/10`).
   */
  async hasRecentDuplicateMessage(
    invitationId: string,
    message: string,
    currentIpHash: string,
    windowSeconds: number = 300,
  ): Promise<boolean> {
    const cutoff = new Date(Date.now() - windowSeconds * 1000);

    const [row] = await this.db
      .select({ one: sql<number>`1` })
      .from(invitationGuestbook)
      .where(
        and(
          eq(invitationGuestbook.invitationId, invitationId),
          eq(invitationGuestbook.message, message),
          ne(invitationGuestbook.submittedIpHash, currentIpHash),
          gt(invitationGuestbook.createdAt, cutoff),
        ),
      )
      .limit(1);

    return row !== undefined;
  }

  /**
   * Insert a guestbook entry.
   */
  async insertGuestbookEntry(
    params: InsertGuestbookParams,
  ): Promise<GuestbookRow> {
    const rows = await this.db
      .insert(invitationGuestbook)
      .values({
        invitationId: params.invitationId,
        guestName: params.guestName,
        message: params.message,
        status: params.status,
        submittedIpHash: params.submittedIpHash ?? null,
      })
      .returning();

    const row = rows[0]!;
    return {
      id: row.id,
      invitationId: row.invitationId,
      guestName: row.guestName,
      message: row.message,
      status: row.status as GuestbookEntryStatus,
      submittedIpHash: row.submittedIpHash,
      moderatedBy: row.moderatedBy,
      moderatedAt: row.moderatedAt,
      createdAt: row.createdAt,
    };
  }

  /**
   * List approved entries for the public invitation display.
   * Pure SQL filter on `status = 'approved'`, ordered by newest first.
   */
  async findApprovedEntries(
    invitationId: string,
    options: FindGuestbookOptions = {},
  ): Promise<{ items: GuestbookRow[]; total: number }> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.max(1, Math.min(100, options.limit ?? 20));
    const offset = (page - 1) * limit;

    const condition = and(
      eq(invitationGuestbook.invitationId, invitationId),
      eq(invitationGuestbook.status, "approved"),
    );

    const [countResult] = await this.db
      .select({ total: count() })
      .from(invitationGuestbook)
      .where(condition);

    const total = Number(countResult?.total ?? 0);

    const rows = await this.db
      .select({
        id: invitationGuestbook.id,
        invitationId: invitationGuestbook.invitationId,
        guestName: invitationGuestbook.guestName,
        message: invitationGuestbook.message,
        status: invitationGuestbook.status,
        submittedIpHash: invitationGuestbook.submittedIpHash,
        moderatedBy: invitationGuestbook.moderatedBy,
        moderatedAt: invitationGuestbook.moderatedAt,
        createdAt: invitationGuestbook.createdAt,
      })
      .from(invitationGuestbook)
      .where(condition)
      .orderBy(desc(invitationGuestbook.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map((r) => ({
        ...r,
        status: r.status as GuestbookEntryStatus,
      })),
      total,
    };
  }

  /**
   * Resolve an invitation owned by the tenant scope.
   */
  async getInvitationOwnerScope(
    scope: TenantScope,
    invitationId: string,
  ): Promise<{ slug: string | null } | null> {
    const [row] = await this.db
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

    return row ?? null;
  }

  /**
   * Tenant-scoped paginated list of guestbook entries for the owner (P4-04).
   * Optional status filter ('pending', 'approved', 'rejected').
   */
  async findGuestbookForOwner(
    scope: TenantScope,
    invitationId: string,
    options: FindOwnerGuestbookOptions = {},
  ): Promise<{ items: GuestbookRow[]; total: number } | null> {
    const inv = await this.getInvitationOwnerScope(scope, invitationId);
    if (!inv) return null;

    const page = Math.max(1, options.page ?? 1);
    const limit = Math.max(1, Math.min(100, options.limit ?? 20));
    const offset = (page - 1) * limit;

    const conditions = [eq(invitationGuestbook.invitationId, invitationId)];
    if (options.status !== undefined) {
      conditions.push(eq(invitationGuestbook.status, options.status));
    }

    const [countResult] = await this.db
      .select({ total: count() })
      .from(invitationGuestbook)
      .where(and(...conditions));

    const total = Number(countResult?.total ?? 0);

    const rows = await this.db
      .select({
        id: invitationGuestbook.id,
        invitationId: invitationGuestbook.invitationId,
        guestName: invitationGuestbook.guestName,
        message: invitationGuestbook.message,
        status: invitationGuestbook.status,
        submittedIpHash: invitationGuestbook.submittedIpHash,
        moderatedBy: invitationGuestbook.moderatedBy,
        moderatedAt: invitationGuestbook.moderatedAt,
        createdAt: invitationGuestbook.createdAt,
      })
      .from(invitationGuestbook)
      .where(and(...conditions))
      .orderBy(desc(invitationGuestbook.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map((r) => ({
        ...r,
        status: r.status as GuestbookEntryStatus,
      })),
      total,
    };
  }

  /**
   * Update guestbook entry status (approve / reject) as the owner (P4-04).
   * Records moderated_by and moderated_at.
   */
  async moderateGuestbookEntryForOwner(
    scope: TenantScope,
    invitationId: string,
    entryId: string,
    newStatus: GuestbookEntryStatus,
    moderatorUserId: string,
  ): Promise<{
    row: GuestbookRow;
    slug: string | null;
    previousStatus: GuestbookEntryStatus;
  } | null> {
    const inv = await this.getInvitationOwnerScope(scope, invitationId);
    if (!inv) return null;

    // Find entry ensuring it belongs to this invitation
    const [existing] = await this.db
      .select()
      .from(invitationGuestbook)
      .where(
        and(
          eq(invitationGuestbook.id, entryId),
          eq(invitationGuestbook.invitationId, invitationId),
        ),
      )
      .limit(1);

    if (!existing) return null;

    const now = new Date();
    const [updated] = await this.db
      .update(invitationGuestbook)
      .set({
        status: newStatus,
        moderatedBy: moderatorUserId,
        moderatedAt: now,
      })
      .where(
        and(
          eq(invitationGuestbook.id, entryId),
          eq(invitationGuestbook.invitationId, invitationId),
        ),
      )
      .returning();

    if (!updated) return null;

    return {
      row: {
        id: updated.id,
        invitationId: updated.invitationId,
        guestName: updated.guestName,
        message: updated.message,
        status: updated.status as GuestbookEntryStatus,
        submittedIpHash: updated.submittedIpHash,
        moderatedBy: updated.moderatedBy,
        moderatedAt: updated.moderatedAt,
        createdAt: updated.createdAt,
      },
      slug: inv.slug,
      previousStatus: existing.status as GuestbookEntryStatus,
    };
  }

  /**
   * Delete guestbook entry as the owner (P4-04).
   */
  async deleteGuestbookEntryForOwner(
    scope: TenantScope,
    invitationId: string,
    entryId: string,
  ): Promise<{
    deleted: boolean;
    slug: string | null;
    previousStatus: GuestbookEntryStatus;
  } | null> {
    const inv = await this.getInvitationOwnerScope(scope, invitationId);
    if (!inv) return null;

    const [existing] = await this.db
      .select({
        id: invitationGuestbook.id,
        status: invitationGuestbook.status,
      })
      .from(invitationGuestbook)
      .where(
        and(
          eq(invitationGuestbook.id, entryId),
          eq(invitationGuestbook.invitationId, invitationId),
        ),
      )
      .limit(1);

    if (!existing) return null;

    await this.db
      .delete(invitationGuestbook)
      .where(
        and(
          eq(invitationGuestbook.id, entryId),
          eq(invitationGuestbook.invitationId, invitationId),
        ),
      );

    return {
      deleted: true,
      slug: inv.slug,
      previousStatus: existing.status as GuestbookEntryStatus,
    };
  }
}

export interface FindOwnerGuestbookOptions {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly status?: GuestbookEntryStatus | undefined;
}
