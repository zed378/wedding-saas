import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Redis as IORedis } from "ioredis";

import { CACHE_REDIS } from "../../infra/cache/cache.module";
import {
  AnalyticsRepository,
  type ViewCountEntry,
} from "../../shared/tenancy/analytics-repository";
import { PublicInvitationRepository } from "../../shared/tenancy/public-invitation-repository";
import { NotFoundError } from "../../http/errors";
import { logger } from "../../shared/logging/logger";
import { metrics } from "../../shared/metrics/metrics";

export const PENDING_VIEWS_HASH = "analytics:views:pending";
export const FLUSHING_VIEWS_PREFIX = "analytics:views:flushing:";

export interface FlushResult {
  readonly flushed: number;
  readonly entries: number;
}

/**
 * `P4-09` — Page view counter with write-behind flush.
 *
 * Implements `docs/PLAN/14-ANALYTICS.md` & `docs/DATABASE/11-ANALYTICS.md`:
 * - Public page requests increment an in-memory Redis hash counter.
 * - Zero primary database writes happen synchronously during page view requests.
 * - Scheduled domain job `analytics_counter_flush` runs every minute to batch upsert
 *   accumulated view counts into `invitation_view_counts`.
 * - Flush failure is documented as best-effort.
 * - No per-visitor identity, IP, or user-agent data is stored anywhere.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(CACHE_REDIS) private readonly redis: IORedis,
    private readonly analyticsRepo: AnalyticsRepository,
    private readonly publicInvitationRepo: PublicInvitationRepository,
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
}
