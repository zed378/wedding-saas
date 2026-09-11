import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * P0-22 — the admin panel.
 *
 * Vite rather than Next (ADR-009): the admin panel is entirely behind authentication,
 * so there is no SEO, no social preview and no first-paint budget to defend. Everything
 * SSR buys is irrelevant here, and a plain SPA is less to run and less to secure.
 *
 * It is a **separate application**, not a route in `web-app`. `docs/SECURITY/02` puts it
 * behind its own trust boundary with its own hostname and its own session, so a stolen
 * user session cannot reach an admin screen and an XSS in the dashboard cannot reach
 * admin state. `P5-01` gives it the hostname.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3300 },
  build: { outDir: "dist", sourcemap: true },
});
