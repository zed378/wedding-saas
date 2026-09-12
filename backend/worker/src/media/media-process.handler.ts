import { mediaKey, parseStoredKey, type StoragePort } from "@wi/storage";

import type { JobContext } from "../runner.js";
import { logger } from "../logger.js";
import {
  scan as scanWithClamav,
  ScannerUnavailableError,
  type ClamavOptions,
  type ScanResult,
} from "./clamav.js";
import type { MediaRepository } from "./media-repository.js";
import { processImage, UnprocessableImageError } from "./process-image.js";

/**
 * P1-18 — `media.process`. `docs/BACKEND/04` Stage 2, in the order it gives.
 *
 * ## The one invariant
 *
 * **A file becomes `ready` only after it has been scanned, decoded and stripped.** Every
 * other decision in this file follows from protecting that sentence:
 *
 *   a scanner that cannot answer raises rather than returning `clean`;
 *   a scan failure is retried rather than being resolved into a verdict;
 *   the permanent bucket is written only after both the scan and the decode have passed;
 *   the row moves to `ready` only after the objects exist.
 *
 * ## Retry versus refuse
 *
 * These are different outcomes and conflating them is how an unscanned file gets published.
 *
 *   **Refuse** (`failed`, no retry): infected, undecodable, too large in pixels, no staging
 *     object. The answer will not change on a second attempt, and three retries of an
 *     infected file is three scans of a file already known to be hostile.
 *   **Retry** (throw): the scanner is unreachable, storage is down, the database is down.
 *     The file may well be fine and the environment is not.
 *
 * A retry that runs out of attempts still has to leave the row somewhere honest, or an
 * owner polls `processing` forever. On the **final** attempt a transient failure is written
 * as `failed` — the upload genuinely did not succeed — and the staging file is removed.
 *
 * ## Idempotency
 *
 * `docs/BACKEND/04` § Idempotency. Two guards, because they cover different things: the row
 * is checked for a non-`processing` status at the top, and every write is conditional on the
 * row still being `processing`. The object keys are deterministic, so a repeat run overwrites
 * byte-identical variants rather than accumulating files.
 */

export interface MediaProcessDeps {
  readonly repository: MediaRepository;
  readonly storage: StoragePort;
  /** `undefined` only where the scan has been explicitly disabled; see `main.ts`. */
  readonly clamav: ClamavOptions | undefined;
  /**
   * The scanner, injectable.
   *
   * Defaults to the real clamd client. It is a parameter because otherwise the **infected**
   * branch of this handler is only reachable by feeding real malware to a real container —
   * so in practice it would go untested, which is the branch that most needs a test. The
   * protocol itself is covered separately, by `media-unit.spec.ts` against the reply strings
   * and by `clamav.itest.ts` against a real clamd with the EICAR test file.
   */
  readonly scan?: (
    bytes: Uint8Array,
    options: ClamavOptions,
  ) => Promise<ScanResult>;
  /** Total attempts this job's policy allows, so the last one can be recognised. */
  readonly maxAttempts: number;
}

export interface MediaProcessData {
  readonly mediaId: string;
}

export function makeMediaProcessHandler(deps: MediaProcessDeps) {
  return async function mediaProcess(
    data: MediaProcessData,
    context: JobContext,
  ): Promise<void> {
    const { mediaId } = data;
    const isFinalAttempt = context.attempt >= deps.maxAttempts;

    const row = await deps.repository.find(mediaId);

    if (row === null) {
      // Hard-deleted between the upload and this job. Nothing to do and nothing wrong.
      logger.info(
        { context: { media_id: mediaId, event: "media.process.row_gone" } },
        "media row no longer exists",
      );
      return;
    }

    if (row.status !== "processing") {
      // A completed earlier run, or a decision already made. `docs/BACKEND/04`
      // § Idempotency: check existing state rather than reprocessing from scratch.
      logger.info(
        {
          context: {
            media_id: mediaId,
            event: "media.process.already_settled",
            status: row.status,
          },
        },
        "media already settled; nothing to do",
      );
      return;
    }

    if (row.invitationId === null) {
      // A template asset has no invitation and therefore no permanent path
      // (`mediaKey` requires one). It is not something this job can publish.
      await refuse(deps, row.id, row.storagePath, "no_invitation");
      return;
    }

    const stagingKey = parseStoredKey(row.storagePath);
    const staged = await deps.storage.get("staging", stagingKey);

    if (staged === null) {
      // The cleanup sweep got there first, or the write in `P1-17` never landed. Either
      // way there is no file, and there never will be.
      await refuse(deps, row.id, row.storagePath, "no_staging_object");
      return;
    }

    // --- step 2: the malware scan, before anything decodes the bytes -----------------
    if (deps.clamav !== undefined) {
      let result;
      try {
        result = await (deps.scan ?? scanWithClamav)(staged.body, deps.clamav);
      } catch (error) {
        if (!(error instanceof ScannerUnavailableError)) throw error;

        // Fail CLOSED. The file is not marked ready, and it is not marked clean either.
        if (isFinalAttempt) {
          await refuse(deps, row.id, row.storagePath, "scanner_unavailable");
          return;
        }
        throw error;
      }

      if (result.verdict === "infected") {
        // The signature name is the one detail an operator needs, and it describes the
        // malware rather than the customer.
        logger.warn(
          {
            context: {
              media_id: mediaId,
              invitation_id: row.invitationId,
              event: "media.infected",
              signature: result.signature,
            },
          },
          "malware detected in an upload",
        );
        await refuse(deps, row.id, row.storagePath, "infected");
        return;
      }
    }

    // --- steps 3 to 6: dimensions, decode, EXIF strip, variants ----------------------
    let processed;
    try {
      processed = await processImage(staged.body);
    } catch (error) {
      if (error instanceof UnprocessableImageError) {
        await refuse(
          deps,
          row.id,
          row.storagePath,
          error.reason,
          error.message,
        );
        return;
      }
      throw error;
    }

    // --- step 7: publish -------------------------------------------------------------
    for (const variant of processed.variants) {
      await deps.storage.put(
        "user-media",
        mediaKey(row.invitationId, row.id, variant.variant),
        variant.bytes,
        {
          contentType: "image/webp",
          // Immutable: the key carries the media id and the variant, so a replacement gets
          // a new id rather than overwriting this one (`docs/ARCHITECTURE/05` § CDN).
          cacheControl: "public, max-age=31536000, immutable",
          contentLength: variant.bytes.length,
        },
      );
    }

    // --- step 8: the row, then the staging file --------------------------------------
    const retained = processed.variants.find((v) => v.variant === "large")!;

    const published = await deps.repository.markReady(row.id, {
      // The permanent prefix of the retained variant. `docs/PLAN/11` calls `large` the
      // "capped original", and it is the one whose dimensions the row reports.
      storagePath: mediaKey(row.invitationId, row.id, "large"),
      width: retained.width,
      height: retained.height,
      sizeBytes: retained.bytes.length,
    });

    if (!published) {
      // Someone else settled the row while this run was working. The variants are
      // byte-identical at the same keys, so there is nothing to undo.
      logger.info(
        {
          context: { media_id: mediaId, event: "media.process.raced" },
        },
        "media row was settled by another run",
      );
      return;
    }

    // Only now. Deleting before the row was updated would leave a `processing` row with
    // nothing to retry from.
    await deleteStaging(deps, row.storagePath, mediaId);

    logger.info(
      {
        context: {
          media_id: mediaId,
          invitation_id: row.invitationId,
          related_id: row.invitationId,
          event: "media.ready",
          source_width: processed.sourceWidth,
          source_height: processed.sourceHeight,
          variant_count: processed.variants.length,
        },
      },
      "media processed and published",
    );
  };
}

/**
 * Mark the row `failed`, delete the staging file, and log why.
 *
 * The reason reaches the log and never the database — `docs/BACKEND/04` Stage 2 step 9 asks
 * for the technical reason to be logged "without exposing technical details to the end-user".
 * A `failure_reason` column would end up on a screen.
 */
async function refuse(
  deps: MediaProcessDeps,
  mediaId: string,
  storagePath: string,
  reason:
    | "infected"
    | "dimensions"
    | "undecodable"
    | "no_staging_object"
    | "no_invitation"
    | "scanner_unavailable",
  detail?: string,
): Promise<void> {
  await deps.repository.markFailed(mediaId);
  await deleteStaging(deps, storagePath, mediaId);

  logger.warn(
    {
      context: {
        media_id: mediaId,
        event: "media.failed",
        reason,
        ...(detail !== undefined ? { detail } : {}),
      },
    },
    "media processing refused",
  );
}

/**
 * Remove the staging object, tolerating its absence.
 *
 * A failure here is logged and swallowed: the row is already correct, and throwing would
 * retry a job whose work is done. The hourly sweep removes what is left.
 */
async function deleteStaging(
  deps: MediaProcessDeps,
  storagePath: string,
  mediaId: string,
): Promise<void> {
  try {
    await deps.storage.delete("staging", parseStoredKey(storagePath));
  } catch (cause) {
    logger.warn(
      {
        context: {
          media_id: mediaId,
          event: "media.staging_delete_failed",
          reason: cause instanceof Error ? cause.message : "unknown",
        },
      },
      "could not delete a staging object; the hourly sweep will",
    );
  }
}
