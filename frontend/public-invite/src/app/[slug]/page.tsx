import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Invitation } from "../../components/Invitation";
import { InvitationFrame } from "../../components/InvitationFrame";
import { readConfig } from "../../lib/config";
import {
  fetchPublicInvitation,
  type PublicInvitation,
} from "../../lib/public-invitation";
import { resolveSlug } from "../../lib/slug";

/**
 * `P2-08` — the invitation, server-rendered. `docs/FRONTEND/07`.
 *
 * ## The whole page exists in the HTML the server sends
 *
 * `docs/FRONTEND/07` opens with the reason: sharing bots scrape `og:*` without executing
 * JavaScript, so an invitation pasted into WhatsApp must produce its preview card from
 * the initial HTML. That rules out fetching on the client, and it is why the data arrives
 * here — in a server component — rather than in a `useEffect`.
 *
 * ## Two resolutions, not one
 *
 * The route gives a path segment; `resolveSlug` turns an **address** into a slug
 * according to the configured strategy (`docs/BACKEND/06`), so the eventual move to
 * per-invitation subdomains changes a configuration value rather than this file. A
 * segment that cannot be a slug is answered without a request.
 *
 * ## `notFound()` is the only failure that renders
 *
 * A 404 from the API means the invitation is not currently public — draft, unpublished,
 * expired, deleted or never existed, indistinguishably (`docs/API/08`). Anything else
 * throws and reaches `error.tsx`: a page saying "this invitation does not exist" during
 * an API outage tells a couple's guests something false, permanent-sounding, and on the
 * one day it matters most.
 */

interface RouteParams {
  readonly params: Promise<{ readonly slug: string }>;
}

/** Resolve the address, then load it. Shared by the page and its metadata. */
async function load(
  params: RouteParams["params"],
): Promise<{ slug: string; invitation: PublicInvitation } | undefined> {
  const { slug: segment } = await params;
  const config = readConfig();

  const slug = resolveSlug(config.slugStrategy, { pathname: `/${segment}` });
  if (slug === undefined) return undefined;

  const invitation = await fetchPublicInvitation(slug, {
    baseUrl: config.apiBaseUrl,
  });
  if (invitation === null) return undefined;

  return { slug, invitation };
}

/**
 * The link preview.
 *
 * Deliberately the minimum `P2-08` needs to be true — a title, a description and the
 * cover image — rather than the full treatment. `P2-09` owns SEO metadata, robots and
 * structured data, and writing half of it here would mean writing it twice.
 */
export async function generateMetadata({
  params,
}: RouteParams): Promise<Metadata> {
  /*
   * Not wrapped in a catch. `load` distinguishes the two failures and so must this: it
   * returns `undefined` for an invitation that is not public, and THROWS for an outage.
   * Swallowing the throw here turned an outage into the not-found PAGE, which tells a
   * couple's guests something false and permanent-sounding on the one day it matters.
   * With the throw propagating, an outage renders the error document instead.
   *
   * One wart remains and is not worth contorting the code for: Next falls back to the
   * not-found branch's metadata when `generateMetadata` throws, so that error document's
   * `<title>` still reads "Undangan tidak ditemukan". The body is right, the status is
   * right, and the title is wrong only while the API is down.
   */
  const loaded = await load(params);

  if (loaded === undefined) {
    return { title: "Undangan tidak ditemukan" };
  }

  const { slug, invitation } = loaded;
  const names = coupleNames(invitation);
  const title =
    names === undefined
      ? "Undangan Pernikahan"
      : `Undangan Pernikahan ${names}`;
  const url = `${readConfig().publicOrigin}/${slug}`;
  const cover = coverPhoto(invitation);

  return {
    title,
    description: firstEventLine(invitation),
    alternates: { canonical: url },
    openGraph: {
      title,
      ...(firstEventLine(invitation) === undefined
        ? {}
        : { description: firstEventLine(invitation) }),
      url,
      type: "website",
      ...(cover === undefined ? {} : { images: [{ url: cover }] }),
    },
  };
}

export default async function InvitationPage({ params }: RouteParams) {
  const loaded = await load(params);
  if (loaded === undefined) notFound();

  const { invitation } = loaded;

  return (
    <InvitationFrame>
      <Invitation
        sections={invitation.template.sections}
        theme={invitation.template.theme}
        customizableThemeKeys={
          invitation.template.customizable_theme_keys ?? []
        }
        // The invitation as `docs/PLAN/08`'s canonical object, straight from the API
        // (ADR-063). No reshaping here: a mapping in the consumer is a second place for
        // the shape to be wrong, and the first place already has a test walking the
        // template's declared paths against the payload.
        data={invitation.invitation as unknown as Record<string, unknown>}
        enabledSections={invitation.invitation.settings.enabled_sections}
        themeOverride={invitation.invitation.settings.theme_override}
      />
    </InvitationFrame>
  );
}

/** "Budi & Siti", from whichever of the two names the couple filled in. */
function coupleNames(invitation: PublicInvitation): string | undefined {
  const couple = invitation.invitation.couple;

  const name = (role: string): string | undefined => {
    const person = couple[role];
    if (typeof person !== "object" || person === null) return undefined;
    const record = person as Record<string, unknown>;
    for (const key of ["nickname", "full_name"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return undefined;
  };

  const both = [name("groom"), name("bride")].filter(
    (value): value is string => value !== undefined,
  );

  return both.length === 0 ? undefined : both.join(" & ");
}

/** The date and venue of the first event, as a one-line description. */
function firstEventLine(invitation: PublicInvitation): string | undefined {
  const event = invitation.invitation.events[0];
  if (event === undefined) return undefined;

  const parts = [event["date"], event["venue_name"]].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  return parts.length === 0 ? undefined : parts.join(" · ");
}

/**
 * `docs/FRONTEND/07` § SEO Meta Generation: the photo with `is_cover`, falling back to
 * the template thumbnail. The thumbnail is not in this payload, so the fallback here is
 * the first photo — `P2-09` wires the template thumbnail when it adds the rest of the
 * metadata.
 */
function coverPhoto(invitation: PublicInvitation): string | undefined {
  const photos = invitation.invitation.gallery.photos;
  const chosen =
    photos.find((photo) => photo["is_cover"] === true) ?? photos[0];

  const url = chosen?.["url"];
  return typeof url === "string" ? url : undefined;
}
