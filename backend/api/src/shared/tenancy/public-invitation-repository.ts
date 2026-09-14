import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import {
  invitations,
  invitationPeople,
  invitationSettings,
  invitationQuote,
  invitationEvents,
  invitationGallery,
  invitationBankAccounts,
  invitationPreviewTokens,
  media,
  templateVersions,
  templates,
} from "../../infra/db/schema/index";
import type {
  InvitationAggregate,
  InvitationRow,
  GalleryEntry,
  MediaRow,
} from "./invitation-repository";
import { SYSTEM_ACCOUNT_ID } from "../demo/demo-account";

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
    /**
     * The catalogue thumbnail, for `P2-09`'s `og:image` fallback.
     *
     * `docs/FRONTEND/07` § SEO Meta Generation: the cover photo, "falling back to the
     * template thumbnail if there's no cover photo". A published invitation with no
     * gallery would otherwise share with no preview image at all -- which is the case a
     * couple who has not uploaded photos yet is in, and exactly when they are testing the
     * link.
     *
     * Not new exposure: `docs/API/03` serves the same URL to anyone browsing the
     * catalogue.
     */
    readonly thumbnailUrl: string | null;
  };
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
      .select({
        invitation: invitations,
        version: templateVersions,
        thumbnailUrl: templates.thumbnailUrl,
      })
      .from(invitations)
      .innerJoin(
        templateVersions,
        eq(invitations.templateVersionId, templateVersions.id),
      )
      .innerJoin(templates, eq(templateVersions.templateId, templates.id))
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

    return this.#assemble(found);
  }

  /**
   * `P2-12` — the invitation behind a share-preview token, whatever its status, or `null`.
   *
   * `docs/DATABASE/04` § Share-Preview Tokens: the token *"is the only thing between an
   * unpublished invitation and the public internet"*. So the predicates are the whole
   * authorization model, as with the slug lookup, and all of them are in SQL:
   *
   *   - the **hash** matches — the token itself is never stored;
   *   - it is **not revoked**;
   *   - it has **not expired**, compared in the database against `now()` rather than a clock
   *     the application passes in, so a skewed application host cannot extend a link;
   *   - the invitation is **not deleted**.
   *
   * **Status is deliberately not a predicate.** A preview exists to show a draft or a paid
   * but unpublished invitation; that is its purpose. A preview of a published invitation is
   * also allowed — the couple sent the link before publishing and it should keep working.
   *
   * `null` for an unknown, expired, revoked or deleted token alike, and the caller cannot
   * tell them apart for the same reason as the slug lookup: `docs/DATABASE/04` requires they
   * produce the same response, and the cheapest way to keep that is to not know.
   *
   * A successful resolve records `last_accessed_at`, so the owner can see whether a link was
   * opened. Written after the read and not awaited by the result's correctness: a failed
   * timestamp update must not turn a valid preview into an error.
   */
  async findPreviewByTokenHash(
    tokenHash: string,
  ): Promise<PublishedInvitation | null> {
    const rows = await this.db
      .select({
        invitation: invitations,
        version: templateVersions,
        thumbnailUrl: templates.thumbnailUrl,
        tokenId: invitationPreviewTokens.id,
      })
      .from(invitationPreviewTokens)
      .innerJoin(
        invitations,
        eq(invitationPreviewTokens.invitationId, invitations.id),
      )
      .innerJoin(
        templateVersions,
        eq(invitations.templateVersionId, templateVersions.id),
      )
      .innerJoin(templates, eq(templateVersions.templateId, templates.id))
      .where(
        and(
          eq(invitationPreviewTokens.tokenHash, tokenHash),
          isNull(invitationPreviewTokens.revokedAt),
          sql`${invitationPreviewTokens.expiresAt} > now()`,
          isNull(invitations.deletedAt),
        ),
      )
      .limit(1);

    const found = rows[0];
    if (found === undefined) return null;

    await this.db
      .update(invitationPreviewTokens)
      .set({ lastAccessedAt: new Date() })
      .where(eq(invitationPreviewTokens.id, found.tokenId))
      .catch(() => undefined);

    return this.#assemble(found);
  }

  /** The aggregate behind an invitation row the caller has already authorized. */
  async #assemble(found: {
    readonly invitation: InvitationRow;
    readonly version: typeof templateVersions.$inferSelect;
    readonly thumbnailUrl: string | null;
  }): Promise<PublishedInvitation> {
    const invitationId = found.invitation.id;

    const [people, events, galleryRows, bankAccounts, settings, quote] =
      await Promise.all([
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
        thumbnailUrl: found.thumbnailUrl,
      },
    };
  }

  /**
   * `P2-11` — the public slug of a template's seeded demo invitation, or `null`.
   *
   * `docs/PLAN/07` § Demo Data: the catalogue's live demo is *"a seeded invitation owned by
   * a system account … and the demo renders through the production renderer reading the
   * production public API shape"*. So "View Live Demo" is a link to an ordinary published
   * invitation, and the catalogue needs to know its address.
   *
   * Looked up rather than derived from a naming convention. `demo-elegant-rose` happens to
   * be `demo-` plus the template's slug, but nothing in `docs/` says so, and a convention
   * the frontend relied on would break silently the day a second template's demo was
   * seeded under any other name.
   *
   * Three predicates, all of them doing work: **owned by the system account**, so a
   * customer's invitation on the same template is never offered as somebody else's demo;
   * **published and not deleted**, so the link cannot lead to the not-found page; and the
   * **template**, not the version — a demo seeded on 1.0.0 still demonstrates the template
   * after 1.1.0 is released.
   */
  async findDemoSlugForTemplate(templateId: string): Promise<string | null> {
    const rows = await this.db
      .select({ slug: invitations.slug })
      .from(invitations)
      .where(
        and(
          eq(invitations.templateId, templateId),
          eq(invitations.ownerId, SYSTEM_ACCOUNT_ID),
          eq(invitations.status, "published"),
          isNull(invitations.deletedAt),
        ),
      )
      .orderBy(desc(invitations.publishedAt))
      .limit(1);

    return rows[0]?.slug ?? null;
  }
}
