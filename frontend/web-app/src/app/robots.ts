import type { MetadataRoute } from "next";

/**
 * `P2-11` step 5 — `robots.txt`. `docs/PLAN/15`.
 *
 * The asymmetry the card names: the catalogue is for search engines; everything behind a
 * login is somebody's private data. The private routes are disallowed here **and** carry
 * `noindex` from the root layout — `robots.txt` stops a crawl, it does not stop a URL
 * somebody linked to from being indexed, which is what the meta tag is for.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = (
    process.env["APP_PUBLIC_ORIGIN"] ?? "http://localhost:3100"
  ).replace(/\/+$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/templates"],
        disallow: [
          "/dashboard",
          "/editor",
          "/login",
          "/register",
          "/forgot-password",
          "/reset-password",
          "/verify-email",
          "/workbench",
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
