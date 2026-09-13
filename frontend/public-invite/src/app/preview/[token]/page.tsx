import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { Invitation } from "../../../components/Invitation";
import { InvitationFrame } from "../../../components/InvitationFrame";
import { PreviewWatermark } from "../../../components/PreviewWatermark";
import { WebVitals } from "../../../components/WebVitals";
import { readConfig } from "../../../lib/config";
import { fetchPreviewInvitation } from "../../../lib/public-invitation";

/**
 * `P2-12` — `/preview/{token}`. `docs/API/08`, `docs/DATABASE/04` § Share-Preview Tokens,
 * `docs/PLAN/01` FR-4.3.
 *
 * The same renderer as the public page, fed the preview payload. Three things differ, and
 * each is required rather than chosen:
 *
 *   - **always `noindex`** — in the metadata here, in an `X-Robots-Tag` on the API response,
 *     and in the payload's own `seo_indexable: false`. A draft in a search index cannot be
 *     taken back.
 *   - **always watermarked** — FR-4.3's "PREVIEW — NOT YET PUBLISHED", prominent enough that a
 *     screenshot of it cannot be mistaken for the real invitation.
 *   - **no share bar and no guest greeting** — the canonical address does not exist yet, so a
 *     share button would send guests to a not-found page.
 *
 * The token is never logged and never put anywhere but the URL it arrived in. `generateMetadata`
 * does not echo it into a canonical link, which would publish the credential in the page head.
 */

interface RouteParams {
  readonly params: Promise<{ readonly token: string }>;
}

export const metadata: Metadata = {
  title: "Pratinjau undangan",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
  // Stop the token leaking to any third party the page links to (maps, Instagram): a
  // `Referer` carrying `/preview/<token>` would hand the credential to whoever receives it.
  referrer: "no-referrer",
};

export default async function PreviewPage({ params }: RouteParams) {
  const { token } = await params;

  const invitation = await fetchPreviewInvitation(token, {
    baseUrl: readConfig().apiBaseUrl,
    forwardedFor: (await headers()).get("x-forwarded-for"),
  });
  if (invitation === null) notFound();

  return (
    <InvitationFrame>
      <WebVitals pageKind="preview" />
      <PreviewWatermark />
      <Invitation
        sections={invitation.template.sections}
        theme={invitation.template.theme}
        customizableThemeKeys={
          invitation.template.customizable_theme_keys ?? []
        }
        data={invitation.invitation as unknown as Record<string, unknown>}
        enabledSections={invitation.invitation.settings.enabled_sections}
        themeOverride={invitation.invitation.settings.theme_override}
      />
    </InvitationFrame>
  );
}
