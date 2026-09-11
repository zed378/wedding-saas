import type { NextConfig } from "next";

/**
 * P0-22 — the public invitation renderer.
 *
 * A separate application on a separate host (`invitation.zedth.my.id`), and the
 * separation is a trust boundary rather than a deployment convenience: `docs/SECURITY/02`
 * keeps guest-submitted content -- RSVP names, guestbook messages -- off the same origin
 * as the authenticated application, so a stored-XSS escape on an invitation page cannot
 * reach a logged-in user's session.
 *
 * `docs/FRONTEND/07`: this is server-rendered, "not a pure SPA", because sharing bots do
 * not run JavaScript. An invitation pasted into WhatsApp has to produce a preview card
 * from the HTML the server sent.
 *
 * **`@wi/ui` is deliberately not a dependency.** Its tokens are application chrome
 * (`docs/UI-UX/07`, `08` both say so); an invitation's colours and fonts come from
 * `template_versions.theme`. Importing the dashboard's indigo here would give every
 * wedding the same palette, which is the whole thing `docs/PLAN/07` exists to prevent.
 */
const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@wi/api-client", "@wi/schema", "@wi/template-renderer"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Invitations are shared by link and sometimes embedded; SAMEORIGIN rather
          // than DENY leaves the preview iframe in the editor working.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;
