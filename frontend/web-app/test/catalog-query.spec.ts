import { describe, expect, it } from "vitest";

import {
  apiQueryString,
  catalogHref,
  isFiltered,
  parseCatalogQuery,
  chooseTemplateHref,
} from "../src/lib/catalog-query";
import { loginUrlFor, safeNext } from "../src/lib/safe-next";

/**
 * `P2-11` DoD 1 — *"Filters, search and sort work against the API and are reflected in the
 * URL."*
 *
 * The URL is the catalogue's state. These functions decide what a stranger's link does, so
 * they are tested as the boundary they are: every value is untrusted and every malformed
 * one must degrade to the unfiltered catalogue rather than to an error.
 */

describe("parsing a catalogue URL", () => {
  it("reads the three filters and the page", () => {
    expect(
      parseCatalogQuery({
        search: "rose",
        category: "floral",
        premium: "true",
        page: "2",
      }),
    ).toEqual({ search: "rose", category: "floral", premium: "true", page: 2 });
  });

  it("is page one with no filters for a bare /templates", () => {
    expect(parseCatalogQuery({})).toEqual({ page: 1 });
  });

  it.each([
    ["zero", "0"],
    ["negative", "-3"],
    ["a fraction", "1.5"],
    ["a word", "dua"],
    ["huge garbage", "9e99x"],
  ])("treats a %s page as page one", (_label, page) => {
    // The API refuses these with a 400. A catalogue link must never become a validation
    // error for a visitor.
    expect(parseCatalogQuery({ page }).page).toBe(1);
  });

  it("drops a premium value that is not exactly true or false", () => {
    expect(parseCatalogQuery({ premium: "yes" })).not.toHaveProperty("premium");
    expect(parseCatalogQuery({ premium: "TRUE" })).not.toHaveProperty(
      "premium",
    );
  });

  it("drops empty and whitespace values rather than filtering by nothing", () => {
    expect(parseCatalogQuery({ search: "   ", category: "" })).toEqual({
      page: 1,
    });
  });

  it("caps the search length", () => {
    expect(parseCatalogQuery({ search: "a".repeat(500) }).search).toHaveLength(
      80,
    );
  });

  it("drops an overlong category rather than truncating it into a different one", () => {
    // Truncating a category would silently filter by a category nobody asked for.
    expect(parseCatalogQuery({ category: "c".repeat(41) })).not.toHaveProperty(
      "category",
    );
  });

  it("takes the first value when a parameter repeats", () => {
    expect(parseCatalogQuery({ category: ["floral", "modern"] }).category).toBe(
      "floral",
    );
  });
});

describe("building a catalogue URL", () => {
  it("is /templates for the default query", () => {
    expect(catalogHref({ page: 1 })).toBe("/templates");
  });

  it("omits page one, so one page has one URL in a search index", () => {
    expect(catalogHref({ page: 1, category: "floral" })).toBe(
      "/templates?category=floral",
    );
  });

  it("resets to page one when a filter changes", () => {
    // Staying on page three of a result that now has one page shows "no templates" for a
    // filter that matches plenty.
    expect(
      catalogHref({ page: 3, category: "floral" }, { category: "modern" }),
    ).toBe("/templates?category=modern");
  });

  it("keeps the filters when only the page changes", () => {
    expect(catalogHref({ page: 1, search: "rose" }, { page: 2 })).toBe(
      "/templates?search=rose&page=2",
    );
  });

  it("removes a filter set to undefined", () => {
    expect(
      catalogHref(
        { page: 1, search: "rose", premium: "true" },
        { search: undefined },
      ),
    ).toBe("/templates?premium=true");
  });

  it("round-trips through parsing", () => {
    const query = parseCatalogQuery({
      search: "rose & lily",
      category: "floral",
      premium: "false",
      page: "4",
    });
    const href = catalogHref(query);
    const back = parseCatalogQuery(
      Object.fromEntries(new URLSearchParams(href.split("?")[1])),
    );

    expect(back).toEqual(query);
  });
});

describe("the API's query string", () => {
  it("uses the API's own parameter names", () => {
    // `premium` in the URL a person reads, `is_premium` in the contract `docs/API/03`
    // defines. The translation lives here and nowhere else.
    const params = new URLSearchParams(
      apiQueryString({ page: 2, premium: "true", category: "floral" }),
    );

    expect(params.get("is_premium")).toBe("true");
    expect(params.get("category")).toBe("floral");
    expect(params.get("page")).toBe("2");
    expect(params.get("per_page")).toBe("12");
    expect(params.has("premium")).toBe(false);
  });
});

describe("isFiltered", () => {
  it("is false for the bare catalogue and true for any filter", () => {
    expect(isFiltered({ page: 5 })).toBe(false);
    expect(isFiltered({ page: 1, search: "x" })).toBe(true);
    expect(isFiltered({ page: 1, premium: "false" })).toBe(true);
  });
});

describe("a logged-out template choice survives authentication (DoD 3)", () => {
  it("round-trips the Use This Template link through the login guard", () => {
    /*
     * The chain, end to end, with the real functions: the detail page's link, the URL
     * `RequireAuth` sends an anonymous visitor to, and the destination `safeNext` returns
     * after login. If any link in it drops the query string, the visitor lands in the
     * wizard with no template chosen — which is the failure `docs/UI-UX/11` names.
     */
    const templateId = "0f8b3a2e-1c4d-4e5f-9a6b-7c8d9e0f1a2b";
    const href = chooseTemplateHref(templateId);
    const [pathname, query] = href.split("?");

    const login = new URL(
      loginUrlFor(pathname!, `?${query!}`),
      "https://app.test",
    );
    const next = login.searchParams.get("next");

    expect(safeNext(next)).toBe(href);
    expect(
      new URL(safeNext(next), "https://app.test").searchParams.get("template"),
    ).toBe(templateId);
  });
});
