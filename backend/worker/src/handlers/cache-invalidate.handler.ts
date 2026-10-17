import type { Redis } from "ioredis";

import { logger } from "../logger.js";

/**
 * P3-12 — Cache invalidation handler for the worker general pool.
 *
 * Deletes cached public invitation entries (slug pointer and versioned payload)
 * across generations in Redis.
 */
export interface CacheInvalidateData {
  readonly slug?: string | null;
  readonly invitationId?: string;
  readonly templateVersionId?: string;
  readonly reason?: string;
}

export function makeCacheInvalidateHandler(options: { readonly redis: Redis }) {
  return async (data: CacheInvalidateData): Promise<void> => {
    const { slug, invitationId, templateVersionId, reason } = data;

    logger.info(
      {
        context: {
          event: "cache.invalidate.processing",
          slug,
          invitation_id: invitationId,
          template_version_id: templateVersionId,
          reason,
        },
      },
      "processing cache invalidation",
    );

    const keysToDelete: string[] = [];

    if (slug) {
      const slugKeys = await options.redis.keys(
        `cache:public_invitation:*:slug:${slug}`,
      );
      keysToDelete.push(...slugKeys);
    }

    if (invitationId) {
      const pattern = templateVersionId
        ? `cache:public_invitation:*:${invitationId}:${templateVersionId}`
        : `cache:public_invitation:*:${invitationId}:*`;
      const invKeys = await options.redis.keys(pattern);
      keysToDelete.push(...invKeys);
    }

    if (keysToDelete.length > 0) {
      await options.redis.del(...keysToDelete);
    }

    logger.info(
      {
        context: {
          event: "cache.invalidate.done",
          deleted_count: keysToDelete.length,
          slug,
          invitation_id: invitationId,
        },
      },
      "cache invalidation completed",
    );
  };
}
