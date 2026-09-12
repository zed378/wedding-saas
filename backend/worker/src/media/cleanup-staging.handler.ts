import { parseStoredKey, type StoragePort } from "@wi/storage";

import { logger } from "../logger.js";
import type { MediaRepository } from "./media-repository.js";

/**
 * P1-18 step 8 — `media_cleanup_staging`, hourly.
 *
 * `docs/BACKEND/04` § Cleanup: "staging files that fail/time out (e.g., a worker crash
 * without a chance to set the final status) are cleaned up by a separate scheduled job (e.g.,
 * staging files older than 1 hour with no final status are automatically deleted)".
 *
 * ## It queries the ROW, not the bucket
 *
 * A bucket listing cannot tell an upload that arrived ninety seconds ago from one stranded by
 * a crash — both are objects with a timestamp, and deleting by object age would race every
 * legitimate in-flight job. The `media` row carries `status` and `created_at`, so
 * "`processing` and older than an hour" is a question with an exact answer.
 *
 * ## It marks the row too
 *
 * Deleting the file and leaving the row `processing` would leave the owner polling a status
 * that can never change, and would leave the row occupying a quota slot for a photo that no
 * longer exists anywhere. `P1-17`'s quota counts non-`failed` rows, so marking it `failed`
 * is what gives the slot back.
 */

/** An hour, as `docs/BACKEND/04` § Cleanup states it. */
export const STRANDED_AFTER_MINUTES = 60;

export interface CleanupDeps {
  readonly repository: MediaRepository;
  readonly storage: StoragePort;
}

export function makeCleanupStagingHandler(deps: CleanupDeps) {
  return async function cleanupStaging(): Promise<void> {
    const stranded = await deps.repository.findStranded(STRANDED_AFTER_MINUTES);

    if (stranded.length === 0) {
      logger.debug(
        { context: { event: "media.cleanup_staging", count: 0 } },
        "no stranded uploads",
      );
      return;
    }

    let deleted = 0;
    for (const row of stranded) {
      // The row first. A crash between the two leaves an orphan object, which the next
      // hour's run cannot see any more -- but an orphan object costs storage, where a row
      // left `processing` costs the owner a quota slot and an explanation.
      await deps.repository.markFailed(row.id);

      try {
        await deps.storage.delete("staging", parseStoredKey(row.storagePath));
        deleted += 1;
      } catch (cause) {
        // Logged, not thrown: one unreachable object must not stop the sweep clearing the
        // rest, and the job is `deadLetter: false` precisely because it is safe to re-run.
        logger.warn(
          {
            context: {
              media_id: row.id,
              event: "media.cleanup_delete_failed",
              reason: cause instanceof Error ? cause.message : "unknown",
            },
          },
          "could not delete a stranded staging object",
        );
      }
    }

    logger.info(
      {
        context: {
          event: "media.cleanup_staging",
          stranded: stranded.length,
          deleted,
        },
      },
      "stranded uploads cleaned up",
    );
  };
}
