import { defineConfig } from "vitest/config";

/**
 * `P2-08` — the server-rendering check, separate from the unit suite.
 *
 * It boots `next start` against the built application, so it needs `next build` to have
 * run and it costs seconds rather than milliseconds. Keeping it out of `vitest run` means
 * the ordinary suite stays fast; `scripts/verify.sh` runs this one after the build step,
 * which is the only point at which it can pass.
 */
export default defineConfig({
  test: {
    include: ["test-ssr/**/*.ssr.ts"],
    // One server, many assertions. Parallel files would each try the same port.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
});
