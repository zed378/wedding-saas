import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CoverGate } from "../../components/CoverGate";
import { GuestGreeting } from "../../components/GuestGreeting";
import { Invitation } from "../../components/Invitation";
import { ShareBar } from "../../components/ShareBar";
import { InvitationFrame } from "../../components/InvitationFrame";
import { readConfig } from "../../lib/config";
import {
  fetchPublicInvitation,
  type PublicInvitation,
} from "../../lib/public-invitation";
import { safeJsonLd } from "../../lib/json-ld";
import {
  buildEventJsonLd,
  buildMetadata,
  coupleNames,
} from "../../lib/metadata";
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
 * The link preview and the robots directive. `P2-09`, `docs/PLAN/15`.
 *
 * The construction lives in `lib/metadata.ts`, which is a pure function of the payload —
 * so what a scraper can be shown is a list somebody can read, and a test can assert over
 * the whole serialized result that nothing else got in. A preview is cached by WhatsApp,
 * Facebook and Telegram, which is a wider and longer-lived audience than the page.
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

  return buildMetadata({
    invitation,
    slug,
    origin: readConfig().publicOrigin,
  });
}

export default async function InvitationPage({ params }: RouteParams) {
  const loaded = await load(params);
  if (loaded === undefined) notFound();

  const { slug, invitation } = loaded;
  const url = `${readConfig().publicOrigin}/${slug}`;
  const jsonLd = buildEventJsonLd(invitation, url);

  return (
    <InvitationFrame>
      {/*
       * `P2-10` step 2. Above the cover, and rendered only after hydration — a
       * server-rendered guest name would mean one cache entry per guest
       * (`docs/ARCHITECTURE/06` § Cache Segmentation), which is four hundred distinct
       * documents for one wedding.
       */}
      <GuestGreeting />

      {/*
       * schema.org `Event`. `docs/PLAN/15` calls it optional and `docs/SECURITY/09`
       * constrains its contents: the ceremony's name, when it starts and where, and
       * nothing else. No guests, no account numbers.
       *
       * `JSON.stringify` of an object this module built, never interpolated text — the
       * only way a `</script>` could reach the page is through a value, and stringify
       * escapes nothing, so the serialized string is checked for the sequence instead.
       */}
      {jsonLd !== undefined && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
        />
      )}
      {/*
       * `P2-10` step 5. The gate wraps the whole invitation because a gate has to be able
       * to contain what it gates — `P2-03`'s version lived inside the hero and could only
       * hide its own button.
       */}
      <CoverGate>
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

        {/*
         * `P2-10` step 4, inside the gate so it is part of the invitation rather than
         * chrome around it: a guest shares once they have read it, and a persistent
         * overlay on a phone covers the one screen the couple designed.
         */}
        <ShareBar coupleNames={coupleNames(invitation)} url={url} />
      </CoverGate>
    </InvitationFrame>
  );
}
