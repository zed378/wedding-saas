import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { DB, type Database } from "../../infra/db/client";
import { users } from "../../infra/db/schema/users";
import {
  invitations,
  invitationStatusHistory,
} from "../../infra/db/schema/invitations";
import { templates, templateVersions } from "../../infra/db/schema/templates";
import { orders } from "../../infra/db/schema/orders";
import { auditLogs } from "../../infra/db/schema/index";
import { adminBypass, tenantScope } from "../../shared/tenancy/tenant-scope";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";
import { NotFoundError } from "../../http/errors";
import type { AdminInvitationQueryDto } from "./schemas/admin-invitation.schema";
import { PublishCheckService } from "../invitation/publish-check.service";

@Injectable()
export class AdminInvitationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: InvitationRepository,
    private readonly publishCheck: PublishCheckService,
  ) {}

  async listInvitations(adminId: string, query: AdminInvitationQueryDto) {
    return this.adminFindInvitationsBypassingOwnership(adminId, query);
  }

  /** SECURITY/05: no result leaves the transaction before its bypass is audited. */
  private async adminFindInvitationsBypassingOwnership(
    adminId: string,
    query: AdminInvitationQueryDto,
  ) {
    const bypass = adminBypass(adminId, "Support invitation search");
    return this.db.transaction(async (tx) => {
      const conditions = [isNull(invitations.deletedAt)];
      if (query.search_slug)
        conditions.push(ilike(invitations.slug, `%${query.search_slug}%`));
      if (query.search_user)
        conditions.push(
          or(
            ilike(users.email, `%${query.search_user}%`),
            ilike(users.fullName, `%${query.search_user}%`),
          )!,
        );
      const predicate = and(...conditions);
      const [total] = await tx
        .select({ count: count() })
        .from(invitations)
        .leftJoin(users, eq(invitations.ownerId, users.id))
        .where(predicate);
      const rows = await tx
        .select({
          id: invitations.id,
          slug: invitations.slug,
          status: invitations.status,
          owner_id: invitations.ownerId,
          owner_email: users.email,
          owner_name: users.fullName,
          template_version_id: invitations.templateVersionId,
          template_name: templates.name,
          version: templateVersions.version,
          published_at: invitations.publishedAt,
          expiry_date: invitations.expiryDate,
          created_at: invitations.createdAt,
        })
        .from(invitations)
        .leftJoin(users, eq(invitations.ownerId, users.id))
        .leftJoin(
          templateVersions,
          eq(invitations.templateVersionId, templateVersions.id),
        )
        .leftJoin(templates, eq(templateVersions.templateId, templates.id))
        .where(predicate)
        .orderBy(desc(invitations.createdAt), invitations.id)
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);
      await tx.insert(auditLogs).values([
        {
          adminId: bypass.adminId,
          action: "invitation.admin_search",
          resourceType: "invitation_search",
          resourceId: bypass.adminId,
          reason: bypass.reason,
          afterState: {
            page: query.page,
            count: rows.length,
            total: Number(total?.count ?? 0),
          },
        },
        ...rows.map((row) => ({
          adminId: bypass.adminId,
          action: "invitation.admin_read",
          resourceType: "invitation",
          resourceId: row.id,
          reason: bypass.reason,
          afterState: { surface: "list" },
        })),
      ]);
      return {
        data: rows,
        meta: {
          page: query.page,
          per_page: query.limit,
          total: Number(total?.count ?? 0),
        },
      };
    });
  }

  async getInvitationById(
    adminId: string,
    reason: string,
    invitationId: string,
  ) {
    const invitation = await this.repo.adminFindInvitationBypassingOwnership(
      invitationId,
      adminBypass(adminId, reason),
    );
    if (!invitation) throw new NotFoundError("Undangan tidak ditemukan.");
    const [owner, version, orderHistory, statusHistory, completeness] =
      await Promise.all([
        this.db
          .select({ email: users.email, full_name: users.fullName })
          .from(users)
          .where(eq(users.id, invitation.ownerId))
          .limit(1),
        this.db
          .select({
            id: templateVersions.id,
            version: templateVersions.version,
            name: templates.name,
          })
          .from(templateVersions)
          .leftJoin(templates, eq(templateVersions.templateId, templates.id))
          .where(eq(templateVersions.id, invitation.templateVersionId))
          .limit(1),
        this.db
          .select({
            id: orders.id,
            package_id: orders.packageId,
            amount_total: orders.amountTotal,
            status: orders.status,
            created_at: orders.createdAt,
          })
          .from(orders)
          .where(eq(orders.invitationId, invitationId))
          .orderBy(desc(orders.createdAt), orders.id),
        this.db
          .select({
            from_status: invitationStatusHistory.fromStatus,
            to_status: invitationStatusHistory.toStatus,
            changed_at: invitationStatusHistory.createdAt,
          })
          .from(invitationStatusHistory)
          .where(eq(invitationStatusHistory.invitationId, invitationId))
          .orderBy(invitationStatusHistory.createdAt),
        // The owner scope is derived only from the invitation already read through
        // the audited admin bypass. Return completeness metadata, never its content.
        this.publishCheck.check(tenantScope(invitation.ownerId), invitationId, {
          strict: true,
        }),
      ]);
    return {
      id: invitation.id,
      slug: invitation.slug,
      status: invitation.status,
      owner: {
        id: invitation.ownerId,
        email: owner[0]?.email ?? null,
        full_name: owner[0]?.full_name ?? null,
      },
      template_version: version[0] ?? {
        id: invitation.templateVersionId,
        version: null,
        name: null,
      },
      published_at: invitation.publishedAt,
      expiry_date: invitation.expiryDate,
      created_at: invitation.createdAt,
      updated_at: invitation.updatedAt,
      order_history: orderHistory.map((order) => ({
        ...order,
        amount_total: order.amount_total.toString(),
      })),
      status_history: statusHistory,
      validation_summary: {
        ready: completeness.ready,
        missing_required_fields: completeness.details.length,
        incomplete_sections: completeness.incomplete_sections,
      },
    };
  }
}
