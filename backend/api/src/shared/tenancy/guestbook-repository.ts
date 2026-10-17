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
}
