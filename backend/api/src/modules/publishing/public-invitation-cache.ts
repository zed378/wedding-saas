import { Inject, Injectable } from "@nestjs/common";

import { CACHE, type CachePort } from "../../infra/cache/cache.port";
import { metrics } from "../../shared/metrics/metrics";
import { Singleflight } from "../../shared/utils/singleflight";
import { logger } from "../../shared/logging/logger";
import type { PublicInvitationDto } from "./public-invitation.dto";

/**
 * P3-12 — Cache layer for public invitations.
 *
 * Implements `docs/ARCHITECTURE/06-CACHING-ARCHITECTURE.md`:
 * - Keyed on `invitation_id + template_version_id` (so template version changes don't serve stale cache)
 * - Slug pointer mapping: `slug:{slug}` -> `{ invitationId, templateVersionId }`
 * - Fallback TTL: 3600 seconds (1 hour)
 * - Singleflight stampede protection: collapses concurrent cold-cache misses into 1 origin DB render
 * - Event-driven invalidation: immediate cache deletion on updates/unpublish
 * - Observability: Prometheus cache hits/misses metrics
 */
export const PUBLIC_INVITATION_CACHE_NAMESPACE = "public_invitation";
const DEFAULT_TTL_SECONDS = 3600;

export interface SlugPointer {
  readonly invitationId: string;
  readonly templateVersionId: string;
}

@Injectable()
export class PublicInvitationCache {
  private readonly singleflight = new Singleflight();

  constructor(@Inject(CACHE) private readonly cache: CachePort) {}

  /**
   * Look up a public invitation by slug.
   * Resolves the slug pointer first, then loads the versioned payload.
   */
  async get(slug: string): Promise<PublicInvitationDto | undefined> {
    try {
      const pointer = await this.cache.getJson<SlugPointer>(
        PUBLIC_INVITATION_CACHE_NAMESPACE,
        `slug:${slug}`,
      );
      if (pointer === undefined) {
        return undefined;
      }

      const payload = await this.cache.getJson<PublicInvitationDto>(
        PUBLIC_INVITATION_CACHE_NAMESPACE,
        `${pointer.invitationId}:${pointer.templateVersionId}`,
      );
      return payload;
    } catch (error) {
      logger.warn(
        {
          context: {
            event: "cache.public_invitation.get_failed",
            slug,
            error: error instanceof Error ? error.name : "Unknown",
          },
        },
        "public invitation cache read failed; falling back to origin",
      );
      return undefined;
    }
  }

  /**
   * Cache both the slug pointer and the versioned invitation payload.
   */
  async set(
    slug: string,
    invitationId: string,
    templateVersionId: string,
    payload: PublicInvitationDto,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    try {
      await Promise.all([
        this.cache.setJson(
          PUBLIC_INVITATION_CACHE_NAMESPACE,
          `slug:${slug}`,
          { invitationId, templateVersionId },
          ttlSeconds,
        ),
        this.cache.setJson(
          PUBLIC_INVITATION_CACHE_NAMESPACE,
          `${invitationId}:${templateVersionId}`,
          payload,
          ttlSeconds,
        ),
      ]);
    } catch (error) {
      logger.warn(
        {
          context: {
            event: "cache.public_invitation.set_failed",
            slug,
            invitation_id: invitationId,
            error: error instanceof Error ? error.name : "Unknown",
          },
        },
        "public invitation cache write failed",
      );
    }
  }

  /**
   * Invalidate the cache for a slug or invitation.
   * Never throws.
   */
  async invalidate(options: {
    readonly slug?: string | null;
    readonly invitationId?: string;
    readonly templateVersionId?: string;
  }): Promise<void> {
    try {
      const ops: Promise<void>[] = [];
      if (options.slug) {
        ops.push(
          this.cache.delete(
            PUBLIC_INVITATION_CACHE_NAMESPACE,
            `slug:${options.slug}`,
          ),
        );
      }
      if (options.invitationId && options.templateVersionId) {
        ops.push(
          this.cache.delete(
            PUBLIC_INVITATION_CACHE_NAMESPACE,
            `${options.invitationId}:${options.templateVersionId}`,
          ),
        );
      }
      await Promise.all(ops);
      logger.info(
        {
          context: {
            event: "cache.public_invitation.invalidated",
            slug: options.slug,
            invitation_id: options.invitationId,
            template_version_id: options.templateVersionId,
          },
        },
        "public invitation cache entry invalidated",
      );
    } catch (error) {
      logger.warn(
        {
          context: {
            event: "cache.public_invitation.invalidate_failed",
            slug: options.slug,
            invitation_id: options.invitationId,
            error: error instanceof Error ? error.name : "Unknown",
          },
        },
        "public invitation cache invalidation failed",
      );
    }
  }

  /**
   * Execute under singleflight protection for the given key (slug).
   */
  async executeSingleflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.singleflight.do(key, fn);
  }

  recordHit(): void {
    metrics.publicInvitationCacheHits.inc();
  }

  recordMiss(): void {
    metrics.publicInvitationCacheMisses.inc();
  }
}
