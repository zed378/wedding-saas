import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import { AdminInvitationsController } from "../src/modules/admin/admin-invitations.controller";
import { AdminInvitationsService } from "../src/modules/admin/admin-invitations.service";
import { SessionService } from "../src/modules/auth/session.service";
import {
  RATE_LIMITER,
  POLICY_REGISTRY,
} from "../src/shared/rate-limit/rate-limit.guard";
import { PolicyRegistry } from "../src/shared/rate-limit/config";
import { NotFoundError, UnauthenticatedError } from "../src/http/errors";

describe("Admin Invitation Overview API (P5-10)", () => {
  let app: INestApplication;

  const INV_1_ID = "11111111-1111-4111-8111-111111111111";
  const INV_2_ID = "22222222-2222-4222-8222-222222222222";
  const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  const mockListResult = {
    data: [
      {
        id: INV_1_ID,
        slug: "budi-and-ratna",
        status: "published",
        owner_id: USER_ID,
        owner_email: "budi@example.com",
        owner_name: "Budi Santoso",
        template_name: "Elegant Rose",
        version: "2.1.0",
        expiry_date: "2027-09-01",
      },
      {
        id: INV_2_ID,
        slug: "siti-and-ahmad",
        status: "draft",
        owner_id: USER_ID,
        owner_email: "siti@example.com",
        owner_name: "Siti",
        template_name: "Minimalist",
        version: "1.0.0",
        expiry_date: null,
      },
    ],
    meta: { page: 1, per_page: 20, total: 2 },
  };
  const mockDetailResult = {
    id: INV_1_ID,
    slug: "budi-and-ratna",
    status: "published",
    owner: {
      id: USER_ID,
      email: "budi@example.com",
      full_name: "Budi Santoso",
    },
    template_version: {
      id: "version-1",
      name: "Elegant Rose",
      version: "2.1.0",
    },
    published_at: "2026-09-01T00:00:00.000Z",
    expiry_date: "2027-09-01",
    order_history: [{ id: "order-1", amount_total: "139000", status: "paid" }],
    status_history: [
      {
        from_status: "draft",
        to_status: "published",
        changed_at: "2026-09-01T00:00:00.000Z",
      },
    ],
  };

  const mockService = {
    listInvitations: vi.fn(async () => mockListResult),
    getInvitationById: vi.fn(
      async (_adminId: string, _reason: string, id: string) => {
        if (id === INV_1_ID) return mockDetailResult;
        throw new NotFoundError(`Invitation "${id}" not found.`);
      },
    ),
  };

  const mockSessions = {
    authenticate: vi.fn().mockImplementation(async (authHeader?: string) => {
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new UnauthenticatedError();
      }
      const token = authHeader.replace("Bearer ", "");
      if (token === "token_admin") {
        return {
          id: ADMIN_ID,
          role: "admin",
          email: "admin@test.com",
          fullName: "Admin",
          status: "active",
          emailVerified: true,
        };
      }
      if (token === "token_user") {
        return {
          id: USER_ID,
          role: "user",
          email: "user@test.com",
          fullName: "User",
          status: "active",
          emailVerified: true,
        };
      }
      throw new UnauthenticatedError();
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminInvitationsController],
      providers: [
        { provide: AdminInvitationsService, useValue: mockService },
        { provide: SessionService, useValue: mockSessions },
        { provide: APP_FILTER, useClass: AppExceptionFilter },
        {
          provide: RATE_LIMITER,
          useValue: {
            check: vi.fn().mockResolvedValue({
              allowed: true,
              limit: 300,
              remaining: 299,
              resetAt: Date.now() + 60000,
            }),
          },
        },
        {
          provide: POLICY_REGISTRY,
          useValue: new PolicyRegistry(undefined, undefined),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /api/v1/admin/invitations", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await request(app.getHttpServer()).get(
        "/api/v1/admin/invitations",
      );
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("rejects regular users with 403", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/invitations")
        .set("Authorization", "Bearer token_user");
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("returns paginated invitation list for admin", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/invitations")
        .set("Authorization", "Bearer token_admin");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.total).toBe(2);
      expect(mockService.listInvitations).toHaveBeenCalled();
    });

    it("passes search_slug to service", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/invitations?search_slug=budi")
        .set("Authorization", "Bearer token_admin");

      expect(res.status).toBe(200);
      expect(mockService.listInvitations).toHaveBeenCalledWith(
        ADMIN_ID,
        expect.objectContaining({ search_slug: "budi" }),
      );
    });

    it("passes search_user to service", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/invitations?search_user=siti")
        .set("Authorization", "Bearer token_admin");

      expect(res.status).toBe(200);
      expect(mockService.listInvitations).toHaveBeenCalledWith(
        ADMIN_ID,
        expect.objectContaining({ search_user: "siti" }),
      );
    });
  });

  describe("GET /api/v1/admin/invitations/:id", () => {
    it("returns invitation detail with owner, order, and status history (DoD 1)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/invitations/${INV_1_ID}?reason=Support+ticket+123`)
        .set("Authorization", "Bearer token_admin");

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(INV_1_ID);
      expect(res.body.data.owner.email).toBe("budi@example.com");
      expect(res.body.data.order_history[0].amount_total).toBe("139000");
      expect(res.body.data.status_history).toHaveLength(1);
      expect(mockService.getInvitationById).toHaveBeenCalledWith(
        ADMIN_ID,
        "Support ticket 123",
        INV_1_ID,
      );
    });

    it("uses default reason when not provided", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/invitations/${INV_1_ID}`)
        .set("Authorization", "Bearer token_admin");

      expect(res.status).toBe(200);
      expect(mockService.getInvitationById).toHaveBeenCalledWith(
        ADMIN_ID,
        "Admin read via overview page",
        INV_1_ID,
      );
    });

    it("returns 404 for unknown invitation (DoD 1)", async () => {
      const res = await request(app.getHttpServer())
        .get(
          "/api/v1/admin/invitations/99999999-9999-4999-8999-999999999999?reason=Support+ticket+404",
        )
        .set("Authorization", "Bearer token_admin");

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("rejects unauthenticated detail request with 401", async () => {
      const res = await request(app.getHttpServer()).get(
        `/api/v1/admin/invitations/${INV_1_ID}`,
      );
      expect(res.status).toBe(401);
    });

    it("rejects regular user detail request with 403", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/invitations/${INV_1_ID}`)
        .set("Authorization", "Bearer token_user");
      expect(res.status).toBe(403);
    });
  });

  it("rejects malformed UUIDs before the service or PostgreSQL query", async () => {
    const before = mockService.getInvitationById.mock.calls.length;
    const res = await request(app.getHttpServer())
      .get("/api/v1/admin/invitations/not-a-uuid")
      .set("Authorization", "Bearer token_admin");
    expect(res.status).toBe(400);
    expect(mockService.getInvitationById.mock.calls.length).toBe(before);
  });
  it("provides no invitation-content mutation endpoint", async () => {
    for (const method of ["patch", "post", "delete"] as const) {
      const res = await request(app.getHttpServer())
        [method](`/api/v1/admin/invitations/${INV_1_ID}`)
        .set("Authorization", "Bearer token_admin")
        .send({ status: "published", owner_id: ADMIN_ID });
      expect(res.status).toBe(404);
    }
  });
  it("rejects invalid pagination and sanitized-away audit reasons", async () => {
    expect(
      (
        await request(app.getHttpServer())
          .get("/api/v1/admin/invitations?limit=101")
          .set("Authorization", "Bearer token_admin")
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/v1/admin/invitations/${INV_1_ID}`)
          .query({ reason: "<script>alert(1)</script>" })
          .set("Authorization", "Bearer token_admin")
      ).status,
    ).toBe(400);
  });

  it("rate limits repeated admin enumeration before exposing any invitation", async () => {
    const limiter = app.get<{ check: ReturnType<typeof vi.fn> }>(RATE_LIMITER);
    limiter.check.mockResolvedValueOnce({
      allowed: false,
      blocked: true,
      limit: 300,
      remaining: 0,
      resetAt: Date.now() + 60000,
      retryAfterSeconds: 60,
    });
    const before = mockService.listInvitations.mock.calls.length;
    const res = await request(app.getHttpServer())
      .get("/api/v1/admin/invitations")
      .set("Authorization", "Bearer token_admin");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("60");
    expect(mockService.listInvitations.mock.calls.length).toBe(before);
    expect(JSON.stringify(res.body)).not.toContain("budi@example.com");
  });
});
