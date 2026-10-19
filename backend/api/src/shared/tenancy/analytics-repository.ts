import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { invitationViewCounts, invitations } from "../../infra/db/schema/invitations";
import type { TenantScope } from "./tenant-scope";

export interface ViewCountEntry {
  readonly invitationId: string;
  readonly viewDate: string; // YYYY-MM-DD
  readonly count: number;
}

export interface InvitationViewSummary {
  readonly totalViews: number;
  readonly dailyViews: ReadonlyArray<{ readonly date: string; readonly count: number }>;
}

/**
 * `P4-09`, `P4-10` — Tenant-scoped analytics repository.
 *
 * Manages daily aggregate view counts in `invitation_view_counts` per
 * `docs/DATABASE/11-ANALYTICS.md`.
 *
 * Synchronous writes never touch this table on visitor requests;
 * `recordBatch` is executed only by the scheduled flush job.
 * Reads (`getViewSummary`) enforce tenant ownership at the query level.
 */
@Injectable()
export class AnalyticsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Batch upserts accumulated view counts from Redis write-behind flush.
   * Uses ON CONFLICT DO UPDATE to ensure idempotent atomic accumulation.
   */
  async recordBatch(entries: readonly ViewCountEntry[]): Promise<number> {
    if (entries.length === 0) return 0;
    let total = 0;

    for (const entry of entries) {
      if (!entry.invitationId || !entry.viewDate || entry.count <= 0) continue;

      await this.db.execute(sql`
        INSERT INTO invitation_view_counts (invitation_id, view_date, view_count)
        VALUES (${entry.invitationId}, ${entry.viewDate}, ${entry.count})
        ON CONFLICT (invitation_id, view_date)
        DO UPDATE SET view_count = invitation_view_counts.view_count + EXCLUDED.view_count,
                      updated_at = now();
      `);
      total += entry.count;
    }

    return total;
  }

  /**
   * Reads view counts for an invitation, enforcing tenant ownership in SQL.
   * Returns total lifetime views and daily breakdown.
   */
  async getViewSummary(
    scope: TenantScope,
    invitationId: string,
  ): Promise<InvitationViewSummary> {
    const query = await this.db.execute<{ view_date: string; view_count: string }>(sql`
      SELECT vc.view_date::text, vc.view_count
      FROM invitation_view_counts vc
      JOIN invitations i ON i.id = vc.invitation_id
      WHERE vc.invitation_id = ${invitationId}
        AND i.owner_id = ${scope}
        AND i.deleted_at IS NULL
      ORDER BY vc.view_date DESC
    `);

    let total = 0;
    const daily: Array<{ date: string; count: number }> = [];

    for (const row of query.rows) {
      const count = Number(row.view_count);
      total += count;
      daily.push({ date: row.view_date, count });
    }

    return { totalViews: total, dailyViews: daily };
  }
}
