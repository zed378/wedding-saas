import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { Pool } from "pg";

import { Redis as IORedis } from "ioredis";

import { HealthController } from "../../src/http/health.controller";
import { DB_POOL } from "../../src/infra/db/client";
import { RATE_LIMIT_REDIS } from "../../src/shared/rate-limit/rate-limiter";
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

const REDIS_URL =
  process.env["TEST_REDIS_URL"] ??
  process.env["REDIS_URL"] ??
  "redis://localhost:56379";

/**
 * A Redis client shaped like the limiter's, because that is the one readiness checks.
 *
 * `enableOfflineQueue: false` is what makes an unreachable Redis fail the probe FAST
 * rather than hanging until the 2s timeout -- and it is also the option that made
 * `P1-07`'s cold start possible, so the harness connects deliberately.
 */
async function redisClient(url: string): Promise<IORedis> {
  const client = new IORedis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    commandTimeout: 1000,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  await client.connect().catch(() => {
    // A deliberately unreachable URL is one of the cases under test.
  });
  return client;
}

async function appWith(
  connectionString: string,
  redisUrl: string = REDIS_URL,
): Promise<{ app: INestApplication; pool: Pool; redis: IORedis }> {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 1_500,
    max: 1,
  });
  const redis = await redisClient(redisUrl);
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: DB_POOL, useValue: pool },
      { provide: RATE_LIMIT_REDIS, useValue: redis },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, pool, redis };
}

describe("liveness", () => {
  let app: INestApplication;
  let pool: Pool;
  let redis: IORedis;

  beforeAll(async () => {
    ({ app, pool, redis } = await appWith(DATABASE_URL));
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await redis?.quit().catch(() => redis.disconnect());
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
  let redis: IORedis;

  beforeAll(async () => {
    ({ app, pool, redis } = await appWith(DATABASE_URL));
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await redis?.quit().catch(() => redis.disconnect());
  });

  it("answers 200 with each dependency named", async () => {
    const res = await request(app.getHttpServer()).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      checks: { database: "ok", redis: "ok" },
    });
  });
});

describe("readiness — database unreachable", () => {
  let app: INestApplication;
  let pool: Pool;
  let redis: IORedis;

  beforeAll(async () => {
    // A port nothing listens on. Not a mock: pg's real failure here is an
    // AggregateError with an EMPTY message, which is what made the first version of
    // this check log `error: ""` and tell an operator nothing.
    ({ app, pool, redis } = await appWith(
      "postgres://wedding_app:x@127.0.0.1:59999/wedding",
    ));
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end().catch(() => {});
    await redis?.quit().catch(() => redis.disconnect());
  });

  it("answers 503", async () => {
    const res = await request(app.getHttpServer()).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unavailable");
  });

  it("names which dependency is down, but not why", async () => {
    const res = await request(app.getHttpServer()).get("/readyz");

    expect(res.body.checks).toEqual({
      database: "unavailable",
      redis: "ok",
    });
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

/**
 * The case this endpoint was blind to until `P1-07`.
 *
 * The database is fine and Redis is not — which on staging meant credential endpoints
 * failing closed with 503 while `/readyz` answered `{"status":"ok"}` and the container
 * reported healthy. `docs/DEVOPS/05` § Health Check named both dependencies from the
 * start; only one was ever checked.
 */
describe("readiness — redis unreachable, database fine", () => {
  let app: INestApplication;
  let pool: Pool;
  let redis: IORedis;

  beforeAll(async () => {
    ({ app, pool, redis } = await appWith(
      DATABASE_URL,
      // A port nothing listens on, like the database case above.
      "redis://127.0.0.1:59998",
    ));
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end().catch(() => {});
    await redis?.quit().catch(() => redis.disconnect());
  });

  it("answers 503 rather than ok", async () => {
    const res = await request(app.getHttpServer()).get("/readyz");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unavailable");
  });

  it("names redis as the dependency that is down, and says the database is not", async () => {
    const res = await request(app.getHttpServer()).get("/readyz");

    expect(res.body.checks).toEqual({ database: "ok", redis: "unavailable" });
    // Same discipline as the database case: which, never why.
    expectNoInternalLeak(res);
    expect(JSON.stringify(res.body)).not.toContain("59998");
    expect(JSON.stringify(res.body)).not.toContain("ECONNREFUSED");
  });

  it("liveness still answers ok", async () => {
    // Redis being down is not a reason to restart a process that is running correctly.
    const res = await request(app.getHttpServer()).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
