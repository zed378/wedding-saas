/**
 * `P2-11` step 1 — the catalogue's filters, as a URL.
 *
 * The card's DoD: *"Filters, search and sort work against the API and are reflected in the
 * URL."* The URL is the state, not a copy of it. A filtered catalogue page is something a
 * couple sends to their partner ("which of these?"), something a search engine indexes,
 * and something the Back button has to restore — and every one of those only works if the
 * query string is the single source of what is shown.
 *
 * Pure functions, no fetching and no React, so the parsing that decides what a stranger's
 * URL does is testable without a server around it.
 */

/** `docs/API/03` accepts exactly these. Anything else in the URL is ignored, not forwarded. */
export interface CatalogQuery {
  readonly category?: string | undefined;
  readonly search?: string | undefined;
  /** `docs/UI-UX/11` § Filter: price, Free/Premium. */
  readonly premium?: "true" | "false" | undefined;
  readonly page: number;
}

/**
 * The page size. `docs/UI-UX/11` asks for two columns on a phone and four on a desktop,
 * and twelve fills three rows of four without leaving an orphan in either layout.
 */
export const CATALOG_PAGE_SIZE = 12;

/** Longer than any template name or category; short enough to keep out of abuse territory. */
const MAX_SEARCH_LENGTH = 80;
const MAX_CATEGORY_LENGTH = 40;

/**
 * `searchParams` as a Next page receives them, into a query the API will accept.
 *
 * Every value is untrusted — this is a public URL. Anything malformed is **dropped** rather
 * than rejected, because the only sensible response to a mangled catalogue link is the
 * unfiltered catalogue, not an error page.
 */
export function parseCatalogQuery(
  params: Readonly<Record<string, string | string[] | undefined>>,
): CatalogQuery {
  const one = (key: string): string | undefined => {
    const value = params[key];
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  };

  const search = one("search");
  const category = one("category");
  const premium = one("premium");
  // Digits only. `parseInt("2abc")` is 2, which would let a mangled URL land on a real page
  // that nobody linked to — and a crawler would index it as one more duplicate.
  const rawPage = one("page") ?? "1";
  const page = /^[0-9]{1,6}$/.test(rawPage) ? Number(rawPage) : 1;

  return {
    ...(search === undefined
      ? {}
      : { search: search.slice(0, MAX_SEARCH_LENGTH) }),
    ...(category === undefined || category.length > MAX_CATEGORY_LENGTH
      ? {}
      : { category }),
    ...(premium === "true" || premium === "false" ? { premium } : {}),
    // A page below one, a fraction or a word is page one. The API refuses them with a 400,
    // and a catalogue link should never produce a validation error for a visitor.
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/**
 * The catalogue URL for a query, with some parts changed.
 *
 * Changing a filter resets to page one — staying on page three of a result set that now has
 * one page is how a visitor sees "no templates" for a filter that matches plenty.
 */
export function catalogHref(
  query: CatalogQuery,
  change: Partial<CatalogQuery> = {},
): string {
  const filterChanged =
    "search" in change || "category" in change || "premium" in change;

  const next: CatalogQuery = {
    ...query,
    ...change,
    page: change.page ?? (filterChanged ? 1 : query.page),
  };

  const params = new URLSearchParams();
  if (next.search !== undefined) params.set("search", next.search);
  if (next.category !== undefined) params.set("category", next.category);
  if (next.premium !== undefined) params.set("premium", next.premium);
  // Page one is the default and is left out, so `/templates` and `/templates?page=1` are
  // not two URLs for one page in a search index.
  if (next.page > 1) params.set("page", String(next.page));

  const search = params.toString();
  return search.length === 0 ? "/templates" : `/templates?${search}`;
}

/** The API's own query string for a catalogue query. `docs/API/03`. */
export function apiQueryString(query: CatalogQuery): string {
  const params = new URLSearchParams();
  if (query.search !== undefined) params.set("search", query.search);
  if (query.category !== undefined) params.set("category", query.category);
  if (query.premium !== undefined) params.set("is_premium", query.premium);
  params.set("page", String(query.page));
  params.set("per_page", String(CATALOG_PAGE_SIZE));
  return params.toString();
}

/** Is any filter active? The empty state says something different when one is. */
export function isFiltered(query: CatalogQuery): boolean {
  return (
    query.search !== undefined ||
    query.category !== undefined ||
    query.premium !== undefined
  );
}

/**
 * `P2-11` step 4 — where "Use This Template" goes.
 *
 * The protected create wizard, with the template in the query. That query string is the
 * whole of the logged-out flow: `RequireAuth` carries it through `/login?next=` and
 * `safeNext` hands it back after authenticating (`P1-20`), so the choice survives without
 * anything being written to storage. One function, so the page and the test that proves the
 * round trip cannot spell the URL differently.
 */
export function chooseTemplateHref(templateId: string): string {
  return `/dashboard/new?template=${encodeURIComponent(templateId)}`;
}
