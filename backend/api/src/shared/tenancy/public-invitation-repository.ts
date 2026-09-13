import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import {
  invitations,
  invitationPeople,
  invitationSettings,
  invitationQuote,
  invitationEvents,
  invitationGallery,
  invitationBankAccounts,
  media,
  orders,
  packages,
  templateVersions,
} from "../../infra/db/schema/index";
import type {
  InvitationAggregate,
  InvitationRow,
  GalleryEntry,
  MediaRow,
} from "./invitation-repository";

/**
 * `P2-07` — the one read of invitation data with no owner in it.
 *
 * ## Why this lives in `shared/tenancy/`
 *
 * `scripts/check-tenant-scope.mjs` refuses a direct import of the invitation tables
 * anywhere but here. That rule matters *more* for this query than for the forty scoped
 * ones beside it, not less: this is the query with no `owner_id` predicate at all, and
 * the only way to keep that visible is to keep it next to the ones that have it.
 *
 * ## What replaces the owner filter
 *
 * `status = 'published' AND deleted_at IS NULL`, in the `WHERE` clause. Not fetched and
 * then checked — `docs/BACKEND/06` § Slug Resolution writes the predicate out in full for
 * the same reason `docs/SECURITY/05` insists on it for owner scope: a branch after the
 * fetch is a branch somebody can forget, and by then the row is already in memory.
 *
 * `docs/SECURITY/01` names leaking an unpublished invitation as *the* information
 * disclosure risk on this surface. A draft is somebody's unfinished wedding page, and an
 * unpublished one was deliberately taken down.
 *
 * ## Deliberately a separate file
 *
 * It could have been one more method on `InvitationRepository`. It is not, because that
 * class's contract — stated at the top of it — is that nothing can be fetched without a
 * `TenantScope` or a name containing `admin`. This method would be the exception, and an
 * exception buried in a thousand lines is an exception nobody sees. A file whose name
 * says `public` is one somebody reviews differently.
 */

/** Everything one published invitation needs, in one shape. */
export interface PublishedInvitation {
  readonly invitation: InvitationRow;
  readonly aggregate: InvitationAggregate;
  /** Gallery photos joined to their media rows, in display order. */
  readonly gallery: readonly GalleryEntry[];
  /** The media rows behind the couple's photos, keyed by id. */
  readonly personPhotos: ReadonlyMap<string, MediaRow>;
  readonly template: {
    readonly sections: unknown;
    readonly theme: unknown;
    readonly customizableThemeKeys: readonly string[];
  };
  /**
   * `packages.has_watermark` of the package this invitation was paid for, or `true` when
   * it has not been paid for.
   *
   * `true` is the fail-closed default in the direction that matters commercially: a
   * failure to confirm payment must produce the watermarked page, never the premium one.
   * BR-2.8's free trial publish lands here by design — a trial is a real publish of an
   * unpaid invitation, and it is watermarked.
   */
  readonly watermark: boolean;
}

@Injectable()
export class PublicInvitationRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * The published invitation at this slug, or `null`.
   *
   * `null` for every one of: no such slug, a draft, a `paid` but unpublished invitation,
   * an unpublished one, an expired one, a soft-deleted one. The caller cannot tell them
   * apart because this method cannot — `docs/API/08` requires the API not to distinguish
   * them, and the cheapest way to keep that promise is to destroy the distinction here
   * rather than ask every caller to preserve it.
   */
  async findPublishedBySlug(slug: string): Promise<PublishedInvitation | null> {
    const rows = await this.db
      .select({ invitation: invitations, version: templateVersions })
      .from(invitations)
      .innerJoin(
        templateVersions,
        eq(invitations.templateVersionId, templateVersions.id),
      )
      .where(
        and(
          eq(invitations.slug, slug),
          // The whole authorization model of this endpoint, in two predicates.
          eq(invitations.status, "published"),
          isNull(invitations.deletedAt),
        ),
      )
      .limit(1);

    const found = rows[0];
    if (found === undefined) return null;

    const invitationId = found.invitation.id;

    const [
      people,
      events,
      galleryRows,
      bankAccounts,
      settings,
      quote,
      watermark,
    ] = await Promise.all([
      this.db
        .select()
        .from(invitationPeople)
        .where(eq(invitationPeople.invitationId, invitationId)),
      this.db
        .select()
        .from(invitationEvents)
        .where(eq(invitationEvents.invitationId, invitationId)),
      this.db
        .select({ photo: invitationGallery, media })
        .from(invitationGallery)
        .innerJoin(media, eq(invitationGallery.mediaId, media.id))
        .where(eq(invitationGallery.invitationId, invitationId)),
      this.db
        .select()
        .from(invitationBankAccounts)
        .where(eq(invitationBankAccounts.invitationId, invitationId)),
      this.db
        .select()
        .from(invitationSettings)
        .where(eq(invitationSettings.invitationId, invitationId))
        .limit(1),
      this.db
        .select()
        .from(invitationQuote)
        .where(eq(invitationQuote.invitationId, invitationId))
        .limit(1),
      this.watermarkFor(invitationId),
    ]);

    /*
     * The children are addressed by `invitation_id` alone, with no join back to
     * `invitations`. That is safe only because the parent row was already proved
     * published above, and it is the reason this is one method rather than six the
     * service composes: a caller who could ask for the children separately could ask for
     * an unpublished invitation's children.
     */
    const photoIds = new Set(
      people
        .map((person) => person.photoMediaId)
        .filter((id): id is string => id !== null),
    );

    const personPhotos = new Map<string, MediaRow>();
    if (photoIds.size > 0) {
      const photoRows = await this.db
        .select()
        .from(media)
        .where(eq(media.invitationId, invitationId));

      for (const row of photoRows) {
        if (photoIds.has(row.id)) personPhotos.set(row.id, row);
      }
    }

    return {
      invitation: found.invitation,
      aggregate: {
        people,
        events,
        gallery: galleryRows.map((row) => row.photo),
        bankAccounts,
        settings: settings[0] ?? null,
        quote: quote[0] ?? null,
      },
      gallery: galleryRows,
      personPhotos,
      template: {
        sections: found.version.sections,
        theme: found.version.theme,
        customizableThemeKeys: found.version.customizableThemeKeys,
      },
      watermark,
    };
  }

  /**
   * `packages.has_watermark` of the most recent **paid** order, or `true`.
   *
   * `docs/API/08`: *"derived server-side from the package the invitation was paid for …
   * it must never be influenced by a client hint"*. There is no client hint to ignore
   * here because the endpoint reads no input beyond the slug — the control is that this
   * value has exactly one source.
   *
   * `status = 'paid'` and nothing else. A `pending` order is somebody who opened a
   * payment page; treating it as paid would make the watermark removable by starting a
   * checkout and abandoning it.
   */
  private async watermarkFor(invitationId: string): Promise<boolean> {
    const rows = await this.db
      .select({ hasWatermark: packages.hasWatermark })
      .from(orders)
      .innerJoin(packages, eq(orders.packageId, packages.id))
      .where(
        and(eq(orders.invitationId, invitationId), eq(orders.status, "paid")),
      )
      .orderBy(desc(orders.createdAt))
      .limit(1);

    return rows[0]?.hasWatermark ?? true;
  }
}
