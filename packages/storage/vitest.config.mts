import { defineConfig } from "vitest/config";

/**
 * Pure unit tests. The path builder and the in-memory fake need no infrastructure,
 * which is the point of having a port at all -- everything above this package can be
 * tested without a bucket.
 */
export default defineConfig({
  test: { globals: true, environment: "node", include: ["src/**/*.spec.ts"] },
});
