import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { Pool } from "pg";

import { HealthController } from "../../src/http/health.controller";
import { DB_POOL } from "../../src/infra/db/client";
import { DATABASE_URL } from "./helpers.ts";
import { expectNoInternalLeak } from "../support/envelope-assertions";

/**
 * P0-13 — liveness and readiness against a real database.
 *
 * The DoD item is "readiness fails when Postgres is down and the body still discloses
 * nothing about the infrastructure". Both halves need a real connection: a mocked pool
 * would prove the branch is reachable, not that the driver's failure is handled — and
 * the driver's failure turned out to be the interesting part.
 */

async function appWith(
  connectionString: string,
): Promise<{ app: INestApplication; pool: Pool }> {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 1_500,
    max: 1,
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: DB_POOL, useValue: pool }],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, pool };
}

describe("liveness", () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    ({ app, pool } = await appWith(DATABASE_URL));
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("answers ok and nothing else", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.status).toBe(200);
    // Exactly one key. An unauthenticated probe naming a version or a host is free
    // reconnaissance (docs/DEVOPS/05).
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("readiness — database reachable", () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    ({ app, pool } = await appWith(DATABASE_URL));
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("answers 200 with each dependency named", async () => {
    const res = await request(app.getHttpServer()).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", checks: { database: "ok" } });
  });
});

describe("readiness — database unreachable", () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    // A port nothing listens on. Not a mock: pg's real failure here is an
    // AggregateError with an EMPTY message, which is what made the first version of
    // this check log `error: ""` and tell an operator nothing.
    ({ app, pool } = await appWith(
      "postgres://wedding_app:x@127.0.0.1:59999/wedding",
    ));
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end().catch(() => {});
  });

  it("answers 503", async () => {
    const res = await request(app.getHttpServer()).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unavailable");
  });

  it("names which dependency is down, but not why", async () => {
    const res = await request(app.getHttpServer()).get("/readyz");

    expect(res.body.checks).toEqual({ database: "unavailable" });
    // No host, no port, no driver name, no error code. An operator gets the "which"
    // from here and the "why" from the log; an attacker probing an unauthenticated
    // endpoint gets neither.
    expectNoInternalLeak(res);
    expect(JSON.stringify(res.body)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(res.body)).not.toContain("59999");
  });

  it("liveness still answers ok, because it touches no dependency", async () => {
    // The distinction that matters. If liveness checked the database, a database blip
    // would restart every healthy replica and turn one outage into two.
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
