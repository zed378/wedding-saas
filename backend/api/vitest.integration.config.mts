import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

/**
 * Integration tests — separate from the default suite on purpose.
 *
 * These need a real PostgreSQL. `pnpm test` must stay runnable on a laptop with
 * nothing started, so `*.itest.ts` is excluded from the unit config and lives here
 * behind `pnpm --filter @wi/api test:integration`.
 *
 * They do NOT skip when the database is missing; they fail with instructions. A
 * schema suite that skips reports green for constraints nobody verified, which is
 * worse than having no suite at all — see test/integration/users-schema.itest.ts.
 *
 * `P0-19` replaces the "start compose first" step with Testcontainers, at which point
 * this config keeps its shape and only the connection setup moves.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/integration/**/*.itest.ts"],
    setupFiles: ["./test/env.setup.ts"],
    // One database, shared tables, and `beforeEach` truncates. Parallel files would
    // delete each other's rows and fail in ways that look like constraint bugs.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
