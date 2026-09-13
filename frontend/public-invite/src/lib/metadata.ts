import type { Metadata } from "next";
import { timezoneOffset } from "@wi/schema";

import type { PublicInvitation } from "./public-invitation";

/**
 * `P2-09` — the link preview, and the privacy default. `docs/PLAN/15`, `docs/FRONTEND/07`
 * § SEO Meta Generation, `docs/SECURITY/09`.
 *
 * ## `noindex` unless the couple said otherwise
 *
 * `docs/SECURITY/09`: *"Default `seo_indexable = false` so the invitation (which contains
 * guest info, RSVP) isn't automatically indexed by search engines without the user's
 * explicit consent."*
 *
 * The page carries guestbook messages and, once `P4` lands, RSVP replies — other people's
 * names and words, published by a couple who was thinking about their wedding rather than
 * about Google. The default therefore has to be the safe one, and it has to survive a
 * missing field: `indexable()` treats anything that is not exactly `true` as "no",
 * because a payload that lost the setting must not silently start indexing.
 *
 * ## What a preview may contain, and what it may not
 *
 * The couple's names, the date, the venue and a photo — the things printed on a physical
 * invitation and already visible to anyone with the link. Never a guest's name, never a
 * guestbook message, never an account number: a link preview is rendered by WhatsApp,
 * Facebook and Telegram and cached on their servers, which is a wider and far
 * longer-lived audience than the page itself.
 *
 * This module is a pure function of the payload for that reason — everything it can reach
 * is visible here, and `metadata.spec.ts` asserts over the whole serialized result that
 * nothing else got in.
 */

export interface MetadataInput {
  readonly invitation: PublicInvitation;
  readonly slug: string;
  /** The canonical origin, e.g. `https://invitation.vizunicum.my.id`. */
  readonly origin: string;
}

export function buildMetadata({
  invitation,
  slug,
  origin,
}: MetadataInput): Metadata {
  const names = coupleNames(invitation);
  const title =
    names === undefined
      ? "Undangan Pernikahan"
      : `Undangan Pernikahan ${names}`;
  const description = describe(invitation, names);
  const url = `${origin.replace(/\/+$/, "")}/${slug}`;
  const image = previewImage(invitation);
  const indexable = isIndexable(invitation);

  return {
    title,
    description,
    // `docs/PLAN/15`: the canonical is the invitation's ACTIVE address. When
    // per-invitation subdomains arrive the origin changes and the path form redirects
    // permanently, so this line follows the configuration rather than being rewritten.
    alternates: { canonical: url },
    robots: {
      index: indexable,
      follow: indexable,
      // A search engine that has already indexed the page must also stop showing a
      // cached copy and a text snippet of it; `index: false` alone leaves both.
      googleBot: {
        index: indexable,
        follow: indexable,
        ...(indexable ? {} : { noimageindex: true }),
      },
    },
    openGraph: {
      title,
      description,
      url,
      // `docs/PLAN/15` says `website` rather than `article` — an invitation is a place,
      // not a post, and `article` invites a byline and a publication date that a wedding
      // page has no business carrying.
      type: "website",
      locale: "id_ID",
      ...(image === undefined ? {} : { images: [{ url: image }] }),
    },
    twitter: {
      // `summary_large_image`: the photo IS the preview. A small card next to a wedding
      // invitation shows a thumbnail nobody can see a face in.
      card: "summary_large_image",
      title,
      description,
      ...(image === undefined ? {} : { images: [image] }),
    },
  };
}

/**
 * `robots`, as a boolean, failing closed.
 *
 * Exported so a caller can ask the question without rebuilding the whole object, and so
 * the default has one implementation. `!== true` rather than `=== false`: a missing
 * setting, a `null`, or a string `"false"` must all mean "do not index".
 */
export function isIndexable(invitation: PublicInvitation): boolean {
  return invitation.invitation.settings.seo_indexable === true;
}

/**
 * schema.org `Event`, or nothing.
 *
 * `docs/PLAN/15` calls this optional and `docs/SECURITY/09` constrains it: no bank
 * account numbers, no guest data. What is here is the ceremony's name, when it starts and
 * where — the contents of a printed invitation card.
 *
 * `undefined` when there is no event, rather than an `Event` with no date: structured
 * data that describes nothing is worse than absent, because a crawler will believe it.
 */
export function buildEventJsonLd(
  invitation: PublicInvitation,
  url: string,
): Record<string, unknown> | undefined {
  const event = invitation.invitation.events[0];
  if (event === undefined) return undefined;

  const date = str(event["date"]);
  if (date === undefined) return undefined;

  const names = coupleNames(invitation);
  const venue = str(event["venue_name"]);
  const address = str(event["address"]);
  const time = str(event["start_time"]);

  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name:
      names === undefined
        ? (str(event["title"]) ?? "Acara Pernikahan")
        : `Pernikahan ${names}`,
    // `YYYY-MM-DDTHH:MM:SS+08:00` when a time is known. Until `P2-16` this carried no zone:
    // the time was local and inventing `+07:00` would have been a guess about where the
    // wedding is. The event's `timezone` is now stored (ADR-070), so the offset is a fact —
    // and a search engine or calendar reading a zoneless time assumes the reader's own.
    // A payload from before the column reads as WIB, as the page itself does.
    startDate:
      time === undefined
        ? date
        : `${date}T${time}:00${timezoneOffset(event["timezone"])}`,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    url,
    ...(venue === undefined
      ? {}
      : {
          location: {
            "@type": "Place",
            name: venue,
            ...(address === undefined
              ? {}
              : {
                  address: { "@type": "PostalAddress", streetAddress: address },
                }),
          },
        }),
    /*
     * No `performer`, no `attendee`, no `offers`. The couple are not performers, the
     * guests are not public data, and an invitation is not ticketed -- and each of those
     * properties is an invitation to put a name or a price where one does not belong.
     */
  };
}

/** "Budi & Siti", from whichever name each person filled in. */
export function coupleNames(invitation: PublicInvitation): string | undefined {
  const couple = invitation.invitation.couple;

  const name = (role: string): string | undefined => {
    const person = couple[role];
    if (typeof person !== "object" || person === null) return undefined;

    const record = person as Record<string, unknown>;
    return str(record["nickname"]) ?? str(record["full_name"]);
  };

  const both = [name("groom"), name("bride")].filter(
    (value): value is string => value !== undefined,
  );

  return both.length === 0 ? undefined : both.join(" & ");
}

/**
 * The description a preview card shows under the title.
 *
 * Date and venue, which is what a guest needs to decide whether to open the link. No
 * address: a preview is cached by three platforms and a street address is more precision
 * than a shared card needs — the page itself has it, behind a deliberate tap.
 */
function describe(
  invitation: PublicInvitation,
  names: string | undefined,
): string {
  const event = invitation.invitation.events[0];

  const parts = [
    names === undefined ? undefined : `${names} mengundang Anda`,
    event === undefined ? undefined : str(event["date"]),
    event === undefined ? undefined : str(event["venue_name"]),
  ].filter((value): value is string => value !== undefined);

  return parts.length === 0
    ? "Undangan pernikahan digital."
    : `${parts.join(" · ")}.`;
}

/**
 * `docs/FRONTEND/07` § SEO Meta Generation: the photo with `is_cover`, falling back to
 * the template thumbnail.
 *
 * The fallback matters more than it looks. A couple who has not uploaded photos yet is
 * exactly the couple testing what their link looks like, and a preview with no image is
 * what they would see.
 *
 * Both are absolute CDN URLs already — a relative path would break in every scraper,
 * since none of them resolve one against the page.
 */
function previewImage(invitation: PublicInvitation): string | undefined {
  const photos = invitation.invitation.gallery.photos;
  const cover = photos.find((photo) => photo["is_cover"] === true) ?? photos[0];

  return str(cover?.["url"]) ?? str(invitation.template.thumbnail_url);
}

/** A non-empty string, or nothing. */
function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
