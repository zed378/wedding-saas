import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * P2-02 — the public surface's first unit tests.
 *
 * Until now this application had nothing to test: `P0-22` built a skeleton and the
 * renderer arrives here. Its `test` script said exactly that, and now runs something.
 *
 * The React plugin is required for the same reason `frontend/web-app` needs it: Next sets
 * `jsx: "preserve"` in the tsconfig esbuild reads, so without it every `.tsx` fails to
 * parse and the failure is reported as a syntax error in the test rather than as a
 * configuration problem (`P1-22`).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      /*
       * `server-only` is Next's build-time guard: importing it from a client component is
       * a build error, which is how `lib/public-invitation.ts` and `lib/config.ts` keep
       * the internal API address out of the browser bundle. It resolves through Next's
       * bundler rather than Node's resolver, so Vitest cannot load it -- and the alias is
       * an empty module rather than a stub with behaviour, because there is nothing to
       * emulate: the guard is the import existing, not anything it does.
       */
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
