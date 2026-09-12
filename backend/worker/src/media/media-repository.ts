import type { Pool } from "pg";

/**
 * P1-18 — the worker's only database access.
 *
 * ## Raw SQL, and why
 *
 * The worker has never had a database connection. The alternatives were to import
 * `backend/api/src/infra/db/schema` — the first cross-application import in the repository,
 * from a package this one does not depend on — or to extract the schema into a shared
 * package, which is a Phase 2 refactor and not something to do inside a media task.
 *
 * So: one table, four statements, one file, every one of them addressed by primary key. The
 * cost is that two places now know the `media` columns, and the thing that pays for it is
 * `media-process.itest.ts`, which runs this SQL against the real migrated schema. A column
 * rename that missed this file fails there rather than in production.
 *
 * ## No tenant scope, deliberately
 *
 * A worker has no request and no user. The ownership check happened in `P1-17` before the
 * job was enqueued; re-deriving it here from a `media_id` would be theatre — there is nobody
 * to check the row against.
 */

export interface MediaJobRow {
  readonly id: string;
  readonly invitationId: string | null;
  readonly storagePath: string;
  readonly status: string;
}

export class MediaRepository {
  constructor(private readonly pool: Pool) {}

  /** The row this job is about, or `null` if it was hard-deleted meanwhile. */
  async find(mediaId: string): Promise<MediaJobRow | null> {
    const { rows } = await this.pool.query<{
      id: string;
      invitation_id: string | null;
      storage_path: string;
      status: string;
    }>(
      "SELECT id, invitation_id, storage_path, status FROM media WHERE id = $1",
      [mediaId],
    );

    const row = rows[0];
    if (row === undefined) return null;

    return {
      id: row.id,
      invitationId: row.invitation_id,
      storagePath: row.storage_path,
      status: row.status,
    };
  }

  /**
   * Publish: `ready`, with the dimensions and the byte count of the retained variant, and
   * `storage_path` moved from the staging key to the permanent prefix.
   *
   * The `WHERE status = 'processing'` is not decoration. A retry that raced with a
   * completed first run would otherwise rewrite a `ready` row, and a row that was set
   * `failed` by an earlier decision must not be quietly resurrected by a late worker.
   */
  async markReady(
    mediaId: string,
    values: {
      readonly storagePath: string;
      readonly width: number;
      readonly height: number;
      readonly sizeBytes: number;
    },
  ): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE media
          SET status = 'ready', storage_path = $2, width = $3, height = $4, size_bytes = $5
        WHERE id = $1 AND status = 'processing'`,
      [
        mediaId,
        values.storagePath,
        values.width,
        values.height,
        values.sizeBytes,
      ],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Refuse: `failed`.
   *
   * The reason is **not** written to the row. `docs/BACKEND/04` Stage 2 step 9 says to log
   * the technical reason for debugging while the user is shown a generic message, and a
   * column would be read by a UI sooner or later — at which point "clamav: Eicar-Test
   * -Signature FOUND" is on a customer's screen.
   */
  async markFailed(mediaId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      "UPDATE media SET status = 'failed' WHERE id = $1 AND status = 'processing'",
      [mediaId],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Media rows still `processing` after `olderThanMinutes`, for the hourly staging sweep.
   *
   * `docs/BACKEND/04` § Cleanup: "staging files older than 1 hour with no final status are
   * automatically deleted". The row is what is queried rather than the bucket, because a
   * bucket listing cannot tell an in-flight upload from a stranded one and the row's age can.
   */
  async findStranded(olderThanMinutes: number): Promise<MediaJobRow[]> {
    const { rows } = await this.pool.query<{
      id: string;
      invitation_id: string | null;
      storage_path: string;
      status: string;
    }>(
      `SELECT id, invitation_id, storage_path, status
         FROM media
        WHERE status = 'processing'
          AND created_at < now() - make_interval(mins => $1)`,
      [olderThanMinutes],
    );

    return rows.map((row) => ({
      id: row.id,
      invitationId: row.invitation_id,
      storagePath: row.storage_path,
      status: row.status,
    }));
  }
}
