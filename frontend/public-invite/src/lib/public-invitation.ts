import "server-only";

import type { SectionDefinition } from "@wi/template-renderer";

/**
 * `P2-08` step 2 — the server-side fetch. `docs/FRONTEND/07` § Data Fetching.
 *
 * *"A server-side fetch to `GET /public/i/:slug` (API/08) during rendering — NOT a
 * client-side fetch for the initial render (so the meta tags & main content are already
 * present in the initial HTML)."* The reason is in the document's first section: sharing
 * bots scrape `og:*` without executing JavaScript, so an invitation pasted into WhatsApp
 * has to produce its preview from the HTML the server sent.
 *
 * `server-only` makes that a build error rather than a convention. This module holds the
 * internal API address, which on the deployed stack is a container name that does not
 * resolve from a browser — importing it into a client component would produce a page that
 * works in development and fails in production.
 */

/** `docs/PLAN/08`'s canonical shape, as `docs/API/08` serves it (ADR-063). */
export interface PublicInvitation {
  readonly status: "published";
  readonly template: {
    readonly sections: readonly SectionDefinition[];
    readonly theme: Record<string, unknown>;
    readonly customizable_theme_keys?: readonly string[];
  };
  readonly display: { readonly watermark: boolean };
  readonly invitation: {
    readonly couple: Record<string, unknown>;
    readonly events: readonly Record<string, unknown>[];
    readonly gallery: { readonly photos: readonly Record<string, unknown>[] };
    readonly quote: Record<string, unknown>;
    readonly gift?: { readonly accounts: readonly Record<string, unknown>[] };
    readonly settings: {
      readonly enabled_sections: readonly string[];
      readonly theme_override?: Record<string, unknown>;
      readonly rsvp_enabled: boolean;
      readonly guestbook_enabled: boolean;
      readonly seo_indexable: boolean;
    };
  };
}

/**
 * The published invitation at this slug, or `null`.
 *
 * `null` for a 404 and `null` for a malformed body: the page does the same thing with
 * both, and there is no version of this page that can usefully show half an invitation.
 * Anything else — a 500, a timeout, the API being down — **throws**, because those are
 * temporary and rendering "this invitation does not exist" over an outage tells a couple's
 * guests something false and permanent-sounding.
 */
export async function fetchPublicInvitation(
  slug: string,
  options: { readonly baseUrl: string; readonly signal?: AbortSignal },
): Promise<PublicInvitation | null> {
  const base = options.baseUrl.replace(/\/+$/, "");

  const response = await fetch(`${base}/public/i/${encodeURIComponent(slug)}`, {
    headers: { accept: "application/json" },
    /*
     * `docs/ARCHITECTURE/06` wants this response cached with event-driven invalidation,
     * and the event arrives with `P3-09`. Until there is something to invalidate WITH, a
     * cache is a way to serve a couple their own typo back for an hour on the morning of
     * their wedding. `no-store` is the honest interim; `P3-09` changes this line and the
     * revalidation route lands with it.
     */
    cache: "no-store",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  if (response.status === 404) return null;

  if (!response.ok) {
    throw new Error(
      `public invitation request failed with ${String(response.status)}`,
    );
  }

  const body: unknown = await response.json();
  return unwrap(body);
}

/**
 * `docs/API/00`'s envelope, checked rather than assumed.
 *
 * A page that trusted `body.data` would render `undefined` into the invitation on any
 * response shape it did not expect — including an error envelope arriving with a 200,
 * which is what a misconfigured proxy in front of the API produces.
 */
function unwrap(body: unknown): PublicInvitation | null {
  if (typeof body !== "object" || body === null) return null;
  if ((body as { success?: unknown }).success !== true) return null;

  const data = (body as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;

  const shaped = data as Partial<PublicInvitation>;
  if (shaped.status !== "published") return null;
  if (typeof shaped.template !== "object" || shaped.template === null) {
    return null;
  }
  if (!Array.isArray(shaped.template.sections)) return null;
  if (typeof shaped.invitation !== "object" || shaped.invitation === null) {
    return null;
  }

  return data as PublicInvitation;
}
