import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Redis as IORedis } from "ioredis";

import { CACHE, type CachePort } from "../../infra/cache/cache.port";
import { CACHE_REDIS } from "../../infra/cache/cache.module";
import {
  AnalyticsRepository,
  type ViewCountEntry,
} from "../../shared/tenancy/analytics-repository";
import { PublicInvitationRepository } from "../../shared/tenancy/public-invitation-repository";
import { RsvpRepository } from "../../shared/tenancy/rsvp-repository";
import { GuestbookRepository } from "../../shared/tenancy/guestbook-repository";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import { NotFoundError } from "../../http/errors";
import { logger } from "../../shared/logging/logger";
import { metrics } from "../../shared/metrics/metrics";

export const PENDING_VIEWS_HASH = "analytics:views:pending";
export const FLUSHING_VIEWS_PREFIX = "analytics:views:flushing:";

export interface FlushResult {
  readonly flushed: number;
  readonly entries: number;
}

export interface AnalyticsSummary {
  readonly views: {
    readonly total: number;
    readonly daily: ReadonlyArray<{ readonly date: string; readonly count: number }>;
  };
  readonly rsvps: {
    readonly total_responses: number;
    readonly attending: number;
    readonly not_attending: number;
    readonly maybe: number;
    readonly total_attending_guests: number;
  };
  readonly guestbook: {
    readonly total: number;
    readonly pending: number;
    readonly approved: number;
    readonly rejected: number;
  };
}

/**
 * `P4-09`, `P4-10` — Analytics service: page view counter with write-behind flush
 * and owner analytics summary.
 *
 * Implements `docs/PLAN/14-ANALYTICS.md` & `docs/DATABASE/11-ANALYTICS.md`:
 * - Public page requests increment an in-memory Redis hash counter.
 * - Zero primary database writes happen synchronously during page view requests.
 * - Scheduled domain job `analytics_counter_flush` runs every minute to batch upsert
 *   accumulated view counts into `invitation_view_counts`.
 * - Flush failure is documented as best-effort.
 * - No per-visitor identity, IP, or user-agent data is stored anywhere.
 * - Owner summary queries are scoped by tenant ID and cached briefly (30s).
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(CACHE_REDIS) private readonly redis: IORedis,
    @Inject(CACHE) private readonly cache: CachePort,
    private readonly analyticsRepo: AnalyticsRepository,
    private readonly publicInvitationRepo: PublicInvitationRepository,
    private readonly rsvpRepo: RsvpRepository,
    private readonly guestbookRepo: GuestbookRepository,
  ) {}

  /**
   * Increments in-memory Redis counter for public page view.
   * Verifies the invitation is currently published. Fails open on Redis error.
   */
  async recordView(slug: string): Promise<{ recorded: boolean }> {
    const published = await this.publicInvitationRepo.findPublishedBySlug(slug);
    if (!published) {
      throw new NotFoundError("Invitation not found or not currently published");
    }

    const invitationId = published.invitation.id;
    // Daily grain in Asia/Jakarta timezone (WIB) per BR-Analytics-1
    const viewDate = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Jakarta",
    });

    const field = `${invitationId}:${viewDate}`;

    try {
      await this.redis.hincrby(PENDING_VIEWS_HASH, field, 1);
      metrics.pageViews.inc({ status: "recorded" });
      logger.debug(
        {
          context: {
            event: "analytics.view_recorded",
            slug,
            invitation_id: invitationId,
            date: viewDate,
          },
        },
        "recorded page view increment in Redis",
      );
      return { recorded: true };
    } catch (error) {
      // Degraded cache fails open: non-critical analytics never fail visitor request
      metrics.pageViews.inc({ status: "failed" });
      logger.warn(
        {
          context: {
            event: "analytics.view_record_failed",
            slug,
            invitation_id: invitationId,
            error: error instanceof Error ? error.message : "Unknown",
          },
        },
        "failed to increment view counter in Redis; failing open",
      );
      return { recorded: false };
    }
  }

  /**
   * Flushes accumulated Redis counters to PostgreSQL database via atomic rename.
   * Executed every minute by scheduled domain job `analytics_counter_flush`.
   * Best-effort: failures log and continue without failing the process.
   */
  async flushViewCounts(): Promise<FlushResult> {
    const batchId = randomUUID();
    const flushingKey = `${FLUSHING_VIEWS_PREFIX}${batchId}`;

    try {
      try {
        await this.redis.rename(PENDING_VIEWS_HASH, flushingKey);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("no such key")) {
          return { flushed: 0, entries: 0 };
        }
        throw err;
      }

      const entries = await this.redis.hgetall(flushingKey);
      const keys = Object.keys(entries);
      if (keys.length === 0) {
        await this.redis.del(flushingKey);
        return { flushed: 0, entries: 0 };
      }

      const batch: ViewCountEntry[] = [];
      for (const key of keys) {
        const [invitationId, viewDate] = key.split(":");
        const count = Number(entries[key] ?? 0);
        if (invitationId && viewDate && !isNaN(count) && count > 0) {
          batch.push({ invitationId, viewDate, count });
        }
      }

      const totalFlushed = await this.analyticsRepo.recordBatch(batch);
      await this.redis.del(flushingKey);

      metrics.analyticsFlush.inc({ status: "success" });
      logger.info(
        {
          context: {
            event: "analytics.flush_completed",
            flushed: totalFlushed,
            entries: batch.length,
          },
        },
        "flushed page view counter batch to database",
      );

      return { flushed: totalFlushed, entries: batch.length };
    } catch (error) {
      metrics.analyticsFlush.inc({ status: "failure" });
      logger.error(
        {
          context: {
            event: "analytics.flush_failed",
            error: error instanceof Error ? error.message : "Unknown",
          },
        },
        "best-effort page view flush to database failed",
      );
      return { flushed: 0, entries: 0 };
    }
  }

  /**
   * Returns ownership-scoped analytics summary for an invitation (P4-10).
   * Aggregates total and daily page views, RSVP attendance stats, and guestbook counts.
   * Cached briefly (30s) to protect the DB from frequent owner reloads.
   * Throws NotFoundError if the invitation is not owned by the tenant.
   */
  async getAnalyticsSummary(
    scope: TenantScope,
    invitationId: string,
  ): Promise<AnalyticsSummary> {
    const cached = await this.cache.getJson<AnalyticsSummary>(
      "analytics",
      invitationId,
    );
    if (cached) {
      return cached;
    }

    const owns = await this.rsvpRepo.ownsInvitation(scope, invitationId);
    if (!owns) {
      throw new NotFoundError("Invitation not found");
    }

    const [viewSummary, rsvpSummary, guestbookSummary] = await Promise.all([
      this.analyticsRepo.getViewSummary(scope, invitationId),
      this.rsvpRepo.getRsvpSummaryForOwner(scope, invitationId),
      this.guestbookRepo.getGuestbookSummaryForOwner(scope, invitationId),
    ]);

    // Check for today's unflushed in-memory Redis views
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Jakarta",
    });
    let pendingCount = 0;
    try {
      const pendingStr = await this.redis.hget(
        PENDING_VIEWS_HASH,
        `${invitationId}:${today}`,
      );
      pendingCount = Number(pendingStr ?? 0) || 0;
    } catch {
      // Degraded cache fails open
    }

    const daily = [...viewSummary.dailyViews];
    let totalViews = viewSummary.totalViews + pendingCount;
    if (pendingCount > 0) {
      const todayIndex = daily.findIndex((d) => d.date === today);
      if (todayIndex >= 0) {
        daily[todayIndex] = {
          date: today,
          count: daily[todayIndex]!.count + pendingCount,
        };
      } else {
        daily.unshift({ date: today, count: pendingCount });
      }
    }

    const summary: AnalyticsSummary = {
      views: {
        total: totalViews,
        daily,
      },
      rsvps: rsvpSummary ?? {
        total_responses: 0,
        attending: 0,
        not_attending: 0,
        maybe: 0,
        total_attending_guests: 0,
      },
      guestbook: guestbookSummary ?? {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
      },
    };

    // Cache briefly (30 seconds)
    await this.cache.setJson("analytics", invitationId, summary, 30);

    return summary;
  }
}
