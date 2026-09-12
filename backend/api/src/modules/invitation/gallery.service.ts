import { Inject, Injectable } from "@nestjs/common";

import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import {
  BusinessRuleError,
  NotFoundError,
  ValidationError,
} from "../../http/errors";
import { logger } from "../../shared/logging/logger";
import { requireOwned } from "../../shared/auth-middleware";
import {
  InvitationRepository,
  type GalleryEntry,
} from "../../shared/tenancy/invitation-repository";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import { MAX_PHOTOS_PER_INVITATION } from "../media/media.service";
import { mediaKey } from "@wi/storage";

/**
 * P1-19 — the gallery. `docs/API/04` § Gallery, BR-8.1.
 *
 * ## A gallery entry is a placement, not a photo
 *
 * The photo is the `media` row: `P1-17` created it, `P1-18` made it `ready`. A gallery entry
 * says *where on this invitation that photo appears* — its order, its caption, whether it is
 * the cover. Keeping the two apart is what makes `docs/PLAN/11` § Deletion's "soft-delete the
 * media so it can be restored" coherent: removing a photo from the gallery removes a
 * placement and retires a file, and those are different operations on different rows.
 *
 * ## Only `ready` media may be attached
 *
 * A `processing` row has not been scanned, decoded or EXIF-stripped, and a `failed` one has
 * no file at all. Attaching either would put an unscanned or absent image into a page that
 * hundreds of guests open — which is the outcome `P1-18` exists to prevent, arriving through
 * a different door.
 */

export interface GalleryPhotoDto {
  readonly id: string;
  readonly media_id: string;
  readonly caption: string | null;
  readonly display_order: number;
  readonly is_cover: boolean;
  readonly status: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly url?: string;
  readonly thumbnail_url?: string;
}

@Injectable()
export class GalleryService {
  constructor(
    private readonly repository: InvitationRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(
    scope: TenantScope,
    invitationId: string,
  ): Promise<GalleryPhotoDto[]> {
    await requireOwned(
      () => this.repository.ownsInvitation(invitationId, scope),
      { scope, resourceType: "invitation", resourceId: invitationId },
    );

    const entries = await this.repository.findOwnedGallery(invitationId, scope);
    return entries.map((entry) => this.toDto(entry));
  }

  async attach(
    scope: TenantScope,
    invitationId: string,
    input: {
      readonly mediaId: string;
      readonly caption?: string | null | undefined;
      readonly isCover?: boolean | undefined;
    },
  ): Promise<GalleryPhotoDto> {
    const result = await this.repository.attachGalleryPhoto(
      invitationId,
      scope,
      { ...input, maxPhotos: MAX_PHOTOS_PER_INVITATION },
    );

    switch (result.kind) {
      case "not_found":
        throw new NotFoundError();

      case "media_not_usable":
        // 404, not 422, and this is `docs/SECURITY/05` § 6's case: the media id came from a
        // request body, so "belongs to another invitation" and "does not exist" must be the
        // same answer. A 422 saying "that photo is not ready yet" would confirm the id
        // exists — which is the enumeration oracle ADR-018 removed from every other endpoint.
        logger.warn(
          {
            context: {
              invitation_id: invitationId,
              user_id: scope,
              event: "gallery.media_not_usable",
              media_id: input.mediaId,
            },
          },
          "attach refused: media is not this invitation's, or is not ready",
        );
        throw new NotFoundError();

      case "already_attached":
        throw new BusinessRuleError(
          "PHOTO_ALREADY_ATTACHED",
          "Foto ini sudah ada di galeri undangan.",
        );

      case "quota_exceeded":
        throw new ValidationError(
          [
            {
              field: "media_id",
              message: `Galeri sudah berisi ${String(MAX_PHOTOS_PER_INVITATION)} foto.`,
            },
          ],
          `Galeri sudah berisi ${String(MAX_PHOTOS_PER_INVITATION)} foto. Hapus salah satu sebelum menambah yang baru.`,
          "QUOTA_EXCEEDED",
        );

      case "attached":
        return this.toDto(result.entry);
    }
  }

  async update(
    scope: TenantScope,
    invitationId: string,
    photoId: string,
    changes: {
      readonly caption?: string | null | undefined;
      readonly displayOrder?: number | undefined;
      readonly isCover?: boolean | undefined;
    },
  ): Promise<GalleryPhotoDto> {
    const entry = await this.repository.updateGalleryPhoto(
      photoId,
      invitationId,
      scope,
      changes,
    );

    if (entry === null) throw new NotFoundError();
    return this.toDto(entry);
  }

  async remove(
    scope: TenantScope,
    invitationId: string,
    photoId: string,
  ): Promise<void> {
    const removed = await this.repository.deleteGalleryPhoto(
      photoId,
      invitationId,
      scope,
    );

    if (!removed) throw new NotFoundError();

    // The file is still there. `docs/PLAN/11` § Deletion keeps it for a grace period so a
    // deletion made by mistake is recoverable and so nothing vanishes from a CDN cache
    // mid-serve; the sweep that removes it is a Phase 4 job.
    logger.info(
      {
        context: {
          invitation_id: invitationId,
          user_id: scope,
          event: "gallery.photo_removed",
          photo_id: photoId,
        },
      },
      "gallery photo removed and its media soft-deleted",
    );
  }

  /**
   * Replace the whole order in one statement's worth of intent. `docs/API/04` § Gallery.
   *
   * A full list rather than a move-one-item operation, because the client already knows the
   * order it wants: a drag-and-drop grid has the final arrangement in hand, and expressing it
   * as a sequence of moves would make the server reconstruct what the user already decided.
   */
  async reorder(
    scope: TenantScope,
    invitationId: string,
    orderedPhotoIds: readonly string[],
  ): Promise<GalleryPhotoDto[]> {
    const result = await this.repository.reorderGallery(
      invitationId,
      scope,
      orderedPhotoIds,
    );

    if (result === "not_found") throw new NotFoundError();

    if (result === "mismatched") {
      // Wholesale, never partial. The user asked for one arrangement; applying most of it
      // leaves them looking at an order nobody chose, with nothing to explain it.
      throw new ValidationError([
        {
          field: "ordered_photo_ids",
          message:
            "Daftar harus memuat seluruh foto galeri ini, masing-masing tepat satu kali.",
        },
      ]);
    }

    return this.list(scope, invitationId);
  }

  /**
   * The public shape.
   *
   * URLs only for a `ready` photo with a CDN configured — the same rule `P1-17`'s media read
   * follows, and for the same two reasons: a `processing` row has no variants to link to, and
   * `docs/ARCHITECTURE/05` § Access Control forbids handing out a bucket URL as a fallback.
   */
  private toDto(entry: GalleryEntry): GalleryPhotoDto {
    const base: GalleryPhotoDto = {
      id: entry.photo.id,
      media_id: entry.photo.mediaId,
      caption: entry.photo.caption,
      display_order: entry.photo.displayOrder,
      is_cover: entry.photo.isCover,
      status: entry.media.status,
      width: entry.media.width,
      height: entry.media.height,
    };

    const cdn = this.env.CDN_BASE_URL;
    if (entry.media.status !== "ready" || cdn === undefined) return base;
    if (entry.media.invitationId === null) return base;

    return {
      ...base,
      url: `${cdn}/${mediaKey(entry.media.invitationId, entry.media.id, "large")}`,
      thumbnail_url: `${cdn}/${mediaKey(entry.media.invitationId, entry.media.id, "thumbnail")}`,
    };
  }
}
