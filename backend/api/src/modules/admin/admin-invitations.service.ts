import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { users } from "../../infra/db/schema/users";
import {
  invitations,
  invitationStatusHistory,
} from "../../infra/db/schema/invitations";
import { templates, templateVersions } from "../../infra/db/schema/templates";
import { orders } from "../../infra/db/schema/orders";
import { adminBypass } from "../../shared/tenancy/tenant-scope";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";
import { NotFoundError } from "../../http/errors";
import type { AdminInvitationQueryDto } from "./schemas/admin-invitation.schema";

/**
 * P5-10: Administrative Invitation Overview Service.
 *
 * READ-ONLY surface for support. No write methods exist (architectural absence).
 * Detail reads go through the audited bypass; the list is an operational index
 * that returns no invitation content.
 *
 * docs/API/09-ADMIN-API.md § Invitation Overview
 */
@Injectable()
export class AdminInvitationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: InvitationRepository,
  ) {}

  /**
   * List invitations with optional search by slug or user.
   * Returns operational data only — no personal invitation content.
   */
  async listInvitations(query: AdminInvitationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [isNull(invitations.deletedAt)];

    if (query.search_slug && query.search_slug.trim().length > 0) {
      const pattern = `%${query.search_slug.trim()}%`;
      conditions.push(ilike(invitations.slug, pattern));
    }

    if (query.search_user && query.search_user.trim().length > 0) {
      const pattern = `%${query.search_user.trim()}%`;
      conditions.push(
        or(ilike(users.email, pattern), ilike(users.fullName, pattern))!,
      );
    }

    const whereClause = and(...conditions);

    const [totalRow] = await this.db
      .select({ count: count() })
      .from(invitations)
      .leftJoin(users, eq(invitations.ownerId, users.id))
      .where(whereClause);

    const total = Number(totalRow?.count ?? 0);

    const rows = await this.db
      .select({
        id: invitations.id,
        slug: invitations.slug,
        status: invitations.status,
        ownerId: invitations.ownerId,
        templateVersionId: invitations.templateVersionId,
        publishedAt: invitations.publishedAt,
        expiryDate: invitations.expiryDate,
        createdAt: invitations.createdAt,
        updatedAt: invitations.updatedAt,
        ownerEmail: users.email,
        ownerFullName: users.fullName,
        templateName: templates.name,
        templateVersionString: templateVersions.version,
      })
      .from(invitations)
      .leftJoin(users, eq(invitations.ownerId, users.id))
      .leftJoin(templateVersions, eq(invitations.templateVersionId, templateVersions.id))
      .leftJoin(templates, eq(templateVersions.templateId, templates.id))
      .where(whereClause)
      .orderBy(desc(invitations.createdAt))
      .limit(limit)
      .offset(offset);

    // The latest order per invitation, resolved in one query rather than N.
    const latestOrderByInvitation = await this.latestOrders(
      rows.map((r) => r.id),
    );

    const data = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      status: row.status,
      owner: {
        id: row.ownerId,
        email: row.ownerEmail,
        fullName: row.ownerFullName,
      },
      templateVersion: {
        id: row.templateVersionId,
        name: row.templateName ?? null,
        version: row.templateVersionString ?? null,
      },
      publishedAt: row.publishedAt,
      expiryDate: row.expiryDate,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      latestOrder: latestOrderByInvitation.get(row.id) ?? null,
    }));

    return {
      data,
      meta: {
        page,
        per_page: limit,
        total,
      },
    };
  }


  /** Batch-fetch the latest paid order for each invitation in the set. */
  private async latestOrders(invitationIds: string[]) {
    const out = new Map<string, { id: string; packageId: string; amountTotal: string }>();
    if (invitationIds.length === 0) return out;

    // Two-pass: find max(createdAt) per invitationId for paid orders, then join back.
    const byId = await this.db
      .select({
        invitationId: orders.invitationId,
        id: orders.id,
        packageId: orders.packageId,
        amountTotal: orders.amountTotal,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.invitationId, invitationIds),
          eq(orders.status, "paid"),
        ),
      )
      .orderBy(desc(orders.createdAt));

    for (const o of byId) {
      if (!out.has(o.invitationId)) {
        out.set(o.invitationId, {
          id: o.id,
          packageId: o.packageId,
          amountTotal: o.amountTotal.toString(),
        });
      }
    }
    return out;
  }

  /**
   * Detail view — audited cross-tenant read via the repo bypass.
   * Throws NotFoundError if the invitation does not exist.
   */
  async getInvitationById(adminId: string, reason: string, invitationId: string) {
    const invitation = await this.repo.adminFindInvitationBypassingOwnership(
      invitationId,
      adminBypass(adminId, reason),
    );

    if (!invitation) {
      throw new NotFoundError(`Invitation "${invitationId}" not found.`);
    }

    // Fetch owner, latest paid order, and status history in parallel.
    const [owner, [latestOrder], statusHistory] = await Promise.all([
      this.db
        .select({
          email: users.email,
          fullName: users.fullName,
        })
        .from(users)
        .where(eq(users.id, invitation.ownerId))
        .limit(1),
      this.db
        .select({
          id: orders.id,
          packageId: orders.packageId,
          amountTotal: orders.amountTotal,
        })
        .from(orders)
        .where(
          and(
            eq(orders.invitationId, invitationId),
            eq(orders.status, "paid"),
          ),
        )
        .orderBy(desc(orders.createdAt))
        .limit(1),
      this.db
        .select({
          fromStatus: invitationStatusHistory.fromStatus,
          toStatus: invitationStatusHistory.toStatus,
          changedAt: invitationStatusHistory.createdAt,
        })
        .from(invitationStatusHistory)
        .where(eq(invitationStatusHistory.invitationId, invitationId))
        .orderBy(invitationStatusHistory.createdAt),
    ]);

    return {
      id: invitation.id,
      slug: invitation.slug,
      status: invitation.status,
      owner: {
        id: invitation.ownerId,
        email: owner?.[0]?.email ?? null,
        fullName: owner?.[0]?.fullName ?? null,
      },
      templateVersion: {
        id: invitation.templateVersionId,
      },
      publishedAt: invitation.publishedAt,
      expiryDate: invitation.expiryDate,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
      latestOrder: latestOrder
        ? {
            id: latestOrder.id,
            packageId: latestOrder.packageId,
            amountTotal: latestOrder.amountTotal.toString(),
          }
        : null,
      statusHistory,
    };
  }
}
