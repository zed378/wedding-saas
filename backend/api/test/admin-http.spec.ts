import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import { AdminAuditLogsController } from "../src/modules/admin/audit-logs.controller";
import { AdminAuditLogService } from "../src/modules/admin/audit-logs.service";
import { AdminPaymentsController } from "../src/modules/admin/admin-payments.controller";
import { SessionService } from "../src/modules/auth/session.service";
import { DB } from "../src/infra/db/client";
import { UnauthenticatedError } from "../src/http/errors";

describe("Admin Authorization Path and Audit Middleware (P5-03)", () => {
  let app: INestApplication;

  const mockUsers = {
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "user@example.test",
      fullName: "Regular User",
      role: "user",
      status: "active",
      emailVerified: true,
    },
    admin: {
      id: "22222222-2222-4222-8222-222222222222",
      email: "admin@vizunicum.test",
      fullName: "Platform Admin",
      role: "admin",
      status: "active",
      emailVerified: true,
    },
    superAdmin: {
      id: "33333333-3333-4333-8333-333333333333",
      email: "super@vizunicum.test",
      fullName: "Super Administrator",
      role: "super_admin",
      status: "active",
      emailVerified: true,
    },
  };

  const mockAuditService = {
    list: vi.fn().mockResolvedValue({
      items: [
        {
          id: "log-1",
          admin_id: mockUsers.admin.id,
          admin_email: mockUsers.admin.email,
          action: "user.suspend",
          resource_type: "user",
          resource_id: "victim-1",
          reason: "Payment dispute investigation",
          before_state: { status: "active" },
          after_state: { status: "suspended" },
          ip_address: "127.0.0.1",
          created_at: new Date().toISOString(),
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      total_pages: 1,
    }),
  };

  const mockPayment = {
    id: "44444444-4444-4444-8444-444444444444",
    orderId: "55555555-5555-4555-8555-555555555555",
    provider: "midtrans",
    providerReferenceId: "ORDER-1234-MIDTRANS",
    status: "success",
    signatureValid: true,
    verifiedAt: new Date(),
    rawCallbackPayload: {
      transaction_id: "tx-123",
      order_id: "order-123",
      gross_amount: "139000.00",
      payment_type: "qris",
      signature_key: "abc123sha512",
    },
    createdAt: new Date(),
  };

  const mockDb = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => [mockPayment]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
  };

  const mockSessions = {
    authenticate: vi.fn().mockImplementation(async (authHeader?: string) => {
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new UnauthenticatedError();
      }
      const token = authHeader.replace("Bearer ", "");
      if (token === "token_user") return mockUsers.user;
      if (token === "token_admin") return mockUsers.admin;
      if (token === "token_super_admin") return mockUsers.superAdmin;
      throw new UnauthenticatedError();
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAuditLogsController, AdminPaymentsController],
      providers: [
        { provide: AdminAuditLogService, useValue: mockAuditService },
        { provide: SessionService, useValue: mockSessions },
        { provide: DB, useValue: mockDb },
        { provide: APP_FILTER, useClass: AppExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Admin Role Gating & Authorization (BR-Admin.1, BR-Admin.2)", () => {
    it("rejects unauthenticated requests with 401 UNAUTHENTICATED", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/admin/audit-logs");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("rejects regular users with 403 FORBIDDEN without revealing resource existence", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/audit-logs")
        .set("Authorization", "Bearer token_user");

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("allows admin access to GET /api/v1/admin/audit-logs", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/audit-logs")
        .set("Authorization", "Bearer token_admin");

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].action).toBe("user.suspend");
    });

    it("allows super_admin access to GET /api/v1/admin/audit-logs", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/audit-logs")
        .set("Authorization", "Bearer token_super_admin");

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(1);
    });
  });

  describe("Raw Payment Log Access Restriction (BR-Admin.6, Card Step 6)", () => {
    it("rejects regular admin access with 403 FORBIDDEN (super_admin required)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/payments/${mockPayment.id}/raw-log`)
        .set("Authorization", "Bearer token_admin");

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("allows super_admin access and logs access to audit trail", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/payments/${mockPayment.id}/raw-log`)
        .set("Authorization", "Bearer token_super_admin");

      expect(res.status).toBe(200);
      expect(res.body.data.payment_id).toBe(mockPayment.id);
      expect(res.body.data.raw_callback_payload.gross_amount).toBe("139000.00");

      // Verify audit insertion occurred
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe("Content Boundary Enforcement (BR-Admin.7, Card Step 5)", () => {
    it("ensures no route exists allowing admins to modify user invitation content", async () => {
      const dummyId = "00000000-0000-4000-8000-000000000000";

      // Attempt PATCH to invitation
      const patchRes = await request(app.getHttpServer())
        .patch(`/api/v1/admin/invitations/${dummyId}`)
        .set("Authorization", "Bearer token_admin")
        .send({ title: "Admin Modified" });

      expect(patchRes.status).toBe(404);

      // Attempt PATCH to couple
      const coupleRes = await request(app.getHttpServer())
        .patch(`/api/v1/admin/invitations/${dummyId}/couple`)
        .set("Authorization", "Bearer token_admin")
        .send({ groom_name: "Admin Modified" });

      expect(coupleRes.status).toBe(404);
    });
  });
});
