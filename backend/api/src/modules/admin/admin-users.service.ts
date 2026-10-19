import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { DB, type Database } from "../../infra/db/client";
import { users, refreshTokens } from "../../infra/db/schema/users";
import { invitations } from "../../infra/db/schema/invitations";
import { orders } from "../../infra/db/schema/orders";
import { AuditLogService } from "../../shared/audit/audit-log.service";
import { NotFoundError } from "../../http/errors";
import type { AdminUserQueryDto } from "./schemas/admin-user.schema";

/**
 * P5-06: Admin User Management Service.
 * docs/PLAN/12 § User Management & docs/API/09 § User Management
 */
@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auditLogs: AuditLogService,
  ) {}

  async listUsers(query: AdminUserQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [isNull(users.deletedAt)];

    if (query.status && query.status !== "all") {
      conditions.push(eq(users.status, query.status));
    }

    if (query.search && query.search.trim().length > 0) {
      const pattern = `%${query.search.trim()}%`;
      conditions.push(
        or(
          ilike(users.email, pattern),
          ilike(users.fullName, pattern),
        )!,
      );
    }

    const whereClause = and(...conditions);

    const [totalRow] = await this.db
      .select({ count: count() })
      .from(users)
      .where(whereClause);
    const total = Number(totalRow?.count ?? 0);

    const userRows = await this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        role: users.role,
        status: users.status,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(whereClause)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    const userIds = userRows.map((u) => u.id);

    // Aggregate invitation counts
    const invitationCountMap = new Map<string, number>();
    if (userIds.length > 0) {
      const invCounts = await this.db
        .select({
          ownerId: invitations.ownerId,
          total: count(),
        })
        .from(invitations)
        .where(
          and(
            inArray(invitations.ownerId, userIds),
            isNull(invitations.deletedAt),
          ),
        )
        .groupBy(invitations.ownerId);

      for (const row of invCounts) {
        if (row.ownerId) {
          invitationCountMap.set(row.ownerId, Number(row.total));
        }
      }
    }

    // Aggregate order counts
    const orderCountMap = new Map<string, number>();
    if (userIds.length > 0) {
      const ordCounts = await this.db
        .select({
          userId: orders.userId,
          total: count(),
        })
        .from(orders)
        .where(inArray(orders.userId, userIds))
        .groupBy(orders.userId);

      for (const row of ordCounts) {
        if (row.userId) {
          orderCountMap.set(row.userId, Number(row.total));
        }
      }
    }

    const data = userRows.map((u) => ({
      ...u,
      invitationCount: invitationCountMap.get(u.id) ?? 0,
      orderCount: orderCountMap.get(u.id) ?? 0,
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

  async getUser(id: string) {
    const [user] = await this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        role: users.role,
        status: users.status,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      throw new NotFoundError(`User "${id}" not found.`);
    }

    const userInvitations = await this.db
      .select({
        id: invitations.id,
        slug: invitations.slug,
        internalName: invitations.internalName,
        status: invitations.status,
        templateId: invitations.templateId,
        templateVersionId: invitations.templateVersionId,
        publishedAt: invitations.publishedAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.ownerId, id),
          isNull(invitations.deletedAt),
        ),
      )
      .orderBy(desc(invitations.createdAt));

    const userOrders = await this.db
      .select({
        id: orders.id,
        packageId: orders.packageId,
        amountTotal: orders.amountTotal,
        status: orders.status,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.userId, id))
      .orderBy(desc(orders.createdAt));

    return {
      ...user,
      invitations: userInvitations,
      orders: userOrders.map((o) => ({
        ...o,
        amountTotal: o.amountTotal.toString(),
      })),
    };
  }

  async suspendUser(
    adminUser: { id: string },
    id: string,
    reason: string,
  ) {
    return await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          status: users.status,
          role: users.role,
        })
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1);

      if (!existing) {
        throw new NotFoundError(`User "${id}" not found.`);
      }

      const [updated] = await tx
        .update(users)
        .set({
          status: "suspended",
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          status: users.status,
          role: users.role,
          updatedAt: users.updatedAt,
        });

      // Revoke all active refresh tokens for the user
      await tx
        .update(refreshTokens)
        .set({
          revokedAt: new Date(),
        })
        .where(
          and(
            eq(refreshTokens.userId, id),
            isNull(refreshTokens.revokedAt),
          ),
        );

      await this.auditLogs.record(tx, {
        adminId: adminUser.id,
        action: "user.suspend",
        resourceType: "user",
        resourceId: id,
        reason,
        beforeState: existing as unknown as Record<string, unknown>,
        afterState: updated as unknown as Record<string, unknown>,
      });

      return updated;
    });
  }

  async unsuspendUser(
    adminUser: { id: string },
    id: string,
    reason: string,
  ) {
    return await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          status: users.status,
          role: users.role,
        })
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1);

      if (!existing) {
        throw new NotFoundError(`User "${id}" not found.`);
      }

      const [updated] = await tx
        .update(users)
        .set({
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          status: users.status,
          role: users.role,
          updatedAt: users.updatedAt,
        });

      await this.auditLogs.record(tx, {
        adminId: adminUser.id,
        action: "user.unsuspend",
        resourceType: "user",
        resourceId: id,
        reason,
        beforeState: existing as unknown as Record<string, unknown>,
        afterState: updated as unknown as Record<string, unknown>,
      });

      return updated;
    });
  }
}
