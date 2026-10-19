import { Inject, Injectable, Optional } from "@nestjs/common";
import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import {
  auditLogs,
  guestbookReports,
  invitationGuestbook,
  invitationSettings,
  invitations,
  users,
} from "../../infra/db/schema/index";
import { NotFoundError, ValidationError } from "../../http/errors";
import { JOB_QUEUE, type JobQueue } from "../../infra/queue/queue.module";
import type { CurrentUser } from "../../shared/auth-middleware/current-user";
import { PublicInvitationCache } from "../publishing/public-invitation-cache";
import type {
  AdminDeleteActionDto,
  AdminModerateActionDto,
  AdminModerationQueryDto,
} from "./schemas/admin-moderation.schema";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AdminModerationListItem {
  readonly id: string;
  readonly invitationId: string;
  readonly invitationSlug: string;
  readonly invitationTitle: string;
  readonly invitationStatus: string;
  readonly owner: {
    readonly id: string;
    readonly email: string;
    readonly fullName: string;
  };
  readonly guestName: string;
  readonly message: string;
  readonly status: "pending" | "approved" | "rejected";
  readonly submittedIpHash: string | null;
  readonly moderatedBy: string | null;
  readonly moderatedAt: string | null;
  readonly createdAt: string;
  readonly reportCount: number;
  readonly reports: readonly {
    readonly id: string;
    readonly reason: string | null;
    readonly createdAt: string;
  }[];
  readonly flagSource: "reported" | "auto_flagged" | "owner_moderation" | "standard";
  readonly flagLabel: string;
}

@Injectable()
export class AdminModerationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Optional() private readonly cache?: PublicInvitationCache,
    @Optional() @Inject(JOB_QUEUE) private readonly queue?: JobQueue,
  ) {}

  /**
   * List guestbook entries across invitations for administrative platform moderation.
   * Feeds from user reports and auto-flagged submissions.
   */
  async listGuestbook(query: AdminModerationQueryDto): Promise<{
    data: AdminModerationListItem[];
    meta: { page: number; per_page: number; total: number };
  }> {
    const page = Math.max(1, query.page);
    const limit = Math.max(1, Math.min(100, query.limit));
    const offset = (page - 1) * limit;

    const conditions = [];

    if (query.status !== "all") {
      conditions.push(eq(invitationGuestbook.status, query.status));
    }

    if (query.invitation_id) {
      if (!UUID_REGEX.test(query.invitation_id)) {
        throw new ValidationError([
          { field: "invitation_id", message: "invitation_id harus berupa UUID valid." },
        ]);
      }
      conditions.push(eq(invitationGuestbook.invitationId, query.invitation_id));
    }

    if (query.search && query.search.trim()) {
      const term = `%${query.search.trim()}%`;
      conditions.push(
        or(
          ilike(invitationGuestbook.guestName, term),
          ilike(invitationGuestbook.message, term),
          ilike(invitations.slug, term),
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Fetch total matching entries
    const [totalRow] = await this.db
      .select({ total: count() })
      .from(invitationGuestbook)
      .leftJoin(invitations, eq(invitationGuestbook.invitationId, invitations.id))
      .where(whereClause);

    const total = Number(totalRow?.total ?? 0);

    // Fetch rows
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
        invitationSlug: invitations.slug,
        invitationInternalName: invitations.internalName,
        invitationStatus: invitations.status,
        invitationGuestbookModeration: invitationSettings.guestbookModeration,
        ownerId: users.id,
        ownerEmail: users.email,
        ownerFullName: users.fullName,
      })
      .from(invitationGuestbook)
      .leftJoin(invitations, eq(invitationGuestbook.invitationId, invitations.id))
      .leftJoin(invitationSettings, eq(invitations.id, invitationSettings.invitationId))
      .leftJoin(users, eq(invitations.ownerId, users.id))
      .where(whereClause)
      .orderBy(desc(invitationGuestbook.createdAt))
      .limit(limit)
      .offset(offset);

    const entryIds = rows.map((r) => r.id);

    // Fetch reports for these entries
    const reportsMap = new Map<
      string,
      { id: string; reason: string | null; createdAt: string }[]
    >();

    if (entryIds.length > 0) {
      const reportRows = await this.db
        .select({
          id: guestbookReports.id,
          entryId: guestbookReports.guestbookEntryId,
          reason: guestbookReports.reason,
          createdAt: guestbookReports.createdAt,
        })
        .from(guestbookReports)
        .where(inArray(guestbookReports.guestbookEntryId, entryIds))
        .orderBy(desc(guestbookReports.createdAt));

      for (const rep of reportRows) {
        const existing = reportsMap.get(rep.entryId) ?? [];
        existing.push({
          id: rep.id,
          reason: rep.reason,
          createdAt: rep.createdAt.toISOString(),
        });
        reportsMap.set(rep.entryId, existing);
      }
    }

    let data: AdminModerationListItem[] = rows.map((r) => {
      const reports = reportsMap.get(r.id) ?? [];
      const reportCount = reports.length;

      let flagSource: "reported" | "auto_flagged" | "owner_moderation" | "standard" =
        "standard";
      let flagLabel = "Standar";

      if (reportCount > 0) {
        flagSource = "reported";
        flagLabel = `Dilaporkan Tamu (${reportCount}x)`;
      } else if (r.status === "pending") {
        if (r.invitationGuestbookModeration) {
          flagSource = "owner_moderation";
          flagLabel = "Moderasi Pemilik";
        } else {
          flagSource = "auto_flagged";
          flagLabel = "Filter Otomatis (Spam / Profanity)";
        }
      }

      return {
        id: r.id,
        invitationId: r.invitationId,
        invitationSlug: r.invitationSlug ?? "",
        invitationTitle:
          r.invitationInternalName ||
          (r.invitationSlug ? `Undangan /${r.invitationSlug}` : "Undangan"),
        invitationStatus: r.invitationStatus ?? "draft",
        owner: {
          id: r.ownerId ?? "",
          email: r.ownerEmail ?? "",
          fullName: r.ownerFullName ?? "",
        },
        guestName: r.guestName,
        message: r.message,
        status: r.status as "pending" | "approved" | "rejected",
        submittedIpHash: r.submittedIpHash,
        moderatedBy: r.moderatedBy,
        moderatedAt: r.moderatedAt ? r.moderatedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        reportCount,
        reports,
        flagSource,
        flagLabel,
      };
    });

    if (query.flag_source === "reported") {
      data = data.filter((item) => item.reportCount > 0);
    } else if (query.flag_source === "auto_flagged") {
      data = data.filter(
        (item) => item.flagSource === "auto_flagged" || item.flagSource === "owner_moderation",
      );
    }

    return {
      data,
      meta: {
        page,
        per_page: limit,
        total,
      },
    };
  }

  /**
   * Moderate a guestbook entry (approve or reject) with mandatory audit log.
   * Immediately invalidates public invitation cache if published.
   */
  async moderateGuestbook(
    admin: CurrentUser,
    id: string,
    dto: AdminModerateActionDto,
  ) {
    if (!UUID_REGEX.test(id)) {
      throw new NotFoundError(`Pesan buku tamu "${id}" tidak ditemukan.`);
    }

    const [existing] = await this.db
      .select({
        id: invitationGuestbook.id,
        invitationId: invitationGuestbook.invitationId,
        guestName: invitationGuestbook.guestName,
        message: invitationGuestbook.message,
        status: invitationGuestbook.status,
        invitationSlug: invitations.slug,
        invitationStatus: invitations.status,
      })
      .from(invitationGuestbook)
      .leftJoin(invitations, eq(invitationGuestbook.invitationId, invitations.id))
      .where(eq(invitationGuestbook.id, id))
      .limit(1);

    if (!existing) {
      throw new NotFoundError(`Pesan buku tamu "${id}" tidak ditemukan.`);
    }

    const previousStatus = existing.status;
    const now = new Date();
    const actionReason =
      dto.reason?.trim() || `Admin moderation decision: ${dto.status}`;

    await this.db.transaction(async (tx) => {
      await tx
        .update(invitationGuestbook)
        .set({
          status: dto.status,
          moderatedBy: admin.id,
          moderatedAt: now,
        })
        .where(eq(invitationGuestbook.id, id));

      await tx.insert(auditLogs).values({
        adminId: admin.id,
        action: "guestbook.moderate",
        resourceType: "guestbook_entry",
        resourceId: id,
        reason: actionReason,
        beforeState: {
          status: previousStatus,
          guest_name: existing.guestName,
          invitation_id: existing.invitationId,
        },
        afterState: {
          status: dto.status,
          moderated_by: admin.id,
          moderated_at: now.toISOString(),
        },
      });
    });

    // Invalidate public edge cache if published
    if (existing.invitationStatus === "published" && existing.invitationSlug) {
      if (this.cache) {
        await this.cache.invalidate({
          slug: existing.invitationSlug,
          invitationId: existing.invitationId,
        });
      }
      if (this.queue) {
        await this.queue.enqueue(
          "general",
          "cache.invalidate",
          {
            slug: existing.invitationSlug,
            invitationId: existing.invitationId,
            reason: `admin guestbook moderation: ${dto.status}`,
          },
          { relatedId: existing.invitationId },
        );
      }
    }

    return {
      id,
      status: dto.status,
      moderatedAt: now.toISOString(),
      message: `Pesan buku tamu berhasil di-${dto.status === "approved" ? "setujui" : "tolak"}.`,
    };
  }

  /**
   * Delete a guestbook entry with mandatory audit log.
   * Immediately invalidates public invitation cache if published.
   */
  async deleteGuestbook(
    admin: CurrentUser,
    id: string,
    dto?: AdminDeleteActionDto,
  ) {
    if (!UUID_REGEX.test(id)) {
      throw new NotFoundError(`Pesan buku tamu "${id}" tidak ditemukan.`);
    }

    const [existing] = await this.db
      .select({
        id: invitationGuestbook.id,
        invitationId: invitationGuestbook.invitationId,
        guestName: invitationGuestbook.guestName,
        message: invitationGuestbook.message,
        status: invitationGuestbook.status,
        invitationSlug: invitations.slug,
        invitationStatus: invitations.status,
      })
      .from(invitationGuestbook)
      .leftJoin(invitations, eq(invitationGuestbook.invitationId, invitations.id))
      .where(eq(invitationGuestbook.id, id))
      .limit(1);

    if (!existing) {
      throw new NotFoundError(`Pesan buku tamu "${id}" tidak ditemukan.`);
    }

    const actionReason = dto?.reason?.trim() || "Admin deleted guestbook entry";

    await this.db.transaction(async (tx) => {
      await tx
        .delete(invitationGuestbook)
        .where(eq(invitationGuestbook.id, id));

      await tx.insert(auditLogs).values({
        adminId: admin.id,
        action: "guestbook.delete",
        resourceType: "guestbook_entry",
        resourceId: id,
        reason: actionReason,
        beforeState: {
          id: existing.id,
          invitation_id: existing.invitationId,
          guest_name: existing.guestName,
          message: existing.message,
          status: existing.status,
        },
        afterState: null,
      });
    });

    if (existing.invitationStatus === "published" && existing.invitationSlug) {
      if (this.cache) {
        await this.cache.invalidate({
          slug: existing.invitationSlug,
          invitationId: existing.invitationId,
        });
      }
      if (this.queue) {
        await this.queue.enqueue(
          "general",
          "cache.invalidate",
          {
            slug: existing.invitationSlug,
            invitationId: existing.invitationId,
            reason: "admin guestbook deletion",
          },
          { relatedId: existing.invitationId },
        );
      }
    }

    return {
      id,
      deleted: true,
      message: "Pesan buku tamu berhasil dihapus permanen dari platform.",
    };
  }
}
