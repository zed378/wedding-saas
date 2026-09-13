import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * P1-20 — component tests for the web app.
 *
 * Mirrors `@wi/ui`'s config rather than inventing a second convention: jsdom, real user
 * events, and a real axe pass. The DoD asks two questions that only a rendered component can
 * answer — "is any token in storage after a login" and "does this screen pass the automated
 * accessibility check" — and neither is answerable from a Playwright suite that needs the
 * whole app running.
 *
 * `color-contrast` still cannot run here; jsdom has no layout engine. `@wi/ui`'s
 * `token-contrast.spec.ts` computes the ratios from the token values and the E2E axe pass
 * checks rendered pixels. Named here so a green run is not read as more than it is.
 */
export default defineConfig({
  /**
   * Next's `tsconfig.json` sets `jsx: "preserve"` because Next owns the transform, and
   * esbuild reads that same file — so without a plugin every `.tsx` here fails to parse, and
   * it is reported as a syntax error in the test rather than as a configuration problem.
   *
   * The React plugin does the transform instead, which is the same thing `admin` already
   * does for its Vite build. `esbuild.tsconfigRaw` was tried first and does not override the
   * resolved tsconfig for files that have one.
   */
  plugins: [react()],
  resolve: {
    alias: {
      // `P2-11`. Next's build-time guard that keeps `lib/catalog-api.ts` out of the browser
      // bundle resolves through Next's bundler, not Node's, so Vitest cannot load it. The
      // guard is the import existing; there is no runtime behaviour to emulate.
      "server-only": fileURLToPath(
        new URL("./test/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.spec.{ts,tsx}"],
  },
});
