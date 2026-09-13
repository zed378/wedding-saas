"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { catalogHref, type CatalogQuery } from "../../lib/catalog-query";

/**
 * `P2-11` step 1 — search, category and price. `docs/UI-UX/11` § Catalog Page.
 *
 * ## A real form that works without JavaScript
 *
 * `method="get"` to `/templates`, with the parameter names the page parses. With scripting
 * off, pressing Enter or the button submits it and the server renders the filtered page —
 * which is also exactly what a crawler following a filter link gets. JavaScript only adds
 * the debounce: the URL is updated as the visitor types, without a submit.
 *
 * ## Debounced, and `replace` rather than `push`
 *
 * `docs/UI-UX/11` asks for "a debounced search bar". Every keystroke a history entry would
 * make Back step through "E", "El", "Ele" before it left the page, so typing replaces the
 * entry and a deliberate change of category pushes one.
 */

const DEBOUNCE_MS = 350;

export interface CatalogFiltersProps {
  readonly query: CatalogQuery;
  /** Categories to offer, gathered from the published catalogue by the page. */
  readonly categories: readonly string[];
}

export function CatalogFilters({ query, categories }: CatalogFiltersProps) {
  const router = useRouter();
  const [search, setSearch] = useState(query.search ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The URL can change underneath the field — Back, or a category link — and the field has
  // to follow it, or it shows a search the page is no longer applying.
  useEffect(() => {
    setSearch(query.search ?? "");
  }, [query.search]);

  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );

  const onSearch = (value: string) => {
    setSearch(value);
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const trimmed = value.trim();
      router.replace(
        catalogHref(query, {
          search: trimmed.length === 0 ? undefined : trimmed,
        }),
        { scroll: false },
      );
    }, DEBOUNCE_MS);
  };

  return (
    <form
      method="get"
      action="/templates"
      role="search"
      aria-label="Saring template"
      className="flex flex-col gap-3 md:flex-row md:items-end"
      onSubmit={(event) => {
        // With JavaScript, apply immediately rather than reloading the page.
        event.preventDefault();
        if (timer.current !== undefined) clearTimeout(timer.current);
        const trimmed = search.trim();
        router.push(
          catalogHref(query, {
            search: trimmed.length === 0 ? undefined : trimmed,
          }),
        );
      }}
    >
      <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-text">
        Cari
        <input
          type="search"
          name="search"
          value={search}
          maxLength={80}
          placeholder="Nama atau kategori"
          onChange={(event) => {
            onSearch(event.target.value);
          }}
          className="focus-ring min-h-11 rounded-md border border-border bg-surface px-3 text-base text-text"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-text">
        Kategori
        <select
          name="category"
          value={query.category ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            router.push(
              catalogHref(query, {
                category: value.length === 0 ? undefined : value,
              }),
            );
          }}
          className="focus-ring min-h-11 rounded-md border border-border bg-surface px-3 text-base text-text"
        >
          <option value="">Semua kategori</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-text">
        Harga
        <select
          name="premium"
          value={query.premium ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            router.push(
              catalogHref(query, {
                premium:
                  value === "true" || value === "false" ? value : undefined,
              }),
            );
          }}
          className="focus-ring min-h-11 rounded-md border border-border bg-surface px-3 text-base text-text"
        >
          <option value="">Semua</option>
          <option value="false">Gratis</option>
          <option value="true">Premium</option>
        </select>
      </label>

      <button
        type="submit"
        className="focus-ring min-h-11 rounded-md bg-primary-600 px-4 text-sm font-medium text-text-inverse"
      >
        Terapkan
      </button>
    </form>
  );
}
