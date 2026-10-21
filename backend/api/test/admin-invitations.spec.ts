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
        ownerId: "owner-1",
        ownerEmail: "budi@example.com",
        ownerFullName: "Budi Santoso",
        templateName: "Elegant Rose",
        templateVersionString: "v2.1",
        publishedAt: new Date("2026-09-01T00:00:00Z"),
        expiryDate: new Date("2027-09-01T00:00:00Z"),
        createdAt: new Date("2026-08-15T00:00:00Z"),
        updatedAt: new Date("2026-09-01T00:00:00Z"),
        latestOrder: {
          id: "ord-1",
          packageId: "premium",
          amountTotal: "249000",
        },
      },
      {
        id: INV_2_ID,
        slug: "siti-and-ahmad",
        status: "draft",
        ownerId: "owner-2",
        ownerEmail: "siti@example.com",
        ownerFullName: "Siti Nurhaliza",
        templateName: "Minimalist White",
        templateVersionString: "v1.0",
        publishedAt: null,
        expiryDate: null,
        createdAt: new Date("2026-10-01T00:00:00Z"),
        updatedAt: new Date("2026-10-01T00:00:00Z"),
        latestOrder: null,
      },
    ],
    meta: { page: 1, per_page: 20, total: 2 },
  };

  const mockDetailResult = {
    id: INV_1_ID,
    slug: "budi-and-ratna",
    status: "published",
    owner: {
      id: "owner-1",
      email: "budi@example.com",
      fullName: "Budi Santoso",
    },
    templateVersion: { id: "ver-1" },
    publishedAt: new Date("2026-09-01T00:00:00Z"),
    expiryDate: new Date("2027-09-01T00:00:00Z"),
    createdAt: new Date("2026-08-15T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    latestOrder: {
      id: "ord-1",
      packageId: "premium",
      amountTotal: "249000",
    },
    statusHistory: [
      {
        fromStatus: "draft",
        toStatus: "published",
        changedAt: new Date("2026-09-01T00:00:00Z"),
      },
    ],
  };

  const mockService = {
    listInvitations: vi.fn(async () => mockListResult),
    getInvitationById: vi.fn(async (_adminId: string, _reason: string, id: string) => {
      if (id === INV_1_ID) return mockDetailResult;
      throw new NotFoundError(`Invitation "${id}" not found.`);
    }),
  };

  const mockSessions = {
    authenticate: vi.fn().mockImplementation(async (authHeader?: string) => {
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new UnauthenticatedError();
      }
      const token = authHeader.replace("Bearer ", "");
      if (token === "token_admin") {
        return { id: ADMIN_ID, role: "admin", email: "admin@test.com", fullName: "Admin", status: "active", emailVerified: true };
      }
      if (token === "token_user") {
        return { id: USER_ID, role: "user", email: "user@test.com", fullName: "User", status: "active", emailVerified: true };
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
          useValue: { check: vi.fn().mockResolvedValue({ allowed: true, limit: 300, remaining: 299, resetAt: Date.now() + 60000 }) },
        },
        { provide: POLICY_REGISTRY, useValue: new PolicyRegistry() },
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
      const res = await request(app.getHttpServer()).get("/api/v1/admin/invitations");
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
        expect.objectContaining({ search_slug: "budi" }),
      );
    });

    it("passes search_user to service", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/invitations?search_user=siti")
        .set("Authorization", "Bearer token_admin");

      expect(res.status).toBe(200);
      expect(mockService.listInvitations).toHaveBeenCalledWith(
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
      expect(res.body.data.latestOrder.amountTotal).toBe("249000");
      expect(res.body.data.statusHistory).toHaveLength(1);
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
        .get("/api/v1/admin/invitations/99999999-9999-4999-8999-999999999999?reason=Support+ticket+404")
        .set("Authorization", "Bearer token_admin");

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("rejects unauthenticated detail request with 401", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/invitations/${INV_1_ID}`);
      expect(res.status).toBe(401);
    });

    it("rejects regular user detail request with 403", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/invitations/${INV_1_ID}`)
        .set("Authorization", "Bearer token_user");
      expect(res.status).toBe(403);
    });
  });
});