import "server-only";

import type { SectionDefinition } from "@wi/template-renderer";

import { apiQueryString, type CatalogQuery } from "./catalog-query";

/**
 * `P2-11` — the catalogue, fetched on the server.
 *
 * Server-side because `docs/PLAN/15` § Marketing Pages wants these pages indexable and fast:
 * *"Full SEO optimization: sitemap.xml, complete meta tags, indexable, fast loading
 * (SSR/SSG)"*. A catalogue rendered in the browser would be an empty grid to a crawler.
 *
 * `server-only` keeps `API_INTERNAL_BASE_URL` out of the browser bundle. On the deployed
 * stack it is a compose service name, `http://api:3000`, which does not resolve from a
 * visitor's machine and publishes the shape of the internal network for nothing.
 *
 * None of these calls carries a session. `docs/API/03` makes the three catalogue reads
 * anonymous precisely so a visitor can browse before registering (ADR-059).
 */

export interface TemplateSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly category: readonly string[];
  readonly is_premium: boolean;
  readonly thumbnail_url: string | null;
  readonly supported_sections: readonly string[];
}

export interface TemplateDetail extends TemplateSummary {
  readonly current_version: {
    readonly id: string;
    readonly version: string;
    readonly sections: readonly SectionDefinition[];
    readonly theme: Record<string, unknown>;
    readonly customizable_theme_keys: readonly string[];
  };
  /** The seeded demo invitation's public slug, or `null` when none exists. ADR-065. */
  readonly demo_slug: string | null;
}

export interface CatalogPage {
  readonly items: readonly TemplateSummary[];
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
}

/** The public invitation payload, only as far as the section previews read it. */
export interface DemoInvitation {
  readonly template: {
    readonly sections: readonly SectionDefinition[];
    readonly theme: Record<string, unknown>;
    readonly customizable_theme_keys?: readonly string[];
  };
  readonly invitation: Record<string, unknown> & {
    readonly settings: { readonly enabled_sections: readonly string[] };
  };
}

export interface CatalogConfig {
  /** The API root, without `/api/v1`. */
  readonly apiBaseUrl: string;
  /** The public invitation host, for the live demo link. */
  readonly publicInviteOrigin: string;
}

export function readCatalogConfig(): CatalogConfig {
  return {
    apiBaseUrl: (
      process.env["API_INTERNAL_BASE_URL"] ?? "http://localhost:3000"
    ).replace(/\/+$/, ""),
    publicInviteOrigin: (
      process.env["PUBLIC_INVITE_ORIGIN"] ?? "http://localhost:3200"
    ).replace(/\/+$/, ""),
  };
}

/**
 * Catalogue responses are revalidated every five minutes.
 *
 * The API caches the same reads for an hour and invalidates on publish (`P2-01`), so this is
 * a second, shorter layer in front of an already-cheap call. Five minutes bounds how long a
 * newly published template can be missing from the page without an invalidation hook from
 * the admin publish flow, which `P5-02` owns.
 */
const REVALIDATE_SECONDS = 300;

export async function fetchCatalog(
  query: CatalogQuery,
  config: CatalogConfig = readCatalogConfig(),
): Promise<CatalogPage> {
  const response = await fetch(
    `${config.apiBaseUrl}/api/v1/templates?${apiQueryString(query)}`,
    {
      headers: { accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
    },
  );

  if (!response.ok) {
    // Throw rather than render an empty grid. "No templates yet" during an outage tells a
    // visitor the product is empty, which is a worse first impression than an error page.
    throw new Error(`catalogue request failed with ${String(response.status)}`);
  }

  const body = (await response.json()) as {
    success?: boolean;
    data?: unknown;
    meta?: { page?: number; per_page?: number; total?: number };
  };

  if (body.success !== true || !Array.isArray(body.data)) {
    throw new Error("catalogue response was not a success envelope");
  }

  return {
    items: body.data as TemplateSummary[],
    page: body.meta?.page ?? query.page,
    perPage: body.meta?.per_page ?? body.data.length,
    total: body.meta?.total ?? body.data.length,
  };
}

/** A template's detail, or `null` for a 404. Other failures throw, for the same reason. */
export async function fetchTemplate(
  slug: string,
  config: CatalogConfig = readCatalogConfig(),
): Promise<TemplateDetail | null> {
  const response = await fetch(
    `${config.apiBaseUrl}/api/v1/templates/${encodeURIComponent(slug)}`,
    {
      headers: { accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
    },
  );

  // 400 as well as 404: the API validates the slug's shape and refuses a malformed one,
  // and to a visitor that is the same as a template that does not exist.
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) {
    throw new Error(`template request failed with ${String(response.status)}`);
  }

  const body = (await response.json()) as { success?: boolean; data?: unknown };
  if (
    body.success !== true ||
    typeof body.data !== "object" ||
    body.data === null
  ) {
    throw new Error("template response was not a success envelope");
  }

  return body.data as TemplateDetail;
}

/**
 * The demo invitation's public payload, for the section previews. `null` if it is not
 * published.
 *
 * Read from the **public** invitation API — the exact bytes a guest's browser receives —
 * rather than from a fixture. `docs/PLAN/07` § Demo Data rejected a demo-only data path
 * because it drifts, and a preview rendered from anything else would be a mock with extra
 * steps.
 *
 * A failure here returns `null` rather than throwing: the previews are an enhancement on a
 * page that is still complete without them, and the detail page should not become an error
 * page because the demo could not be read.
 */
export async function fetchDemoInvitation(
  demoSlug: string,
  config: CatalogConfig = readCatalogConfig(),
): Promise<DemoInvitation | null> {
  try {
    const response = await fetch(
      `${config.apiBaseUrl}/public/i/${encodeURIComponent(demoSlug)}`,
      {
        headers: { accept: "application/json" },
        next: { revalidate: REVALIDATE_SECONDS },
      },
    );
    if (!response.ok) return null;

    const body = (await response.json()) as {
      success?: boolean;
      data?: unknown;
    };
    if (
      body.success !== true ||
      typeof body.data !== "object" ||
      body.data === null
    ) {
      return null;
    }

    const data = body.data as Partial<DemoInvitation>;
    if (!Array.isArray(data.template?.sections)) return null;
    if (typeof data.invitation !== "object" || data.invitation === null)
      return null;

    return data as DemoInvitation;
  } catch {
    return null;
  }
}
