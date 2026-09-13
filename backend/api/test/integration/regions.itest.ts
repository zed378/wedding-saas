import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import Redis from "ioredis";

import { startHarness, type Harness } from "../support/harness";
import { ensureRegionsSeeded } from "../support/regions";
import { expectSuccess } from "../support/envelope-assertions";

/**
 * `P2-17` — `GET /api/v1/regions`, over HTTP against the real `AppModule`, a seeded database and
 * Redis. `MEMORY/specs/P2-17-regions.md` § 4 and § 12.
 */

interface Region {
  code: string;
  name: string;
  kind: string;
  level: number;
  timezone?: string;
}

describe("P2-17 — Indonesia's administrative regions", () => {
  let harness: Harness;
  let app: INestApplication;
  let server: unknown;
  let redis: Redis;

  const get = (path: string) =>
    request(server as never).get(`/api/v1/regions${path}`);

  beforeAll(async () => {
    harness = await startHarness();
    await ensureRegionsSeeded(harness.pool);

    process.env["DATABASE_URL"] = harness.databaseUrl.replace(
      /\/\/[^@]+@/,
      "//wedding_app:wedding_app_dev@",
    );
    process.env["REDIS_URL"] =
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56279";
    process.env["JWT_SIGNING_KEY"] = "regions-signing-key-0000000000000000000";
    process.env["RATE_LIMIT_OVERRIDES"] = JSON.stringify({
      "general-public": { limit: 50_000, windowSeconds: 60 },
    });

    redis = new Redis(process.env["REDIS_URL"], { maxRetriesPerRequest: 2 });
    const stale = await redis.keys("rl:*");
    if (stale.length > 0) await redis.del(...stale);
    // Earlier runs' cached region answers would hide a regression in the queries.
    await redis.incr("cache:gen:regions");

    const { AppModule } = await import("../../src/app.module.ts");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await redis?.quit().catch(() => redis.disconnect());
    await harness?.stop();
  });

  describe("the data", () => {
    it.each([
      [1, 38],
      [2, 514],
      [3, 7285],
      [4, 83762],
    ])(
      "has every level-%i region of Kepmendagri 300.2.2-2138/2025 (%i)",
      async (level, count) => {
        const { rows } = await harness.pool.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM regions WHERE level = $1",
          [level],
        );
        expect(Number(rows[0]!.n)).toBe(count);
      },
    );

    it("puts every province in the zone ADR-070 lists, and every regency in its province's", async () => {
      const WIT = ["81", "82", "91", "92", "93", "94", "95", "96"];
      const WITA = [
        "51",
        "52",
        "53",
        "63",
        "64",
        "65",
        "71",
        "72",
        "73",
        "74",
        "75",
        "76",
      ];
      const { rows } = await harness.pool.query<{
        code: string;
        timezone: string;
      }>("SELECT code, timezone FROM regions WHERE level = 1");
      for (const { code, timezone } of rows) {
        const expected = WIT.includes(code)
          ? "Asia/Jayapura"
          : WITA.includes(code)
            ? "Asia/Makassar"
            : "Asia/Jakarta";
        expect(timezone, code).toBe(expected);
      }
      const { rows: mismatched } = await harness.pool.query(
        `SELECT r.code FROM regions r JOIN regions p ON p.code = r.parent_code
         WHERE r.level = 2 AND r.timezone IS DISTINCT FROM p.timezone`,
      );
      expect(mismatched).toEqual([]);
    });

    it("cannot be changed by the application role", async () => {
      // Migration 0009 grants SELECT only. A bug or an injection in the API cannot rewrite it.
      const { Pool } = await import("pg");
      const appPool = new Pool({
        connectionString: process.env["DATABASE_URL"],
      });
      try {
        await expect(
          appPool.query("UPDATE regions SET name = 'x' WHERE code = '11'"),
        ).rejects.toThrow(/permission denied/);
        const { rows } = await appPool.query(
          "SELECT name FROM regions WHERE code = '11'",
        );
        expect(rows[0]).toEqual({ name: "Aceh" });
      } finally {
        await appPool.end();
      }
    });
  });

  describe("GET /regions", () => {
    it("lists the 38 provinces, publicly cacheable, with no session", async () => {
      const res = await get("");
      const provinces = expectSuccess<Region[]>(res);

      expect(provinces).toHaveLength(38);
      expect(provinces[0]).toEqual({
        code: "11",
        name: "Aceh",
        kind: "provinsi",
        level: 1,
        timezone: "Asia/Jakarta",
      });
      expect(res.headers["cache-control"]).toBe("public, max-age=86400");
    });

    it("lists a province's regencies and cities, and a district's villages", async () => {
      const bali = expectSuccess<Region[]>(await get("?parent=51"));
      expect(bali.map((r) => r.name)).toContain("Kota Denpasar");
      expect(bali.find((r) => r.code === "51.71")?.kind).toBe("kota");

      const [district] = expectSuccess<Region[]>(await get("?parent=51.71"));
      const villages = expectSuccess<Region[]>(
        await get(`?parent=${district!.code}`),
      );
      expect(villages.length).toBeGreaterThan(0);
      expect(["kelurahan", "desa"]).toContain(villages[0]!.kind);
    });

    it("answers a village's children with an empty list, and an unknown code with 404", async () => {
      expect(
        expectSuccess<Region[]>(await get("?parent=51.71.01.1001")),
      ).toEqual([]);
      expect((await get("?parent=99.99")).status).toBe(404);
    });

    it.each(["abc", "11.1", "11.01.01.1", "11;DROP"])(
      "refuses a malformed code %s before querying",
      async (code) => {
        expect((await get(`?parent=${encodeURIComponent(code)}`)).status).toBe(
          400,
        );
        expect((await get(`/${encodeURIComponent(code)}`)).status).toBe(400);
      },
    );
  });

  describe("GET /regions/:code", () => {
    it("returns a village with its province, regency and district", async () => {
      const detail = expectSuccess<Region & { ancestors: Region[] }>(
        await get("/51.71.01.1001"),
      );
      expect(detail.level).toBe(4);
      expect(detail.ancestors.map((a) => a.code)).toEqual([
        "51",
        "51.71",
        "51.71.01",
      ]);
    });
  });

  describe("GET /regions/locate", () => {
    it.each([
      [-8.65, 115.22, "51", "Asia/Makassar"], // Denpasar
      [-6.2, 106.82, "31", "Asia/Jakarta"], // Jakarta
      [-2.53, 140.7, "91", "Asia/Jayapura"], // Jayapura
      [-3.32, 114.59, "63", "Asia/Makassar"], // Banjarmasin, across the line from Central Kalimantan
    ])(
      "puts (%f, %f) in province %s, %s",
      async (latitude, longitude, province, zone) => {
        const located = expectSuccess<{
          province: Region;
          regency: Region | null;
          timezone: string;
        }>(await get(`/locate?latitude=${latitude}&longitude=${longitude}`));

        expect(located.province.code).toBe(province);
        expect(located.timezone).toBe(zone);
        expect(located.regency?.code.startsWith(`${province}.`)).toBe(true);
      },
    );

    it("answers 404 for a point in no province", async () => {
      expect(
        (await get("/locate?latitude=-12.46&longitude=130.84")).status,
      ).toBe(404); // Darwin
    });

    it("refuses coordinates out of range", async () => {
      expect((await get("/locate?latitude=91&longitude=0")).status).toBe(400);
    });
  });
});
