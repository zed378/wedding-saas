import { defineConfig } from "vitest/config";

/**
 * The queue suite. Needs a real Redis:
 *
 *   docker compose -f deploy/docker-compose.yml up -d redis
 *   REDIS_URL=redis://localhost:6379 pnpm --filter @wi/worker test:integration
 *
 * Serial, because every test shares one Redis database and flushes it between tests.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.itest.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
