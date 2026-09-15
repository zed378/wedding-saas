import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DOMAIN_JOBS } from "../../src/jobs/domain-jobs";

/**
 * `P3-06`, ADR-078 — the jobs process's wiring, booted the way `dist/jobs/main.js` boots it: the whole
 * `AppModule` as an application context, no HTTP server. A job that cannot resolve its service would
 * otherwise first fail at 03:00 on a production night.
 *
 * The environment is set before `AppModule` is imported, as the IDOR sweep does, because configuration
 * is read at module construction. Other required values come from the integration config.
 */
describe("the API jobs process (ADR-078)", () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    process.env["DATABASE_URL"] = (
      process.env["MIGRATION_DATABASE_URL"] ??
      "postgres://wedding_owner:wedding_owner_dev@localhost:54432/wedding"
    ).replace(/\/\/[^@]+@/, "//wedding_app:wedding_app_dev@");
    process.env["REDIS_URL"] =
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56379";
    process.env["JWT_SIGNING_KEY"] ??=
      "domain-jobs-itest-signing-key-000000000000";

    const { AppModule } = await import("../../src/app.module.ts");
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it("resolves and runs every domain job against the real modules", async () => {
    for (const [name, job] of Object.entries(DOMAIN_JOBS)) {
      await expect(job(app), name).resolves.toBeDefined();
    }
  });
});
