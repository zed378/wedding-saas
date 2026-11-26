import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import request from "supertest";
import { AdminAuditLogService } from "../src/modules/admin/audit-logs.service";
import { AdminAuditLogsController } from "../src/modules/admin/audit-logs.controller";
import { auditLogQuerySchema } from "../src/modules/admin/schemas/admin-action.schema";
import { AuditLogService } from "../src/shared/audit/audit-log.service";
import { SessionService } from "../src/modules/auth/session.service";
import { AppExceptionFilter } from "../src/http/exception.filter";
import { UnauthenticatedError } from "../src/http/errors";
import {
  POLICY_REGISTRY,
  RATE_LIMITER,
} from "../src/shared/rate-limit/rate-limit.guard";
import { PolicyRegistry } from "../src/shared/rate-limit/config";

const actorId = "22222222-2222-4222-8222-222222222222";
const resourceId = "33333333-3333-4333-8333-333333333333";
const row = {
  id: "44444444-4444-4444-8444-444444444444",
  adminId: actorId,
  adminEmail: "operator@example.test",
  action: "user.suspend",
  resourceType: "user",
  resourceId,
  reason: "Investigate reported abuse",
  beforeState: {
    status: "active",
    password_hash: "unsafe-old-hash",
    nested: { token: "secret-token" },
  },
  afterState: {
    status: "suspended",
    raw_callback_payload: { secret: "secret-callback" },
  },
  ipAddress: "127.0.0.1",
  createdAt: new Date("2026-01-02T10:00:00Z"),
};

function database(total = 1) {
  const where = vi.fn();
  const limit = vi.fn();
  const offset = vi.fn();
  const orderBy = vi.fn();
  const db: any = {
    select: vi.fn((shape) => {
      if ("total" in shape)
        return {
          from: () => ({
            where: (clause: unknown) => {
              where(clause);
              return Promise.resolve([{ total }]);
            },
          }),
        };
      return {
        from: () => ({
          leftJoin: () => ({
            where: (clause: unknown) => {
              where(clause);
              return {
                orderBy: (...sorts: unknown[]) => {
                  orderBy(...sorts);
                  return {
                    limit: (n: number) => {
                      limit(n);
                      return {
                        offset: (n: number) => {
                          offset(n);
                          return Promise.resolve([row]);
                        },
                      };
                    },
                  };
                },
              };
            },
          }),
        }),
      };
    }),
  };
  db.transaction = vi.fn((callback) => callback(db));
  return { db, where, limit, offset, orderBy };
}

describe("P5-12 audit query and export", () => {
  it("applies every filter in SQL and paginates in stable newest-first order", async () => {
    const { db, where, limit, offset, orderBy } = database();
    const service = new AdminAuditLogService(db, {
      record: vi.fn(),
    } as unknown as AuditLogService);
    const query = auditLogQuerySchema.parse({
      admin_id: actorId,
      resource_type: "user",
      resource_id: resourceId,
      date_from: "2026-01-01T00:00:00Z",
      date_to: "2026-01-03T00:00:00Z",
      page: 3,
      limit: 10,
    });
    await service.list(query);
    const dialect = new PgDialect();
    const compiled = where.mock.calls.map(([sql]) => dialect.sqlToQuery(sql));
    for (const sql of compiled) {
      expect(sql.sql).toContain('"audit_logs"."admin_id"');
      expect(sql.sql).toContain('"audit_logs"."resource_type"');
      expect(sql.sql).toContain('"audit_logs"."resource_id"');
      expect(sql.sql).toContain('"audit_logs"."created_at" >=');
      expect(sql.sql).toContain('"audit_logs"."created_at" <=');
      expect(sql.params).toEqual([
        actorId,
        "user",
        resourceId,
        "2026-01-01T00:00:00.000Z",
        "2026-01-03T00:00:00.000Z",
      ]);
    }
    expect(compiled).toHaveLength(2);
    expect(limit).toHaveBeenCalledWith(10);
    expect(offset).toHaveBeenCalledWith(20);
    expect(orderBy.mock.calls[0]).toHaveLength(2);
  });

  it("redacts historical credentials and callback data on both list and export", async () => {
    const { db } = database();
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new AdminAuditLogService(
      db,
      audit as unknown as AuditLogService,
    );
    const query = auditLogQuerySchema.parse({});
    const list = await service.list(query);
    const exported = await service.export(actorId, query);
    for (const result of [list, exported]) {
      const json = JSON.stringify(result);
      expect(json).not.toContain("unsafe-old-hash");
      expect(json).not.toContain("secret-token");
      expect(json).not.toContain("secret-callback");
      expect(json).toContain("[REDACTED]");
      expect(json).toContain("suspended");
    }
  });

  it("exports every matching page and audits the actor, filters and row count before returning", async () => {
    const { db, limit, offset } = database();
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new AdminAuditLogService(
      db,
      audit as unknown as AuditLogService,
    );
    const exported = await service.export(
      actorId,
      auditLogQuerySchema.parse({ resource_id: resourceId, page: 5 }),
    );
    expect(limit).toHaveBeenCalledWith(10_000);
    expect(offset).toHaveBeenCalledWith(0);
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "repeatable read",
    });
    expect(audit.record).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        adminId: actorId,
        action: "audit_log.export",
        resourceType: "audit_log_export",
        resourceId: exported.export_id,
        afterState: { filters: { resource_id: resourceId }, row_count: 1 },
      }),
    );
  });

  it("returns no export if writing its audit trail fails", async () => {
    const { db } = database();
    const service = new AdminAuditLogService(db, {
      record: vi.fn().mockRejectedValue(new Error("audit unavailable")),
    } as unknown as AuditLogService);
    await expect(
      service.export(actorId, auditLogQuerySchema.parse({})),
    ).rejects.toThrow("audit unavailable");
  });

  it("rejects oversized export instead of silently truncating evidence", async () => {
    const { db } = database(10_001);
    const audit = { record: vi.fn() };
    const service = new AdminAuditLogService(
      db,
      audit as unknown as AuditLogService,
    );
    await expect(
      service.export(actorId, auditLogQuerySchema.parse({})),
    ).rejects.toThrow();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects invalid IDs, dates, reversed ranges and unbounded pagination", () => {
    for (const query of [
      { resource_id: "bad" },
      { admin_id: "bad" },
      { date_from: "yesterday" },
      { date_from: "2026-02-01T00:00:00Z", date_to: "2026-01-01T00:00:00Z" },
      { limit: 101 },
      { page: 0 },
    ]) {
      expect(auditLogQuerySchema.safeParse(query).success).toBe(false);
    }
    expect(
      auditLogQuerySchema.safeParse({
        date_from: "2026-01-01T00:00:00Z",
        date_to: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});

describe("P5-12 audit HTTP authorization and append-only surface", () => {
  let app: INestApplication;
  const rateLimitCheck = vi.fn().mockResolvedValue({
    allowed: true,
    limit: 300,
    remaining: 299,
    resetAt: Date.now() + 60_000,
  });
  const rateLimitBlock = vi.fn().mockResolvedValue(undefined);
  const service = {
    list: vi.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      total_pages: 1,
    }),
    export: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminAuditLogsController],
      providers: [
        { provide: AdminAuditLogService, useValue: service },
        {
          provide: SessionService,
          useValue: {
            authenticate: vi.fn(async (header?: string) => {
              if (!header) throw new UnauthenticatedError();
              return {
                id: actorId,
                role: header.includes("regular") ? "user" : "admin",
                status: "active",
              };
            }),
          },
        },
        {
          provide: RATE_LIMITER,
          useValue: { check: rateLimitCheck, block: rateLimitBlock },
        },
        {
          provide: POLICY_REGISTRY,
          useValue: new PolicyRegistry(undefined, undefined),
        },
        { provide: APP_FILTER, useClass: AppExceptionFilter },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["", "/export"])(
    "rejects anonymous and regular user reads at %s",
    async (suffix) => {
      expect(
        (
          await request(app.getHttpServer()).get(
            `/api/v1/admin/audit-logs${suffix}`,
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/admin/audit-logs${suffix}`)
            .set("Authorization", "Bearer regular")
        ).status,
      ).toBe(403);
      expect(service.list).not.toHaveBeenCalled();
      expect(service.export).not.toHaveBeenCalled();
    },
  );

  it("passes authenticated actor and validated filters to audited export", async () => {
    const result = await request(app.getHttpServer())
      .get(`/api/v1/admin/audit-logs/export?resource_id=${resourceId}`)
      .set("Authorization", "Bearer admin");
    expect(result.status).toBe(200);
    expect(service.export).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({ resource_id: resourceId }),
    );
  });

  it.each(["", "/export"])(
    "enforces the general authenticated rate policy on %s",
    async (suffix) => {
      rateLimitCheck.mockResolvedValueOnce({
        allowed: false,
        limit: 300,
        remaining: 0,
        resetAt: Date.now() + 60_000,
        retryAfterSeconds: 60,
      });

      const result = await request(app.getHttpServer())
        .get(`/api/v1/admin/audit-logs${suffix}`)
        .set("Authorization", "Bearer admin");

      expect(result.status).toBe(429);
      expect(result.headers["retry-after"]).toBe("60");
      expect(rateLimitCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "general-authenticated",
          limit: 300,
          windowSeconds: 60,
          key: "user",
        }),
        actorId,
      );
      expect(rateLimitBlock).toHaveBeenCalled();
      expect(service.list).not.toHaveBeenCalled();
      expect(service.export).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed filters before reading or exporting", async () => {
    for (const suffix of ["", "/export"])
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/admin/audit-logs${suffix}?resource_id=bad`)
            .set("Authorization", "Bearer admin")
        ).status,
      ).toBe(400);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.export).not.toHaveBeenCalled();
  });

  it("provides no creation, update or delete endpoint for audit rows", async () => {
    for (const method of ["post", "put", "patch", "delete"] as const) {
      const result = await request(app.getHttpServer())
        [method](`/api/v1/admin/audit-logs/${resourceId}`)
        .set("Authorization", "Bearer admin")
        .send({ reason: "tampering" });
      expect(result.status).toBe(404);
    }
  });
});
