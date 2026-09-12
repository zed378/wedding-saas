import react from "@vitejs/plugin-react";
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
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.spec.{ts,tsx}"],
  },
});
