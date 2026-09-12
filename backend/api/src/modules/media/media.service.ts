import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  mediaKey,
  stagingKey,
  type StoragePort,
  StorageError,
} from "@wi/storage";

import { STORAGE } from "../../infra/storage/storage.module";
import { JOB_QUEUE, type JobQueue } from "../../infra/queue/queue.module";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import { NotFoundError, ValidationError } from "../../http/errors";
import { logger } from "../../shared/logging/logger";
import { requireOwnership } from "../../shared/auth-middleware";
import {
  InvitationRepository,
  type MediaRow,
} from "../../shared/tenancy/invitation-repository";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import {
  canonicalMimeType,
  contentTypeAgrees,
  detectFormat,
  hasAllowedExtension,
} from "./file-format";

/**
 * P1-17 — Stage 1 of `docs/BACKEND/04-FILE-PROCESSING.md`, inside the request.
 *
 * ## What this stage is for
 *
 * Deciding, cheaply, whether these bytes are worth handing to a decoder. Nothing here decodes
 * an image, scans it, or reads past the first twelve bytes. `docs/SECURITY/06`'s layers 6, 7,
 * 10 and 11 — decompression-bomb limits, EXIF stripping, malware scanning, variant
 * generation — all happen in `P1-18`'s worker, in a resource-capped container, because they
 * are the expensive and dangerous half and must not run in a web request.
 *
 * Stating that plainly matters, because the natural misreading of "the upload endpoint
 * validates the file" is that a file which reaches `processing` has been checked. It has
 * been checked for three things: its name ends in a permitted extension, its first bytes are
 * a permitted image signature, and it is under 10 MB. A crafted PNG that decodes to
 * 40,000 x 40,000 pixels passes all three.
 *
 * ## The order of operations, and why it is that order
 *
 * 1. Validate the bytes — free, and it means a rejected upload never touches the database.
 * 2. Generate the media id **here**, not in the database. The object must be named before it
 *    is stored, and `stagingKey()` only accepts a UUID.
 * 3. Insert the row inside the quota transaction, which holds a lock on the invitation row.
 * 4. Store the bytes, **after** the transaction commits. Holding a database lock across a
 *    network write to object storage would make every upload to one invitation wait for the
 *    slowest thing in the request.
 *
 * Step 4 failing leaves a committed row with no object, which is why the failure path marks
 * it `failed` rather than leaving it `processing` forever.
 */

/** BR-8.1 and `docs/PLAN/11` § Limits per Package. Uniform: there is one package (ADR-023). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_INVITATION = 200;

/** `docs/API/05`: `purpose: cover|gallery|profile`. */
export type MediaPurpose = "cover" | "gallery" | "profile";

/**
 * The parts of a parsed multipart file this service uses.
 *
 * Declared here rather than imported from `@types/multer`, which is not a dependency:
 * `@nestjs/platform-express` bundles the interceptor's own types but not the file's. Naming
 * only the four fields that are read also documents the surface — in particular that
 * `originalname` is used for one decision and never for a path.
 */
export interface UploadedFilePart {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

export interface UploadedMediaDto {
  readonly id: string;
  readonly status: string;
  readonly purpose: string;
}

export interface MediaDetailDto extends UploadedMediaDto {
  readonly url?: string;
  readonly thumbnail_url?: string;
  readonly width?: number | null;
  readonly height?: number | null;
}

@Injectable()
export class MediaService {
  constructor(
    private readonly repository: InvitationRepository,
    @Inject(STORAGE) private readonly storage: StoragePort,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async upload(
    scope: TenantScope,
    invitationId: string,
    purpose: MediaPurpose,
    file: UploadedFilePart,
  ): Promise<UploadedMediaDto> {
    const format = this.validateBytes(scope, invitationId, file);

    // The id names the object, so it is generated before anything is stored. `stagingKey`
    // accepts nothing but a UUID, which is what makes `docs/SECURITY/06` layer 8 —
    // "the original filename is NOT used as the storage path" — structural rather than
    // remembered. There is no code path here that could interpolate `originalname`.
    const mediaId = randomUUID();
    const key = stagingKey(mediaId);

    const row = await this.repository.insertMediaWithinQuota(
      invitationId,
      scope,
      {
        mediaId,
        purpose,
        storagePath: key,
        mimeType: canonicalMimeType(format),
        sizeBytes: file.size,
        maxPhotos: MAX_PHOTOS_PER_INVITATION,
      },
    );

    if (row === null) {
      // Not this scope's invitation, soft-deleted, or never existed. No row was inserted and
      // nothing has been stored — the card's DoD asks for exactly that.
      throw new NotFoundError();
    }

    if (row === "quota_exceeded") {
      this.reject(scope, invitationId, "quota");
      throw new ValidationError(
        [
          {
            field: "file",
            message: `Undangan ini sudah memiliki ${String(MAX_PHOTOS_PER_INVITATION)} foto.`,
          },
        ],
        `Undangan ini sudah memiliki ${String(MAX_PHOTOS_PER_INVITATION)} foto. Hapus salah satu sebelum menambah yang baru.`,
        "QUOTA_EXCEEDED",
      );
    }

    try {
      await this.storage.put("staging", key, new Uint8Array(file.buffer), {
        contentType: canonicalMimeType(format),
        contentLength: file.size,
      });
    } catch (cause) {
      // The row is already committed. Leaving it `processing` would have the owner polling a
      // status that can never change, so it is marked `failed` and the error is rethrown.
      await this.repository.markMediaFailed(mediaId, scope);
      logger.error(
        {
          context: {
            invitation_id: invitationId,
            media_id: mediaId,
            user_id: scope,
            event: "media.staging_write_failed",
          },
        },
        "could not write an accepted upload to staging",
      );
      throw cause instanceof StorageError
        ? cause
        : new StorageError("could not store the upload", cause);
    }

    // After the object exists. A job that arrives first finds nothing and fails the upload
    // for a reason that has nothing to do with the file. `P0-15`'s producer swallows enqueue
    // failures by design, so the hourly staging cleanup (`docs/BACKEND/04` § Cleanup, owed by
    // `P1-18`) is the backstop for a lost job rather than this call's return value.
    await this.queue.enqueue("media", "media.process", { mediaId });

    logger.info(
      {
        context: {
          invitation_id: invitationId,
          media_id: mediaId,
          user_id: scope,
          event: "media.uploaded",
          purpose,
          size_bytes: file.size,
          detected_format: format,
          // Deliberately NOT the filename. It is attacker-controlled text that would then
          // sit in a log aggregator — `P1-04`'s lesson, applied before the fact.
        },
      },
      "media accepted into staging",
    );

    return { id: row.id, status: row.status, purpose: row.purpose };
  }

  /**
   * The endpoint the upload flow polls. `docs/API/05`, added by ADR-021.
   *
   * Ownership is the repository's join, not a comparison here — `docs/SECURITY/05` § 6.
   */
  async get(scope: TenantScope, mediaId: string): Promise<MediaDetailDto> {
    const row = await requireOwnership(
      () => this.repository.findOwnedMedia(mediaId, scope),
      { scope, resourceType: "media", resourceId: mediaId },
    );

    return this.toDetail(row);
  }

  /**
   * Three checks, cheapest first, exactly as `docs/BACKEND/04` Stage 1 orders them.
   *
   * All three failures raise the **same** code. Telling a caller which layer refused them is
   * telling an attacker which layer to work around next, and the distinction is of no use to
   * a legitimate user whose photo is simply not a jpg.
   */
  private validateBytes(
    scope: TenantScope,
    invitationId: string,
    file: UploadedFilePart,
  ): "jpeg" | "png" | "webp" {
    const invalid = (): never => {
      throw new ValidationError(
        [
          {
            field: "file",
            message: "Gunakan file gambar JPG, PNG, atau WebP.",
          },
        ],
        "Gunakan file gambar JPG, PNG, atau WebP.",
        "INVALID_FILE_TYPE",
      );
    };

    // Layer 4's framework half runs before this method — multer aborts the read at
    // MAX_FILE_BYTES. This is the belt to that brace, for a caller that reaches the service
    // some other way (a job, a test, a future internal caller).
    if (file.size > MAX_FILE_BYTES) {
      this.reject(scope, invitationId, "size");
      throw new ValidationError(
        [{ field: "file", message: "Ukuran file melebihi 10 MB." }],
        "Ukuran file melebihi 10 MB.",
        "FILE_TOO_LARGE",
      );
    }

    // Layer 2.
    if (!hasAllowedExtension(file.originalname)) {
      this.reject(scope, invitationId, "extension");
      invalid();
    }

    // Layer 3 — the only check that looks at content, and the only one an attacker cannot
    // simply choose the answer to.
    const format = detectFormat(new Uint8Array(file.buffer));
    if (format === null) {
      this.reject(scope, invitationId, "magic_bytes");
      invalid();
    }

    // Layer 1. Consulted, recorded, never decisive: `docs/SECURITY/06` lists trusting the
    // header as the sole validation under Prohibited, and refusing on a *disagreement* would
    // make the header decisive in the other direction.
    if (!contentTypeAgrees(file.mimetype, format!)) {
      logger.warn(
        {
          context: {
            invitation_id: invitationId,
            user_id: scope,
            event: "media.content_type_mismatch",
            declared: file.mimetype.split(";")[0],
            detected: format,
          },
        },
        "declared Content-Type disagrees with the file's bytes",
      );
    }

    return format!;
  }

  /** One shape for every rejection log, with a fixed slug rather than a message. */
  private reject(
    scope: TenantScope,
    invitationId: string,
    reason: "extension" | "magic_bytes" | "quota" | "size",
  ): void {
    logger.warn(
      {
        context: {
          invitation_id: invitationId,
          user_id: scope,
          event: "media.rejected",
          reason,
        },
      },
      "upload rejected",
    );
  }

  /**
   * The read response, shaped by status.
   *
   * A `processing` row has no dimensions and no URL — it has not been decoded. Returning
   * `url: null` would invite a client to render it; omitting the field makes the absence
   * something the client has to handle. `docs/API/05` § Example Response shows the two
   * shapes separately for the same reason.
   *
   * The URLs are **derived** from `mediaKey()` rather than stored. `OQ-19` has not settled
   * which variants `P1-18` produces, and a stored URL would have to be rewritten for every
   * existing row the day it does.
   */
  private toDetail(row: MediaRow): MediaDetailDto {
    const base: MediaDetailDto = {
      id: row.id,
      status: row.status,
      purpose: row.purpose,
    };

    if (row.status !== "ready" || row.invitationId === null) return base;

    // No CDN configured -- omit the links rather than build one against a host that does not
    // serve them. `docs/ARCHITECTURE/05` forbids handing out a bucket URL, so there is no
    // second-best source to fall back to. Locally this is the normal case.
    const cdn = this.env.CDN_BASE_URL;
    if (cdn === undefined)
      return { ...base, width: row.width, height: row.height };

    return {
      ...base,
      url: `${cdn}/${mediaKey(row.invitationId, row.id, "large")}`,
      thumbnail_url: `${cdn}/${mediaKey(row.invitationId, row.id, "thumbnail")}`,
      width: row.width,
      height: row.height,
    };
  }
}
