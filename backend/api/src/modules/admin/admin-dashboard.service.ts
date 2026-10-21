import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { users } from "../../infra/db/schema/users";
import {
  invitations,
  invitationGuestbook,
} from "../../infra/db/schema/invitations";
import { orders } from "../../infra/db/schema/orders";
import type { AdminDashboardQueryDto } from "./schemas/admin-dashboard.schema";

/**
 * P5-11: Dashboard Metrics Service.
 *
 * Aggregates operational KPIs for the admin dashboard. All queries are read-only
 * and use explicit column selection (no SELECT *).
 *
 * docs/API/09-ADMIN-API.md § Dashboard
 */
@Injectable()
export class AdminDashboardService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async getDashboardMetrics(_query: AdminDashboardQueryDto) {
    const [totalUsers, totalInvitations, activeInvitations, paidOrdersResult, pendingGuestbook] =
      await Promise.all([
        // Total registered users
        this.db.select({ count: count() }).from(users),

        // Total invitations (non-deleted)
        this.db
          .select({ count: count() })
          .from(invitations)
          .where(isNull(invitations.deletedAt)),

        // Published (active) invitations
        this.db
          .select({ count: count() })
          .from(invitations)
          .where(
            and(
              eq(invitations.status, "published"),
              isNull(invitations.deletedAt),
            ),
          ),

        // Paid orders count + revenue sum
        this.db
          .select({
            count: count(),
            total: sql<string>`coalesce(sum(${orders.amountTotal}), 0)`,
          })
          .from(orders)
          .where(eq(orders.status, "paid")),

        // Pending guestbook entries awaiting moderation
        this.db
          .select({ count: count() })
          .from(invitationGuestbook)
          .where(eq(invitationGuestbook.status, "pending")),
      ]);

    // Invitation status distribution
    const statusDistribution = await this.db
      .select({
        status: invitations.status,
        count: count(),
      })
      .from(invitations)
      .where(isNull(invitations.deletedAt))
      .groupBy(invitations.status);

    // Revenue by month (last 6 months)
    const revenueByMonth = await this.db
      .select({
        month: sql<string>`to_char(${orders.createdAt}, 'YYYY-MM')`,
        total: sql<string>`coalesce(sum(${orders.amountTotal}), 0)`,
      })
      .from(orders)
      .where(eq(orders.status, "paid"))
      .groupBy(sql`to_char(${orders.createdAt}, 'YYYY-MM')`)
      .orderBy(sql`to_char(${orders.createdAt}, 'YYYY-MM') desc`)
      .limit(6);

    // Recently joined users (for activity feed)
    const recentlyJoined = await this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(5);

    return {
      metrics: {
        totalUsers: totalUsers[0]?.count ?? 0,
        totalInvitations: totalInvitations[0]?.count ?? 0,
        activeInvitations: activeInvitations[0]?.count ?? 0,
        pendingGuestbook: pendingGuestbook[0]?.count ?? 0,
        totalRevenue: paidOrdersResult[0]?.total ?? "0",
        paidOrders: paidOrdersResult[0]?.count ?? 0,
      },
      statusDistribution: statusDistribution.map((s) => ({
        status: s.status,
        count: s.count,
      })),
      revenueByMonth: revenueByMonth.map((r) => ({
        month: r.month,
        total: r.total,
      })),
      recentlyJoined,
    };
  }
}

