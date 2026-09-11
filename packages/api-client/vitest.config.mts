import { defineConfig } from "vitest/config";

/**
 * Node environment, not jsdom. The client is `fetch` and nothing else -- no DOM -- and
 * every test injects its own `fetch`, so there is no network and no browser to emulate.
 */
export default defineConfig({
  test: { globals: true, environment: "node", include: ["src/**/*.spec.ts"] },
});
