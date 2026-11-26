import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AdminDashboardService } from "../src/modules/admin/admin-dashboard.service";
import { AdminDashboardController } from "../src/modules/admin/admin-dashboard.controller";
import { SessionService } from "../src/modules/auth/session.service";
import { UnauthenticatedError } from "../src/http/errors";
import { AppExceptionFilter } from "../src/http/exception.filter";
import {
  RATE_LIMITER,
  POLICY_REGISTRY,
} from "../src/shared/rate-limit/rate-limit.guard";
import { PolicyRegistry } from "../src/shared/rate-limit/config";
import type { CachePort } from "../src/infra/cache/cache.port";
import type { Database } from "../src/infra/db/client";

describe("admin dashboard (P5-11)", () => {
  const summary = {
    total_users: 2,
    total_revenue: "139000",
    funnel: { created: 4, ever_paid: 2, paid_and_published: 1 },
  };
  it("serves a cached aggregate without querying customer data", async () => {
    const db = { execute: vi.fn() };
    const cache = { getJson: vi.fn().mockResolvedValue(summary) };
    const service = new AdminDashboardService(
      db as unknown as Database,
      cache as unknown as CachePort,
    );
    expect(await service.getDashboardMetrics({})).toEqual(summary);
    expect(db.execute).not.toHaveBeenCalled();
  });
  it("caches a database snapshot for 30 seconds", async () => {
    const db = { execute: vi.fn().mockResolvedValue({ rows: [{ summary }] }) };
    const cache = {
      getJson: vi.fn().mockResolvedValue(undefined),
      setJson: vi.fn(),
    };
    const service = new AdminDashboardService(
      db as unknown as Database,
      cache as unknown as CachePort,
    );
    expect(await service.getDashboardMetrics({})).toEqual(summary);
    expect(cache.setJson).toHaveBeenCalledWith(
      "admin-dashboard",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      summary,
      30,
    );
  });
  describe("HTTP authorization and envelope", () => {
    let app: INestApplication;
    const getDashboardMetrics = vi.fn().mockResolvedValue(summary);
    beforeAll(async () => {
      const module = await Test.createTestingModule({
        controllers: [AdminDashboardController],
        providers: [
          { provide: AdminDashboardService, useValue: { getDashboardMetrics } },
          { provide: APP_FILTER, useClass: AppExceptionFilter },
          {
            provide: SessionService,
            useValue: {
              authenticate: async (header?: string) => {
                if (!header) throw new UnauthenticatedError();
                return {
                  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                  role: header === "Bearer admin" ? "admin" : "user",
                };
              },
            },
          },
          {
            provide: RATE_LIMITER,
            useValue: {
              check: vi.fn().mockResolvedValue({
                allowed: true,
                limit: 300,
                remaining: 299,
                resetAt: Date.now() + 60_000,
              }),
            },
          },
          {
            provide: POLICY_REGISTRY,
            useValue: new PolicyRegistry(undefined, undefined),
          },
        ],
      }).compile();
      app = module.createNestApplication();
      await app.init();
    });
    afterAll(async () => {
      await app?.close();
    });
    it("denies unauthenticated access", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/dashboard/summary")
        .expect(401);
    });
    it("denies regular users without disclosing aggregates", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/dashboard/summary")
        .set("Authorization", "Bearer user")
        .expect(403);
      expect(response.body.data).toBeUndefined();
    });
    it("returns the API/00 envelope for an administrator", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/admin/dashboard/summary")
        .set("Authorization", "Bearer admin")
        .expect(200);
      expect(response.body).toMatchObject({ success: true, data: summary });
    });
    it("rejects undocumented query fields", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/dashboard/summary?status=paid")
        .set("Authorization", "Bearer admin")
        .expect(400);
    });
  });
});
