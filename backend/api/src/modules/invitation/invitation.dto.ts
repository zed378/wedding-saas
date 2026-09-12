import type {
  InvitationAggregate,
  InvitationRow,
} from "../../shared/tenancy/invitation-repository";

/**
 * P1-10 — the explicit response shapes. `docs/API/04` § Example Response.
 *
 * ## Why these exist at all
 *
 * `docs/BACKEND/00` and `docs/SECURITY/08` § Mass Data Exposure: no `SELECT *` reaches a
 * response. Returning the row directly works today and becomes a leak the moment somebody
 * adds a column — an internal note, a moderation flag, a cost field — because nothing in
 * the code would have to change for it to start being served.
 *
 * A projection is the opposite: adding a column changes nothing until somebody
 * deliberately adds it here. That is the difference between a leak being possible by
 * omission and possible only by decision.
 *
 * ## snake_case
 *
 * `docs/API/00` § Response Envelope. The API contract is the boundary where this
 * repository's TypeScript conventions stop and the document's start.
 */

/** The list shape. Deliberately smaller than the detail. */
export interface InvitationSummary {
  readonly id: string;
  readonly internal_name: string | null;
  readonly status: string;
  readonly slug: string | null;
  readonly template_id: string;
  readonly template_version_id: string;
  readonly published_at: string | null;
  readonly expiry_date: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * The template identity behind the locked version. `PG-19`, ADR-060.
 *
 * `template_id` and `template_version_id` are uuids and every catalogue endpoint is
 * addressed by slug and semver, so without these a client holding an invitation cannot
 * fetch the definition it is rendering. BR-3.1 makes that worse rather than better: the
 * invitation stays on the version it locked, so `GET /templates/:slug` — which serves the
 * newest — is the wrong answer for an existing invitation.
 */
export interface InvitationTemplate {
  readonly slug: string;
  readonly name: string;
  /** The locked version's number, for `GET /templates/:slug/versions/:version`. */
  readonly version: string;
}

export interface InvitationDetail extends InvitationSummary {
  readonly template: InvitationTemplate;
  readonly owner_id: string;
  readonly couple: {
    readonly groom: PersonDto | null;
    readonly bride: PersonDto | null;
  };
  readonly events: EventDto[];
  readonly gallery: GalleryDto[];
  readonly bank_accounts: BankAccountDto[];
  readonly quote: {
    readonly text: string | null;
    readonly source: string | null;
  };
  readonly settings: SettingsDto;
}

export interface PersonDto {
  readonly full_name: string;
  readonly nickname: string;
  readonly photo_media_id: string | null;
  readonly instagram: string | null;
  readonly father_name: string | null;
  readonly mother_name: string | null;
  readonly child_order: string | null;
}

export interface EventDto {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly event_date: string;
  readonly start_time: string;
  readonly end_time: string | null;
  readonly venue_name: string;
  readonly address: string;
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly description: string | null;
  readonly display_order: number;
}

export interface GalleryDto {
  readonly id: string;
  readonly media_id: string;
  readonly caption: string | null;
  readonly display_order: number;
  readonly is_cover: boolean;
}

export interface BankAccountDto {
  readonly id: string;
  readonly type: string;
  readonly provider_name: string;
  readonly account_number: string;
  readonly account_holder: string;
  readonly display_order: number;
}

export interface SettingsDto {
  readonly enabled_sections: string[];
  readonly theme_override: unknown;
  readonly rsvp_enabled: boolean;
  readonly guestbook_enabled: boolean;
  readonly guestbook_moderation: boolean;
  readonly seo_indexable: boolean;
}

/** `Date | null` to an ISO string, because JSON has no date. */
const iso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

export function toInvitationSummary(row: InvitationRow): InvitationSummary {
  return {
    id: row.id,
    internal_name: row.internalName,
    status: row.status,
    slug: row.slug,
    template_id: row.templateId,
    template_version_id: row.templateVersionId,
    published_at: iso(row.publishedAt),
    // A `date` column, which Drizzle gives back as a string already.
    expiry_date: row.expiryDate,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function toInvitationDetail(
  row: InvitationRow,
  aggregate: InvitationAggregate,
  template: InvitationTemplate,
): InvitationDetail {
  const person = (role: string): PersonDto | null => {
    const found = aggregate.people.find((p) => p.role === role);
    if (found === undefined) return null;

    return {
      full_name: found.fullName,
      nickname: found.nickname,
      photo_media_id: found.photoMediaId,
      instagram: found.instagram,
      father_name: found.fatherName,
      mother_name: found.motherName,
      child_order: found.childOrder,
    };
  };

  const byOrder = <T extends { displayOrder: number }>(rows: T[]): T[] =>
    [...rows].sort((a, b) => a.displayOrder - b.displayOrder);

  return {
    ...toInvitationSummary(row),
    template,
    // `owner_id` is in `docs/API/04`'s example response, and it is the caller's own id --
    // the query that produced this row filtered on it.
    owner_id: row.ownerId,
    couple: { groom: person("groom"), bride: person("bride") },
    events: byOrder(aggregate.events).map((e) => ({
      id: e.id,
      type: e.type,
      title: e.title,
      event_date: e.eventDate,
      start_time: e.startTime,
      end_time: e.endTime,
      venue_name: e.venueName,
      address: e.address,
      latitude: e.latitude,
      longitude: e.longitude,
      description: e.description,
      display_order: e.displayOrder,
    })),
    gallery: byOrder(aggregate.gallery).map((g) => ({
      id: g.id,
      media_id: g.mediaId,
      caption: g.caption,
      display_order: g.displayOrder,
      is_cover: g.isCover,
    })),
    bank_accounts: byOrder(aggregate.bankAccounts).map((b) => ({
      id: b.id,
      type: b.type,
      provider_name: b.providerName,
      // Served to the owner, who typed it. `docs/SECURITY/09` § Encryption (ADR-025)
      // explains why this column is not encrypted: the couple enters it IN ORDER to
      // publish it, and on a published invitation with the gift section on it is already
      // served to every guest.
      account_number: b.accountNumber,
      account_holder: b.accountHolder,
      display_order: b.displayOrder,
    })),
    quote: {
      text: aggregate.quote?.text ?? null,
      source: aggregate.quote?.source ?? null,
    },
    settings: {
      // Defaults rather than null, so a client never has to handle a missing settings
      // object. `P1-09` creates the row with the invitation, so this is unreachable
      // through the normal path -- it exists for rows that predate it.
      enabled_sections: [...(aggregate.settings?.enabledSections ?? [])],
      theme_override: aggregate.settings?.themeOverride ?? {},
      rsvp_enabled: aggregate.settings?.rsvpEnabled ?? true,
      guestbook_enabled: aggregate.settings?.guestbookEnabled ?? true,
      guestbook_moderation: aggregate.settings?.guestbookModeration ?? false,
      seo_indexable: aggregate.settings?.seoIndexable ?? false,
    },
  };
}
