import type { NextConfig } from "next";

/**
 * P0-22 — the authenticated application shell.
 *
 * `docs/ARCHITECTURE/02` § Logically Separate Applications: marketing, auth, dashboard,
 * editor and checkout, served from `app.zedth.my.id`. The public invitation is a
 * different app on a different host, and the admin panel is a third -- not for tidiness
 * but because `docs/SECURITY/02` puts them behind different trust boundaries with
 * separate sessions and cookie scopes.
 */
const config: NextConfig = {
  reactStrictMode: true,

  // The workspace packages ship TypeScript source rather than a bundled build, so Next
  // has to compile them as part of the app. Without this, `@wi/ui` fails at import with
  // a syntax error on the first `type` keyword.
  transpilePackages: ["@wi/ui", "@wi/api-client", "@wi/schema"],

  // docs/SECURITY/08. Caddy sets these at the edge in staging and production
  // (P0-23), but a dev server that does not is a dev server where a missing header is
  // invisible until deploy.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default config;
