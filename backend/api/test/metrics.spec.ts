import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";

import { ENV } from "../src/config/config.module";
import type { Env } from "../src/config/env.schema";
import { AppExceptionFilter } from "../src/http/exception.filter";
import { Counter, metrics, renderMetrics } from "../src/shared/metrics/metrics";
import { MetricsController } from "../src/shared/metrics/metrics.controller";

/** `P3-05` — the counter registry, the scrape endpoint, and the alert rules that depend on both. */

describe("Counter", () => {
  it("renders Prometheus text with labels in declared order, escaped", () => {
    const counter = new Counter("wi_test_total", "A test.", ["b", "a"]);
    counter.inc({ a: "1", b: 'x"y' });
    counter.inc({ a: "1", b: 'x"y' }, 2);
    expect(counter.get({ a: "1", b: 'x"y' })).toBe(3);
    expect(counter.render()).toBe(
      [
        "# HELP wi_test_total A test.",
        "# TYPE wi_test_total counter",
        'wi_test_total{b="x\\"y",a="1"} 3',
      ].join("\n"),
    );
  });

  it("refuses a name Prometheus would reject", () => {
    expect(() => new Counter("wi-bad", "x", [])).toThrow();
  });
});

describe("GET /metrics", () => {
  const TOKEN = "t".repeat(40);

  const appWith = async (env: Partial<Env>): Promise<INestApplication> => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        { provide: APP_FILTER, useClass: AppExceptionFilter },
        { provide: ENV, useValue: env },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
  };

  let app: INestApplication;
  let disabled: INestApplication;

  beforeAll(async () => {
    app = await appWith({ METRICS_TOKEN: TOKEN });
    disabled = await appWith({});
    // Two Nest applications; under `pnpm verify`'s parallel run the default 10 s was not enough.
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await disabled.close();
  });

  it("serves the registry to the bearer of the token", async () => {
    metrics.paymentWebhookSignatureInvalid.inc({
      provider: "fake",
      reason: "signature_mismatch",
    });
    const res = await request(app.getHttpServer())
      .get("/metrics")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain(
      "# TYPE wi_payment_webhook_signature_invalid_total counter",
    );
    expect(res.text).toContain(
      'wi_payment_webhook_signature_invalid_total{provider="fake",reason="signature_mismatch"}',
    );
  });

  it.each([
    ["no token", undefined],
    ["a wrong token", `Bearer ${"u".repeat(40)}`],
    ["the token without Bearer", TOKEN],
  ])(
    "answers 404 with %s, not even revealing the endpoint",
    async (_label, header) => {
      const req = request(app.getHttpServer()).get("/metrics");
      const res =
        header === undefined
          ? await req
          : await req.set("Authorization", header);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain("wi_");
    },
  );

  it("does not exist when METRICS_TOKEN is unset", async () => {
    const res = await request(disabled.getHttpServer())
      .get("/metrics")
      .set("Authorization", "Bearer ");
    expect(res.status).toBe(404);
  });
});

describe("deploy/prometheus/alerts.yml", () => {
  const rules = readFileSync(
    join(__dirname, "..", "..", "..", "deploy", "prometheus", "alerts.yml"),
    "utf8",
  );

  it("alerts on invalid payment signatures (P3-05 DoD 5, docs/DEVOPS/07)", () => {
    expect(rules).toContain("alert: PaymentWebhookInvalidSignatures");
    expect(rules).toContain("wi_payment_webhook_signature_invalid_total");
  });

  it("references only metrics the API registers", () => {
    const referenced = [...new Set(rules.match(/\bwi_[a-z0-9_]+/g) ?? [])];
    const registered = Object.values(metrics).map((c) => c.name);
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((name) => !registered.includes(name))).toEqual([]);
    expect(renderMetrics()).toContain("wi_payment_needs_review_total");
  });
});
