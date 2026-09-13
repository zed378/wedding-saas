import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import Redis from "ioredis";

import { logger } from "../../src/shared/logging/logger";

/**
 * `P2-13` step 5 — `POST /public/rum`, the real-user web-vitals sink.
 *
 * Unauthenticated, written to by every guest's browser, and feeding a log pipeline. So the
 * questions are what it accepts, what it refuses, and — the one that matters for privacy —
 * that nothing it logs could carry a URL or a credential.
 */

const VALID = {
  metric: "LCP",
  value: 1830.5,
  rating: "good",
  page_kind: "invitation",
};

describe("P2-13 — POST /public/rum", () => {
  let app: INestApplication;
  let server: unknown;
  let redis: Redis;

  const post = (body: unknown) =>
    request(server as never)
      .post("/public/rum")
      .set("content-type", "application/json")
      .send(JSON.stringify(body));

  beforeAll(async () => {
    process.env["DATABASE_URL"] = (
      process.env["MIGRATION_DATABASE_URL"] ??
      "postgres://wedding_owner:wedding_owner_dev@localhost:54432/wedding"
    ).replace(/\/\/[^@]+@/, "//wedding_app:wedding_app_dev@");
    process.env["REDIS_URL"] =
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56279";
    process.env["JWT_SIGNING_KEY"] = "public-rum-signing-key-00000000000000000";
    process.env["CDN_BASE_URL"] = "https://cdn.test";
    // See `public-invitation.itest.ts`: raised limit AND cleared blocks, or a previous run's
    // auto-block turns this file into a wall of 429s.
    process.env["RATE_LIMIT_OVERRIDES"] = JSON.stringify({
      "general-public": { limit: 50_000, windowSeconds: 60 },
    });

    redis = new Redis(
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56279",
      { maxRetriesPerRequest: 2, connectTimeout: 2000 },
    );
    await redis.ping();
    const stale = await redis.keys("rl:*");
    if (stale.length > 0) await redis.del(...stale);

    const { AppModule } = await import("../../src/app.module.ts");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await redis?.quit().catch(() => redis.disconnect());
  });

  it("accepts a valid report with 204 and no body", async () => {
    const res = await post(VALID);

    expect(res.status).toBe(204);
    expect(res.text).toBe("");
  });

  it("accepts every metric the reporter sends, at each rating", async () => {
    for (const metric of ["LCP", "CLS", "INP", "FCP", "TTFB"]) {
      for (const rating of ["good", "needs-improvement", "poor"]) {
        const res = await post({ ...VALID, metric, rating, value: 0.05 });
        expect(res.status, `${metric} ${rating}`).toBe(204);
      }
    }
  });

  it("logs the four fields and nothing else", async () => {
    const info = vi.spyOn(logger, "info");
    try {
      await post({ ...VALID, page_kind: "preview" });

      const call = info.mock.calls.find(
        ([fields]) =>
          (fields as { context?: { event?: string } }).context?.event ===
          "rum.web_vital",
      );
      expect(call, "no rum.web_vital line was logged").toBeDefined();
      expect((call![0] as { context: unknown }).context).toEqual({
        event: "rum.web_vital",
        metric: "LCP",
        value: 1830.5,
        rating: "good",
        page_kind: "preview",
      });
    } finally {
      info.mockRestore();
    }
  });

  it("refuses an unknown field rather than dropping it, so a URL can never ride along", async () => {
    const res = await post({
      ...VALID,
      url: "https://invitation.test/preview/Pv7kQ2mX9aLw4rT8nB3cY6dF1gH5jK0zE_s-uVoI2pA",
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("Pv7kQ2mX9a");
  });

  it.each([
    ["an unknown metric", { ...VALID, metric: "FID" }],
    ["an unknown rating", { ...VALID, rating: "great" }],
    ["an unknown page kind", { ...VALID, page_kind: "dashboard" }],
    ["a negative value", { ...VALID, value: -1 }],
    ["an absurd value", { ...VALID, value: 1e9 }],
    ["a string value", { ...VALID, value: "1830" }],
    ["a missing field", { metric: "LCP", value: 1, rating: "good" }],
    ["an array", [VALID]],
  ])("refuses %s with a 400 envelope", async (_label, body) => {
    const res = await post(body);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("is rate limited under the general public policy", async () => {
    const res = await post(VALID);

    expect(res.headers["x-ratelimit-limit"]).toBe("50000");
  });

  it("needs no session", async () => {
    // Explicitly: a guest has no account. The 204 above was already unauthenticated; this
    // pins that a bogus bearer token does not turn it into a 401 either.
    const res = await request(server as never)
      .post("/public/rum")
      .set("authorization", "Bearer not-a-token")
      .set("content-type", "application/json")
      .send(JSON.stringify(VALID));

    expect(res.status).toBe(204);
  });
});
