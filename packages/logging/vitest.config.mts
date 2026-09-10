import { defineConfig } from "vitest/config";

/**
 * Pure unit tests -- redaction, context propagation and the logger's own formatters need
 * no infrastructure.
 *
 * `LOG_PRETTY=false` because a pretty transport is a worker thread, and a worker thread
 * holding a handle open is how a test run hangs after the last assertion passes.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    env: { LOG_PRETTY: "false" },
  },
});
