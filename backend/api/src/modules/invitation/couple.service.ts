import { Injectable } from "@nestjs/common";

import { ValidationError } from "../../http/errors";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";
import { requireOwned } from "../../shared/auth-middleware";
import type { PersonDto } from "./invitation.dto";

/**
 * P1-11 — `PATCH /invitations/:id/couple/{groom,bride}`. `docs/PLAN/08` § Person.
 *
 * ## Update, never upsert
 *
 * `P1-09` creates both people rows empty with the invitation, so these endpoints are
 * pure `UPDATE`s. That is the card's step 4 reasoning made concrete: an upsert here would
 * race between two tabs and could produce a second `groom` row, which nothing downstream
 * expects — `toInvitationDetail` picks the *first* match and would silently show one of
 * them.
 *
 * ## The cross-tenant hole this endpoint would otherwise have
 *
 * `photo_media_id` is the interesting field. The route's own `:id` is checked, so the
 * caller demonstrably owns the invitation — and they can still pass the media id of
 * **somebody else's** photo, which would then render on their public page.
 *
 * `docs/SECURITY/05` § 6 is about exactly this: a reference field is a second tenancy
 * boundary, and checking the path parameter does not check it. The media must exist,
 * belong to *this* invitation, and be `ready`.
 */

/** The seven fields `docs/PLAN/08` § Person defines. `role` is not among them. */
export interface PersonUpdate {
  readonly fullName?: string;
  readonly nickname?: string;
  readonly photoMediaId?: string | null;
  readonly instagram?: string | null;
  readonly fatherName?: string | null;
  readonly motherName?: string | null;
  readonly childOrder?: string | null;
}

export type PersonRole = "groom" | "bride";

@Injectable()
export class CoupleService {
  constructor(private readonly repository: InvitationRepository) {}

  /**
   * Update one half of the couple.
   *
   * Ownership first, through the query rather than a check afterwards — a non-owner gets
   * the same 404 as a stranger, and never learns whether the invitation exists.
   */
  async update(
    scope: TenantScope,
    invitationId: string,
    role: PersonRole,
    changes: PersonUpdate,
  ): Promise<PersonDto> {
    await requireOwned(
      () => this.repository.ownsInvitation(invitationId, scope),
      { scope, resourceType: "invitation", resourceId: invitationId },
    );

    if (changes.photoMediaId !== undefined && changes.photoMediaId !== null) {
      await this.assertUsablePhoto(invitationId, changes.photoMediaId);
    }

    const row = await this.repository.updatePerson(
      invitationId,
      scope,
      role,
      changes,
    );

    // `P1-09` guarantees both rows exist. If one is missing, the invitation was created
    // by something other than that path and the honest answer is a 404 rather than
    // inventing a row here -- an upsert would hide whatever produced the inconsistency.
    if (row === null) {
      throw new ValidationError(
        [{ field: "role", message: "Data mempelai tidak ditemukan." }],
        "Data mempelai tidak ditemukan.",
      );
    }

    return {
      full_name: row.fullName,
      nickname: row.nickname,
      photo_media_id: row.photoMediaId,
      instagram: row.instagram,
      father_name: row.fatherName,
      mother_name: row.motherName,
      child_order: row.childOrder,
    };
  }

  /**
   * `docs/SECURITY/05` § 6 — a media reference is its own tenancy boundary.
   *
   * Three conditions, and each rejects a different real mistake:
   *
   *   **exists** — a typo or a stale id from a deleted upload;
   *   **belongs to this invitation** — the cross-tenant reference this check exists for.
   *     The caller owns the invitation in the path; that says nothing about the photo;
   *   **is `ready`** — a file still in the processing pipeline has not been through
   *     `docs/SECURITY/06`'s validation. Publishing a reference to it would put an
   *     unscanned file on a public page.
   *
   * All three produce the same message. Telling them apart would let a caller probe which
   * media ids exist, which is the enumeration the 404 rule closes everywhere else.
   */
  private async assertUsablePhoto(
    invitationId: string,
    mediaId: string,
  ): Promise<void> {
    const usable = await this.repository.mediaBelongsToInvitation(
      mediaId,
      invitationId,
    );

    if (!usable) {
      throw new ValidationError([
        {
          field: "photo_media_id",
          message:
            "Foto tidak ditemukan, belum selesai diproses, atau bukan milik undangan ini.",
        },
      ]);
    }
  }
}
