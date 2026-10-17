import { Inject, Injectable } from "@nestjs/common";
import { mediaKey, type StoragePort } from "@wi/storage";

import { STORAGE } from "../../infra/storage/storage.module";
import { InvitationStatusService } from "../../shared/invitation-status/invitation-status.service";
import { logger } from "../../shared/logging/logger";
import { metrics } from "../../shared/metrics/metrics";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";

/**
 * `P3-13` — `invitation_soft_delete_cleanup`, daily 01:00 WIB (`docs/BACKEND/08`).
 *
 * Implements the retention chain from BR-9.1 and orphan cleanup from P1-19:
 * 1. Expired for >= 90 days without renewal -> soft delete (`expired → soft_deleted`), deleted_at set.
 * 2. Soft-deleted for >= 30 days -> hard delete row from DB and purge storage files from `user-media`.
 * 3. Individually soft-deleted gallery photos older than 7 days grace period (PLAN/11 § Deletion, P1-19) ->
 *    purge physical storage files and delete media rows.
 *
 * Runs inside the API's jobs process (`api-jobs`, ADR-078).
 */
@Injectable()
export class InvitationRetentionService {
  constructor(
    private readonly repository: InvitationRepository,
    private readonly status: InvitationStatusService,
    @Inject(STORAGE) private readonly storage: StoragePort,
  ) {}

  async sweep(): Promise<{
    softDeletedInvitations: number;
    hardDeletedInvitations: number;
    cleanedOrphanedMedia: number;
  }> {
    const softDeletedInvitations = await this.sweepSoftDelete();
    const hardDeletedInvitations = await this.sweepHardDelete();
    const cleanedOrphanedMedia = await this.cleanupOrphanedMedia();

    return {
      softDeletedInvitations,
      hardDeletedInvitations,
      cleanedOrphanedMedia,
    };
  }

  /**
   * Step 1: `expired` for >= 90 days without renewal -> transition to `soft_deleted`.
   */
  async sweepSoftDelete(olderThanDays = 90, limit = 100): Promise<number> {
    const expiredList = await this.repository.expiredInvitationsForSoftDelete(
      olderThanDays,
      limit,
    );
    let count = 0;

    for (const item of expiredList) {
      try {
        await this.repository.transaction(async (tx) => {
          await this.status.transitionWithin(
            tx,
            item.id,
            "soft_deleted",
            { kind: "SYSTEM", userId: null },
            "90 days without renewal, BR-9.1",
          );
          await this.repository.markSoftDeleted(tx, item.id);
        });

        count++;
        metrics.invitationsSoftDeleted.inc();
        logger.info(
          {
            context: {
              event: "invitation.retention.soft_deleted",
              invitation_id: item.id,
            },
          },
          "invitation moved to soft_deleted by retention sweep",
        );
      } catch (error) {
        logger.error(
          {
            context: {
              event: "invitation.retention.soft_delete_failed",
              invitation_id: item.id,
              error: error instanceof Error ? error.message : String(error),
            },
          },
          "failed to soft delete invitation in retention sweep",
        );
      }
    }

    return count;
  }

  /**
   * Step 2: `soft_deleted` for >= 30 days -> purge media from object storage and hard delete from DB.
   */
  async sweepHardDelete(olderThanDays = 30, limit = 50): Promise<number> {
    const softDeletedList =
      await this.repository.softDeletedInvitationsForHardDelete(
        olderThanDays,
        limit,
      );
    let count = 0;

    for (const item of softDeletedList) {
      try {
        const mediaItems = await this.repository.findMediaForInvitation(item.id);
        for (const m of mediaItems) {
          for (const variant of ["thumbnail", "medium", "large"] as const) {
            try {
              await this.storage.delete(
                "user-media",
                mediaKey(m.invitationId, m.id, variant),
              );
            } catch (storageErr) {
              logger.warn(
                {
                  context: {
                    event: "invitation.retention.storage_delete_warn",
                    invitation_id: item.id,
                    media_id: m.id,
                    variant,
                    error:
                      storageErr instanceof Error
                        ? storageErr.message
                        : String(storageErr),
                  },
                },
                "failed to delete media variant from storage during hard delete",
              );
            }
          }
        }

        await this.repository.transaction(async (tx) => {
          await this.repository.hardDeleteInvitation(tx, item.id);
        });

        count++;
        metrics.invitationsHardDeleted.inc();
        logger.info(
          {
            context: {
              event: "invitation.retention.hard_deleted",
              invitation_id: item.id,
              media_purged_count: mediaItems.length,
            },
          },
          "invitation and storage objects permanently deleted by retention sweep",
        );
      } catch (error) {
        logger.error(
          {
            context: {
              event: "invitation.retention.hard_delete_failed",
              invitation_id: item.id,
              error: error instanceof Error ? error.message : String(error),
            },
          },
          "failed to hard delete invitation in retention sweep",
        );
      }
    }

    return count;
  }

  /**
   * Step 3 (owed by `P1-19`, `docs/PLAN/11` § Deletion):
   * Individually soft-deleted gallery photos older than 7 days grace period ->
   * purge physical storage files and delete media rows.
   */
  async cleanupOrphanedMedia(olderThanDays = 7, limit = 100): Promise<number> {
    const orphanedList = await this.repository.orphanedSoftDeletedMedia(
      olderThanDays,
      limit,
    );
    let count = 0;

    for (const m of orphanedList) {
      try {
        for (const variant of ["thumbnail", "medium", "large"] as const) {
          try {
            await this.storage.delete(
              "user-media",
              mediaKey(m.invitationId, m.id, variant),
            );
          } catch (storageErr) {
            logger.warn(
              {
                context: {
                  event: "media.cleanup.storage_delete_warn",
                  invitation_id: m.invitationId,
                  media_id: m.id,
                  variant,
                  error:
                    storageErr instanceof Error
                      ? storageErr.message
                      : String(storageErr),
                },
              },
              "failed to delete orphaned media variant from storage",
            );
          }
        }

        await this.repository.transaction(async (tx) => {
          await this.repository.hardDeleteMedia(tx, m.id);
        });

        count++;
        metrics.mediaOrphansCleaned.inc();
        logger.info(
          {
            context: {
              event: "media.cleanup.orphaned_deleted",
              invitation_id: m.invitationId,
              media_id: m.id,
            },
          },
          "orphaned soft-deleted media permanently deleted",
        );
      } catch (error) {
        logger.error(
          {
            context: {
              event: "media.cleanup.orphaned_delete_failed",
              media_id: m.id,
              error: error instanceof Error ? error.message : String(error),
            },
          },
          "failed to delete orphaned media in cleanup sweep",
        );
      }
    }

    return count;
  }
}
