import type { Metadata } from "next";
import Link from "next/link";

import { CatalogFilters } from "../../components/catalog/CatalogFilters";
import { TemplateCard } from "../../components/catalog/TemplateCard";
import { fetchCatalog } from "../../lib/catalog-api";
import {
  CATALOG_PAGE_SIZE,
  catalogHref,
  isFiltered,
  parseCatalogQuery,
} from "../../lib/catalog-query";

/**
 * `P2-11` step 1 — `/templates`. `docs/UI-UX/11` § Catalog Page.
 *
 * ## Indexed, unlike everything else in this application
 *
 * The root layout sets `noindex` for the whole app, because every page behind it is
 * somebody's private data. The catalogue is the deliberate exception: `docs/PLAN/15`
 * § Marketing Pages wants it indexable, and the card calls out the asymmetry in so many
 * words — *"catalog pages are for search engines; invitation pages are not"*.
 *
 * ## Filtered pages are not indexed separately
 *
 * `/templates?category=floral&page=2` is a real, shareable URL and it renders, but its
 * canonical is the unfiltered catalogue. Every combination of filter and page is otherwise
 * a distinct page to a crawler, most of them near-duplicates, and that dilutes the one page
 * that should rank.
 *
 * ## Sort
 *
 * `docs/UI-UX/11` lists *"Newest, Most Popular (based on usage count, if data is
 * available)"*. The API orders by newest and exposes no usage count, so Newest is the only
 * order there is, and the page says so rather than offering a control that does nothing.
 * Popularity needs a count over tenant invitations that the anonymous catalogue does not
 * have; it is recorded as `DF-12` rather than faked.
 */

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: "Template Undangan Pernikahan",
  description:
    "Pilih template undangan pernikahan digital — lihat demo langsung sebelum memakainya.",
  alternates: { canonical: "/templates" },
  robots: { index: true, follow: true },
};

export default async function TemplatesPage({ searchParams }: PageProps) {
  const query = parseCatalogQuery(await searchParams);
  const filtered = isFiltered(query);

  const [page, unfiltered] = await Promise.all([
    fetchCatalog(query),
    // Categories are offered from the whole published catalogue, not from the current
    // result: filtering by "floral" must not remove every other category from the menu.
    filtered ? fetchCatalog({ page: 1 }) : undefined,
  ]);

  const categories = [
    ...new Set((unfiltered ?? page).items.flatMap((item) => item.category)),
  ].sort((a, b) => a.localeCompare(b, "id"));

  const lastPage = Math.max(1, Math.ceil(page.total / CATALOG_PAGE_SIZE));

  return (
    <main
      id="main"
      className="mx-auto flex max-w-page flex-col gap-6 p-4 md:p-6"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text">Template undangan</h1>
        <p className="text-text-muted">
          Setiap template bisa dilihat demonya lebih dulu. Urutan: terbaru.
        </p>
      </header>

      <CatalogFilters query={query} categories={categories} />

      <p role="status" className="text-sm text-text-muted">
        {page.total === 0
          ? "Tidak ada template."
          : `${String(page.total)} template`}
      </p>

      {page.items.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface-raised p-6 text-center">
          <p className="text-text">
            {filtered
              ? "Tidak ada template yang cocok dengan pilihan ini."
              : "Belum ada template yang diterbitkan."}
          </p>
          {filtered && (
            <Link
              href="/templates"
              className="focus-ring mt-3 inline-block rounded-md px-2 py-1 text-sm font-medium text-primary-700 underline"
            >
              Tampilkan semua template
            </Link>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {page.items.map((template) => (
            <TemplateCard key={template.id} template={template} />
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <nav
          aria-label="Halaman"
          className="flex items-center justify-between gap-2"
        >
          {query.page > 1 ? (
            <Link
              href={catalogHref(query, { page: query.page - 1 })}
              rel="prev"
              className="focus-ring min-h-11 rounded-md border border-border px-4 py-2 text-sm font-medium text-text"
            >
              Sebelumnya
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-text-muted">
            Halaman {query.page} dari {lastPage}
          </span>
          {query.page < lastPage ? (
            <Link
              href={catalogHref(query, { page: query.page + 1 })}
              rel="next"
              className="focus-ring min-h-11 rounded-md border border-border px-4 py-2 text-sm font-medium text-text"
            >
              Berikutnya
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
