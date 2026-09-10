import { defineConfig } from "vitest/config";

/**
 * Unit tests only -- the job catalogue and anything else that needs no infrastructure.
 *
 * `pnpm test` must work on a laptop with nothing started (the rule from P0-07), so the
 * queue suite lives under vitest.integration.config.mts instead. That one needs a real
 * Redis and FAILS rather than skips without it: a queue suite that skips reports green
 * for retry, dead-lettering and leader election that nobody verified.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.spec.ts"],
  },
});
