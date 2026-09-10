import { defineConfig } from "vitest/config";

/**
 * Needs real MinIO. Two P0-16 DoD items are claims about infrastructure -- "a direct
 * request to a bucket object URL is denied" and "the staging area is not publicly
 * reachable" -- and a fake cannot verify either, because the fake is ours.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.itest.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
