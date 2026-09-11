import { defineConfig, devices } from "@playwright/test";

/**
 * The E2E runner. `docs/TESTING/00` § Test Strategy.
 *
 * The browser matrix is a skeleton on purpose: chromium runs by default, and the other
 * two are declared but only enabled by `E2E_FULL_MATRIX=1`. Running three browsers on
 * every change costs three times the wall clock for a signal that almost never differs,
 * and a suite that is slow is a suite people stop running. The full matrix belongs to a
 * pre-release check (`P6-*`), which is where cross-browser differences actually matter.
 *
 * SCOPE, as of `P0-22`: the suite now audits a real page. `workbench.e2e.ts` drives the
 * running `web-app` and runs axe over every component in every state -- which is the only
 * place `color-contrast` can run at all, because the jsdom pass in `@wi/ui` has no layout
 * engine and disables that rule.
 *
 * `accessibility.e2e.ts` keeps its fixture pair regardless. The broken fixture is the
 * negative control that proves the axe harness is doing something, and it stays useful
 * exactly because it is not a real page: a real page gets fixed, and a control that gets
 * fixed stops being a control.
 *
 * Two servers have to be up, and the suite says nothing useful if they are not:
 *
 *   docker compose -f deploy/docker-compose.yml up -d       # the API, for api-health
 *   pnpm --filter @wi/web-app build && pnpm --filter @wi/web-app start   # for workbench
 */

const fullMatrix = process.env["E2E_FULL_MATRIX"] === "1";

export default defineConfig({
  testDir: "./tests",
  // Playwright's default testMatch looks for *.spec.ts / *.test.ts. These are named
  // *.e2e.ts to distinguish them from the vitest suites at a glance, so the pattern has
  // to say so -- otherwise `playwright test` reports "No tests found", which is a
  // green-looking way to run nothing.
  testMatch: /.*\.e2e\.ts$/,
  // Fail the run if a test is left focused. `test.only` committed by accident silently
  // reduces the suite to one test and still reports green.
  forbidOnly: process.env["CI"] === "true",
  retries: 0,
  reporter: [["list"]],

  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://localhost:3000",
    // Artefacts only on failure. A trace per passing test fills a disk for nothing.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(fullMatrix
      ? [
          { name: "firefox", use: { ...devices["Desktop Firefox"] } },
          { name: "webkit", use: { ...devices["Desktop Safari"] } },
          // docs/UI-UX names mobile as the primary surface for a wedding invitation --
          // guests open a link on a phone -- so the mobile profile is not an extra.
          { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
        ]
      : []),
  ],
});
