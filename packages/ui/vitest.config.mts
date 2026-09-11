import { defineConfig } from "vitest/config";

/**
 * Component tests run in jsdom with real user events and a real axe pass.
 *
 * `docs/UI-UX/17` § Testing asks for an automated accessibility audit; the DoD asks for
 * it per component. Running axe here rather than only in the browser E2E means a
 * component fails the moment it loses its label, not once someone assembles a page out
 * of it.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/testing/setup.ts"],
    include: ["src/**/*.spec.{ts,tsx}"],
  },
});
