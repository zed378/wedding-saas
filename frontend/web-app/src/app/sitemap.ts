import type { MetadataRoute } from "next";

import { fetchCatalog } from "../lib/catalog-api";
import { CATALOG_PAGE_SIZE } from "../lib/catalog-query";

/**
 * `P2-11` step 5 — the sitemap. `docs/PLAN/15` § Marketing Pages: "sitemap.xml".
 *
 * ## What is in it, and what never will be
 *
 * The home page, the catalogue, and one entry per published template. **No invitation**,
 * ever: invitations live on another host, default to `noindex` (`docs/SECURITY/09`), and a
 * sitemap listing them would be a directory of other people's weddings. No dashboard or
 * editor route either — those are private and `noindex` already.
 *
 * ## Absolute URLs
 *
 * The sitemap protocol requires them, and a relative `loc` is silently ignored by every
 * crawler that reads it. `APP_PUBLIC_ORIGIN` is the application's public address.
 *
 * ## A catalogue failure does not break the sitemap
 *
 * If the API is unreachable the static entries are still returned. A sitemap that 500s is
 * dropped by a crawler for days; one missing its template entries recovers on the next
 * fetch.
 */

/** Enough pages for any catalogue this product will have before `P7`. */
const MAX_PAGES = 20;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = (
    process.env["APP_PUBLIC_ORIGIN"] ?? "http://localhost:3100"
  ).replace(/\/+$/, "");

  const entries: MetadataRoute.Sitemap = [
    { url: `${origin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/templates`, changeFrequency: "daily", priority: 0.9 },
  ];

  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await fetchCatalog({ page });

      for (const template of result.items) {
        entries.push({
          url: `${origin}/templates/${encodeURIComponent(template.slug)}`,
          changeFrequency: "weekly",
          priority: 0.8,
        });
      }

      if (page * CATALOG_PAGE_SIZE >= result.total) break;
    }
  } catch {
    // Static entries only; see the note above.
  }

  return entries;
}
