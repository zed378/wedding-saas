import { defineConfig } from "vitest/config";

/**
 * P2-02 — the renderer's own suite.
 *
 * jsdom, because the thing under test produces DOM: "a disabled section is absent from
 * the DOM, not hidden" is the card's own definition of done, and that is an assertion
 * about elements rather than about a returned value.
 *
 * No `@vitejs/plugin-react` here. This package compiles with `jsx: "react-jsx"` in its
 * own tsconfig, which esbuild honours — unlike `frontend/web-app`, where Next sets
 * `jsx: "preserve"` and the plugin is what fills the gap (`P1-22`'s record).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/testing/setup.ts"],
    include: ["src/**/*.spec.{ts,tsx}"],
  },
});
