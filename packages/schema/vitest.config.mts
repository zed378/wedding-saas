import { defineConfig } from "vitest/config";

/**
 * Pure unit tests. Everything in this package is a function over a plain object -- no
 * database, no clock, no network -- which is the property that lets the same code run in
 * the editor, in the publish endpoint and in the server-rendered public page.
 */
export default defineConfig({
  test: { globals: true, environment: "node", include: ["src/**/*.spec.ts"] },
});
