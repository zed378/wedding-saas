import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { CACHE, type CachePort } from "../../infra/cache/cache.port";
import { DB, type Database } from "../../infra/db/client";
import type { AdminDashboardQueryDto } from "./schemas/admin-dashboard.schema";

export interface AdminDashboardSummary {
  generated_at: string;
  timezone: "UTC";
  revenue_basis: "paid_orders_amount_total_by_created_at_excluding_refunds";
  total_users: number;
  total_invitations: number;
  paid_orders: number;
  total_revenue: string;
  daily_revenue: string;
  monthly_revenue: string;
  invitations_by_status: Array<{ status: string; count: number }>;
  orders_by_day: Array<{ date: string; count: number; revenue: string }>;
  revenue_by_month: Array<{ month: string; revenue: string }>;
  funnel: { created: number; ever_paid: number; paid_and_published: number };
}

/** Aggregates only: customer content and payment payloads never enter the response. */
@Injectable()
export class AdminDashboardService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CACHE) private readonly cache: CachePort,
  ) {}

  async getDashboardMetrics(
    _query: AdminDashboardQueryDto,
  ): Promise<AdminDashboardSummary> {
    const key = new Date().toISOString().slice(0, 10);
    const cached = await this.cache.getJson<AdminDashboardSummary>(
      "admin-dashboard",
      key,
    );
    if (cached) return cached;
    // A single statement gives all metrics the same snapshot. Refunded orders no
    // longer have status paid, so subtracting refunds again would count them twice.
    const result = await this.db.execute<{
      summary: AdminDashboardSummary;
    }>(sql`
      WITH live_invitations AS (
        SELECT id, status, published_at FROM invitations WHERE deleted_at IS NULL
      ), paid AS (
        SELECT amount_total, created_at AT TIME ZONE 'UTC' AS created_at
        FROM orders WHERE status = 'paid'
      ), paid_invitations AS (
        SELECT DISTINCT invitation_id FROM orders WHERE status IN ('paid', 'refunded')
      ), daily AS (
        SELECT to_char(day, 'YYYY-MM-DD') AS date,
          (SELECT count(*)::int FROM orders o
            WHERE o.created_at >= day AT TIME ZONE 'UTC'
              AND o.created_at < (day + interval '1 day') AT TIME ZONE 'UTC') AS count,
          (SELECT coalesce(sum(amount_total), 0)::text FROM paid p
            WHERE p.created_at >= day AND p.created_at < day + interval '1 day') AS revenue
        FROM generate_series(date_trunc('day', now() AT TIME ZONE 'UTC') - interval '29 days',
          date_trunc('day', now() AT TIME ZONE 'UTC'), interval '1 day') day
      ), monthly AS (
        SELECT to_char(month, 'YYYY-MM') AS month,
          (SELECT coalesce(sum(amount_total), 0)::text FROM paid p
            WHERE p.created_at >= month AND p.created_at < month + interval '1 month') AS revenue
        FROM generate_series(date_trunc('month', now() AT TIME ZONE 'UTC') - interval '5 months',
          date_trunc('month', now() AT TIME ZONE 'UTC'), interval '1 month') month
      )
      SELECT json_build_object(
        'generated_at', now(), 'timezone', 'UTC',
        'revenue_basis', 'paid_orders_amount_total_by_created_at_excluding_refunds',
        'total_users', (SELECT count(*)::int FROM users),
        'total_invitations', (SELECT count(*)::int FROM live_invitations),
        'paid_orders', (SELECT count(*)::int FROM paid),
        'total_revenue', (SELECT coalesce(sum(amount_total), 0)::text FROM paid),
        'daily_revenue', (SELECT coalesce(sum(amount_total), 0)::text FROM paid
          WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')),
        'monthly_revenue', (SELECT coalesce(sum(amount_total), 0)::text FROM paid
          WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC')),
        'invitations_by_status', (SELECT coalesce(json_agg(s ORDER BY status), '[]'::json)
          FROM (SELECT status, count(*)::int AS count FROM live_invitations GROUP BY status) s),
        'orders_by_day', (SELECT json_agg(d ORDER BY date) FROM daily d),
        'revenue_by_month', (SELECT json_agg(m ORDER BY month) FROM monthly m),
        'funnel', json_build_object(
          'created', (SELECT count(*)::int FROM live_invitations),
          'ever_paid', (SELECT count(*)::int FROM live_invitations i JOIN paid_invitations p ON p.invitation_id = i.id),
          'paid_and_published', (SELECT count(*)::int FROM live_invitations i JOIN paid_invitations p ON p.invitation_id = i.id WHERE i.published_at IS NOT NULL)
        )
      ) AS summary
    `);
    const summary = result.rows[0]!.summary;
    await this.cache.setJson("admin-dashboard", key, summary, 30);
    return summary;
  }
}
