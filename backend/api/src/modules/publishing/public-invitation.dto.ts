import { mediaKey } from "@wi/storage";
import { isSectionEnabled, type SectionDefinition } from "@wi/schema";

import { parseSections } from "../invitation/settings.service";

import type {
  GalleryEntry,
  MediaRow,
} from "../../shared/tenancy/invitation-repository";
import type { PublishedInvitation } from "../../shared/tenancy/public-invitation-repository";
import { toClockTime } from "../../shared/time/clock-time";

/**
 * `P2-07` — what a published invitation is allowed to expose. `docs/API/08`.
 *
 * ## Built by whitelist, never by subtraction
 *
 * Every field below is written out. The obvious alternative — take `toInvitationDetail`
 * and delete the private parts — is how a field added to the owner's response in six
 * months silently appears on a wedding page read by several hundred strangers. Omission
 * has to be the default, so that adding a field to the invitation is not also a decision
 * to publish it.
 *
 * `public-invitation.itest.ts` asserts the resulting object against an explicit list of
 * keys that must never appear, which is the half that catches a mistake made *here*.
 *
 * ## The invitation is in `docs/PLAN/08`'s CANONICAL shape, not `docs/API/04`'s
 *
 * `events[].date`, not `event_date`. `gallery.photos`, not `gallery`. `gift.accounts`,
 * not `bank_accounts`. `couple.groom.photo` holding a URL, not `photo_media_id`.
 *
 * Those are the paths `packages/schema`'s field registry defines and the paths a template
 * declares in its `required_fields`. The renderer resolves a section's props from them,
 * so a payload in any other shape renders an empty page — which is exactly what the first
 * version of this file did, and what `P2-08` found the moment it tried to render one.
 * `docs/API/08`'s example predates the registry; it is amended, and ADR-063 records why
 * the payload rather than the renderer was the thing to change.
 *
 * ## A disabled section contributes nothing
 *
 * BR-4.1 and `docs/API/08`: *"`bank_accounts` is ONLY included if the `gift` section is
 * active in `enabled_sections` — respect the user's toggle even if data exists in the
 * DB"*. Data existing in the database is not consent to publish it. The rule is applied
 * to every section that owns data, not only to gift accounts, because the reason it is
 * stated for gift accounts is not specific to them.
 */

export interface PublicPersonDto {
  readonly full_name: string;
  readonly nickname: string;
  readonly instagram: string | null;
  readonly father_name: string | null;
  readonly mother_name: string | null;
  readonly child_order: string | null;
  /**
   * The canonical path is `couple.<role>.photo` and the renderer uses it directly as an
   * image source, so this is a URL — of the 300w thumbnail variant (`P2-13`, ADR-067).
   * Absent unless the media is `ready` and a CDN is configured.
   */
  readonly photo?: string;
}

export interface PublicEventDto {
  readonly type: string;
  readonly title: string;
  /** `events.*.date` in the registry; `event_date` is the column, not the path. */
  readonly date: string;
  readonly start_time: string;
  readonly timezone: string;
  readonly end_time: string | null;
  readonly venue_name: string;
  readonly address: string;
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly maps_url: string | null;
  readonly description: string | null;
}

export interface PublicGalleryDto {
  readonly caption: string | null;
  readonly is_cover: boolean;
  readonly order: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly url?: string;
  readonly medium_url?: string;
  readonly thumbnail_url?: string;
}

export interface PublicBankAccountDto {
  readonly type: string;
  readonly provider_name: string;
  readonly account_number: string;
  readonly account_holder: string;
  readonly order: number;
}

export interface PublicSettingsDto {
  readonly enabled_sections: readonly string[];
  readonly theme_override: unknown;
  readonly rsvp_enabled: boolean;
  readonly guestbook_enabled: boolean;
  /** `P2-09` emits `robots` from this. The owner's instruction about their own page. */
  readonly seo_indexable: boolean;
}

export interface PublicInvitationDto {
  /**
   * `"published"` on the public route, where anything else is a 404. `"preview"` on a
   * share-preview response (`P2-12`): a preview usually shows a DRAFT, and a payload claiming
   * `"published"` about an unpublished invitation would be false in the one field a consumer
   * might branch on.
   */
  readonly status: "published" | "preview";
  readonly template: {
    readonly sections: unknown;
    readonly theme: unknown;
    /**
     * The renderer validates `theme_override` against this (`P2-02`). Serving the
     * override without the whitelist would leave the public page unable to apply the
     * rule the editor applied. Template metadata, already public through `API/03`.
     */
    readonly customizable_theme_keys: readonly string[];
    /** `P2-09`'s `og:image` fallback when the invitation has no cover photo. */
    readonly thumbnail_url: string | null;
  };
  readonly display: {
    readonly watermark: boolean;
    /** `P2-12`: present, and `true`, only on a share-preview response. */
    readonly preview?: true;
  };
  readonly invitation: {
    readonly couple: {
      readonly groom: PublicPersonDto | null;
      readonly bride: PublicPersonDto | null;
    };
    readonly events: readonly PublicEventDto[];
    readonly gallery: { readonly photos: readonly PublicGalleryDto[] };
    readonly quote: {
      readonly text: string | null;
      readonly source: string | null;
    };
    readonly settings: PublicSettingsDto;
    /** Present only when a displayed section references `gift.accounts`. BR-4.1. */
    readonly gift?: { readonly accounts: readonly PublicBankAccountDto[] };
  };
}

/**
 * Which canonical path prefix each part of the payload carries.
 *
 * **Not a section table.** The obvious version of this maps `bank_accounts -> "gift"` and
 * `gallery -> "gallery"`, and it is wrong in a way that only shows up on a real template:
 * the reference template's `hero` section lists `gallery.photos` among its optional
 * fields, because it draws the cover photo behind the couple's names. Under a section
 * table, a couple who turns the gallery section off loses the hero background too — the
 * payload would omit data a section that is still displayed needs.
 *
 * So the question asked is *"does any displayed section reference this data?"*, answered
 * from the template's own declared field paths. That is the template-as-data reading of
 * BR-4.1 (`CLAUDE.md`: templates are data, no template-specific backend logic), and it
 * happens to be exactly equivalent to the rule `docs/API/08` states for gift accounts,
 * since only a gift section ever references `gift.accounts`.
 *
 * These prefixes are facts about the **data model** (`docs/PLAN/08`), fixed across every
 * template, not about any one template.
 */
const PATH_OF = {
  groom: "couple.groom",
  bride: "couple.bride",
  events: "events",
  gallery: "gallery.photos",
  quote: "quote",
  bankAccounts: "gift.accounts",
} as const;

/**
 * Every field path referenced by a section that is actually displayed.
 *
 * Read defensively, like `parseSections`: the column is `jsonb` and this code runs on a
 * public endpoint, so a malformed row must produce a thin page rather than a 500 on
 * somebody's wedding day.
 */
function visibleFieldPaths(
  sections: unknown,
  displayed: ReadonlySet<string>,
): Set<string> {
  const paths = new Set<string>();
  if (!Array.isArray(sections)) return paths;

  for (const section of sections) {
    if (typeof section !== "object" || section === null) continue;

    const record = section as Record<string, unknown>;
    const key = record["section_key"];
    if (typeof key !== "string" || !displayed.has(key)) continue;

    for (const field of ["required_fields", "optional_fields"]) {
      const list = record[field];
      if (!Array.isArray(list)) continue;
      for (const path of list) {
        if (typeof path === "string") paths.add(path);
      }
    }
  }

  return paths;
}

const byOrder = <T extends { displayOrder: number }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => a.displayOrder - b.displayOrder);

/**
 * A media URL, or nothing.
 *
 * The same rule `P1-19`'s gallery read follows, for the same two reasons: a `processing`
 * row has no variants to link to, and `docs/ARCHITECTURE/05` § Access Control forbids
 * handing out a bucket URL as a fallback. A page without photos is a degraded page; a
 * page linking into a private bucket is a security problem.
 */
function mediaUrls(
  row: MediaRow,
  cdnBaseUrl: string | undefined,
): { url?: string; medium_url?: string; thumbnail_url?: string } {
  if (row.status !== "ready") return {};
  if (cdnBaseUrl === undefined) return {};
  if (row.invitationId === null) return {};

  return {
    url: `${cdnBaseUrl}/${mediaKey(row.invitationId, row.id, "large")}`,
    // `P2-13`: the 800w variant, so a phone does not download the 1600w one for a 200px tile.
    medium_url: `${cdnBaseUrl}/${mediaKey(row.invitationId, row.id, "medium")}`,
    thumbnail_url: `${cdnBaseUrl}/${mediaKey(row.invitationId, row.id, "thumbnail")}`,
  };
}

export function toPublicInvitation(
  found: PublishedInvitation & {
    /**
     * `docs/API/08` `display.watermark`: from `EntitlementsService` (`P3-01`), the one source of
     * it — the package this invitation was paid for, or `true` when it has not been paid for.
     */
    readonly watermark: boolean;
  },
  cdnBaseUrl: string | undefined,
): PublicInvitationDto {
  const settings = found.aggregate.settings;
  const enabledSections = settings?.enabledSections ?? [];

  /*
   * Which sections are displayed, by the SAME rule the renderer applies.
   *
   * Not `enabled_sections.includes(key)`, which is the obvious reading and is wrong twice
   * over:
   *
   *   - `docs/FRONTEND/04` § Render Flow step 2 — a `configurable: false` section is
   *     displayed whatever the settings say, so a settings row that omits `couple` must
   *     not strip the couple's names off a live page.
   *   - BR-4.1 — a section the active template does not define is not displayed at all,
   *     however enabled it is. That is the case this catches that the renderer never
   *     sees: the data would be serialized and sent even though nothing renders it.
   *
   * `isSectionEnabled` is `P0-20`'s, the same function the publish check and the editor
   * run. A second implementation of "is this section on" is how the public page and the
   * editor come to disagree about what a guest can see.
   */
  const displayed = new Set(
    parseSections(found.template.sections)
      .filter((section) =>
        isSectionEnabled(
          {
            section_key: section.key,
            configurable: section.configurable,
          } as SectionDefinition,
          enabledSections,
        ),
      )
      .map((section) => section.key),
  );

  const visible = visibleFieldPaths(found.template.sections, displayed);

  /** Does any displayed section reference data under this prefix? */
  const shown = (prefix: string): boolean => {
    for (const path of visible) {
      if (path === prefix || path.startsWith(`${prefix}.`)) return true;
    }
    return false;
  };

  const person = (role: string, prefix: string): PublicPersonDto | null => {
    if (!shown(prefix)) return null;

    const row = found.aggregate.people.find((p) => p.role === role);
    if (row === undefined) return null;

    const photo =
      row.photoMediaId === null
        ? undefined
        : found.personPhotos.get(row.photoMediaId);

    return {
      full_name: row.fullName,
      nickname: row.nickname,
      instagram: row.instagram,
      father_name: row.fatherName,
      mother_name: row.motherName,
      child_order: row.childOrder,
      // A URL, never `photo_media_id`: an id a guest cannot resolve is useless to them
      // and is one more internal identifier on a public page. The canonical path is
      // `couple.<role>.photo`, and the renderer uses its value as an image source.
      //
      // The THUMBNAIL (300w), since `P2-13`. The portrait is drawn 140px square
      // (`.wi-portrait`), and this used to be the 1600w file — two ~150KB downloads for two
      // small squares, sharing a slow link with the cover photo that is the page's LCP
      // element. 300px covers 140px at 2x density (ADR-067).
      ...(photo === undefined
        ? {}
        : (() => {
            const urls = mediaUrls(photo, cdnBaseUrl);
            return urls.thumbnail_url === undefined
              ? {}
              : { photo: urls.thumbnail_url };
          })()),
    };
  };

  const events: PublicEventDto[] = shown(PATH_OF.events)
    ? byOrder(found.aggregate.events).map((e) => ({
        type: e.type,
        title: e.title,
        date: e.eventDate,
        // `HH:MM`: Postgres reads `time` back with seconds (`P2-15`).
        start_time: toClockTime(e.startTime),
        end_time: toClockTime(e.endTime),
        // `P2-16`: the zone `start_time` is in, for the label and the countdown.
        timezone: e.timezone,
        venue_name: e.venueName,
        address: e.address,
        latitude: e.latitude,
        longitude: e.longitude,
        maps_url: e.mapsUrl,
        description: e.description,
      }))
    : [];

  const gallery: PublicGalleryDto[] = shown(PATH_OF.gallery)
    ? byOrder(
        found.gallery.map((entry: GalleryEntry) => ({
          displayOrder: entry.photo.displayOrder,
          entry,
        })),
      ).map(({ entry }) => ({
        caption: entry.photo.caption,
        is_cover: entry.photo.isCover,
        order: entry.photo.displayOrder,
        width: entry.media.width,
        height: entry.media.height,
        ...mediaUrls(entry.media, cdnBaseUrl),
      }))
    : [];

  const quote = shown(PATH_OF.quote)
    ? {
        text: found.aggregate.quote?.text ?? null,
        source: found.aggregate.quote?.source ?? null,
      }
    : { text: null, source: null };

  return {
    status: "published",
    template: {
      sections: found.template.sections,
      theme: found.template.theme,
      customizable_theme_keys: [...found.template.customizableThemeKeys],
      thumbnail_url: found.template.thumbnailUrl,
    },
    display: { watermark: found.watermark },
    invitation: {
      couple: {
        groom: person("groom", PATH_OF.groom),
        bride: person("bride", PATH_OF.bride),
      },
      events,
      gallery: { photos: gallery },
      quote,
      settings: {
        enabled_sections: [...enabledSections],
        theme_override: settings?.themeOverride ?? {},
        rsvp_enabled: settings?.rsvpEnabled ?? true,
        guestbook_enabled: settings?.guestbookEnabled ?? true,
        seo_indexable: settings?.seoIndexable ?? false,
        /*
         * `guestbook_moderation` is deliberately NOT here, and it is the exclusion worth
         * explaining: it is a setting, so it looks like it belongs beside its two
         * neighbours. But it tells a guest whether their message appears immediately or
         * waits for approval — which is precisely the knowledge that makes moderation
         * worth evading. The page does not need it: a submitted message is confirmed by
         * the submission response, not by this payload.
         */
      },
      // Absent, not empty. An empty array says "the couple listed no accounts"; absence
      // says "this invitation does not show gift accounts", which is the true statement
      // and the one BR-4.1 asks for.
      ...(shown(PATH_OF.bankAccounts)
        ? {
            gift: {
              accounts: byOrder(found.aggregate.bankAccounts).map((b) => ({
                type: b.type,
                provider_name: b.providerName,
                // Published on purpose. `docs/SECURITY/09` § Encryption (ADR-025): the
                // couple enters an account number IN ORDER to show it to guests, and the
                // gift section being on is that consent.
                account_number: b.accountNumber,
                account_holder: b.accountHolder,
                order: b.displayOrder,
              })),
            },
          }
        : {}),
    },
  };
}
