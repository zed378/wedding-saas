import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

/**
 * P1-25 — the service-layer coverage measurement.
 *
 * `docs/BACKEND/09` § Coverage asks for "a minimum of 80% line coverage" on the service
 * layer, and `P1-25`'s DoD asks for it to be met. `P0-17` will turn it into a gate; until
 * then this is the command that produces the number.
 *
 * ## Why it is a third config rather than a flag
 *
 * The two suites are deliberately separate — `pnpm test` must run with nothing started,
 * so `*.itest.ts` lives behind `test:integration`. But almost all service coverage comes
 * from the integration suite (the unit specs stub their services on purpose), and running
 * either alone reports a number that is true of that suite and false of the code. v8
 * coverage from two separate runs does not merge, so measuring honestly means one run
 * over both.
 *
 * That makes this config the one that needs a database, exactly like `test:integration`.
 *
 * ## What is counted
 *
 * `src/modules/**` only, and within it the service layer. Controllers are thin by design
 * (`docs/ARCHITECTURE/01`) and repositories are covered through the services that call
 * them; counting them would move the number without telling anybody anything.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "test/**/*.spec.ts",
      "src/**/*.spec.ts",
      "test/integration/**/*.itest.ts",
    ],
    setupFiles: ["./test/env.setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/modules/**/*.service.ts"],
      // Scaffolding, removed from the production module graph in `app.module.ts`. It has
      // no behaviour to cover and would drag the number down for nothing.
      exclude: ["src/modules/_reference/**"],
      reporter: ["text", "json-summary"],
      reportsDirectory: "./coverage",
      thresholds: {
        // `docs/BACKEND/09` § Coverage. Lines is the figure the document names; the
        // others are set where the suite already stands, so a drop is visible rather
        // than absorbed.
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 75,
      },
    },
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
