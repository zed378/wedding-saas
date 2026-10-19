import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import { AdminOrdersController } from "../src/modules/admin/admin-orders.controller";
import { AdminOrdersService } from "../src/modules/admin/admin-orders.service";
import { SessionService } from "../src/modules/auth/session.service";
import { MfaService } from "../src/modules/auth/mfa/mfa.service";
import {
  ConflictError,
  NotFoundError,
  UnauthenticatedError,
} from "../src/http/errors";

describe("Admin Order and Payment Management API (P5-07)", () => {
  let app: INestApplication;

  const ORDER_1_ID = "33333333-3333-4333-8333-333333333331";
  const ORDER_2_ID = "33333333-3333-4333-8333-333333333332";
  const USER_1_ID = "11111111-1111-4111-8111-111111111111";
  const INVITATION_1_ID = "22222222-2222-4222-8222-222222222221";

  const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const REGULAR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  const mockOrderSummaries = [
    {
      id: ORDER_1_ID,
      invitationId: INVITATION_1_ID,
      userId: USER_1_ID,
      packageId: "standard",
      addonIds: [],
      amountTotal: "139000",
      status: "paid",
      orderType: "new_publish",
      userEmail: "budi@example.com",
      userFullName: "Budi Santoso",
      invitationSlug: "budi-and-ratna",
      createdAt: "2026-01-10T10:00:00.000Z",
      expiredAt: "2026-01-11T10:00:00.000Z",
      paymentCount: 1,
    },
    {
      id: ORDER_2_ID,
      invitationId: INVITATION_1_ID,
      userId: USER_1_ID,
      packageId: "standard",
      addonIds: [],
      amountTotal: "139000",
      status: "pending",
      orderType: "new_publish",
      userEmail: "budi@example.com",
      userFullName: "Budi Santoso",
      invitationSlug: "budi-and-ratna",
      createdAt: "2026-01-12T10:00:00.000Z",
      expiredAt: "2026-01-13T10:00:00.000Z",
      paymentCount: 1,
    },
  ];

  const mockOrderDetail = {
    ...mockOrderSummaries[0]!,
    updatedAt: "2026-01-10T10:15:00.000Z",
    user: {
      id: USER_1_ID,
      email: "budi@example.com",
      fullName: "Budi Santoso",
      phone: "08123456789",
    },
    invitation: {
      id: INVITATION_1_ID,
      slug: "budi-and-ratna",
      internalName: "Undangan Pernikahan Utama",
    },
    payments: [
      {
        id: "pay-1",
        provider: "midtrans",
        providerReferenceId: "midtrans-charge-12345",
        method: "gopay",
        amount: "139000",
        status: "success",
        signatureValid: true,
        verifiedAt: "2026-01-10T10:15:00.000Z",
        createdAt: "2026-01-10T10:05:00.000Z",
      },
    ],
    notifications: [
      {
        id: "notif-1",
        source: "webhook",
        provider: "midtrans",
        claimedReference: "midtrans-charge-12345",
        signatureValid: true,
        rejectionReason: null,
        outcome: "success",
        providerStatus: "settlement",
        amount: "139000",
        result: "applied",
        needsReview: false,
        receivedAt: "2026-01-10T10:15:00.000Z",
        processedAt: "2026-01-10T10:15:01.000Z",
      },
      {
        id: "notif-fake-fraud",
        source: "webhook",
        provider: "midtrans",
        claimedReference: "midtrans-charge-12345",
        signatureValid: false,
        rejectionReason: "signature_mismatch",
        outcome: "failed",
        providerStatus: "settlement",
        amount: "139000",
        result: "ignored",
        needsReview: true,
        receivedAt: "2026-01-10T10:18:00.000Z",
        processedAt: "2026-01-10T10:18:01.000Z",
      },
    ],
    hasFraudAlert: true,
    invoice: {
      number: "INV-20260110-33333333",
      generatedAt: "2026-01-10T10:15:05.000Z",
    },
  };

  const mockAdminOrdersService = {
    listOrders: vi.fn(async (query: any) => {
      let filtered = [...mockOrderSummaries];
      if (query.status && query.status !== "all") {
        filtered = filtered.filter((o) => o.status === query.status);
      }
      if (query.search) {
        filtered = filtered.filter(
          (o) =>
            o.userEmail.includes(query.search) ||
            o.userFullName.includes(query.search) ||
            o.invitationSlug.includes(query.search),
        );
      }
      return {
        data: filtered,
        meta: { page: 1, per_page: 20, total: filtered.length },
      };
    }),

    getOrder: vi.fn(async (id: string) => {
      if (id === ORDER_1_ID) return mockOrderDetail;
      throw new NotFoundError(`Order "${id}" tidak ditemukan.`);
    }),

    refundOrder: vi.fn(async (_admin: any, id: string, reason: string) => {
      if (id === ORDER_2_ID) {
        throw new ConflictError(
          "ORDER_NOT_PAID",
          "Hanya pesanan berstatus 'paid' yang dapat direfund.",
        );
      }
      if (id === ORDER_1_ID) {
        return {
          orderId: ORDER_1_ID,
          status: "refunded",
          invitationId: INVITATION_1_ID,
          invitationSlug: "budi-and-ratna",
          invitationStatus: "draft",
          previousInvitationStatus: "published",
          moneyMovement: "manual",
          message:
            "Pesanan berhasil direfund di sistem dan status undangan dikembalikan ke draft. Pengembalian uang riil ke rekening/e-wallet pelanggan wajib diproses manual melalui dashboard gateway pembayaran (Midtrans).",
        };
      }
      throw new NotFoundError(`Order "${id}" tidak ditemukan.`);
    }),
  };

  const mockMfaService = {
    verifyStepUpToken: vi.fn(async (token: string, userId: string) => {
      return token === "valid-step-up-token";
    }),
    verifyCodeOrRecovery: vi.fn(async (userId: string, body: { code: string }) => {
      return { success: body.code === "123456" };
    }),
  };

  const mockSessionService = {
    authenticate: vi.fn(async (bearer: string | undefined) => {
      if (!bearer) throw new UnauthenticatedError();
      if (bearer.includes("admin-token")) {
        return {
          id: ADMIN_ID,
          email: "admin@example.com",
          fullName: "Admin Officer",
          role: "admin",
          emailVerified: true,
        };
      }
      if (bearer.includes("user-token")) {
        return {
          id: REGULAR_ID,
          email: "user@example.com",
          fullName: "Regular User",
          role: "user",
          emailVerified: true,
        };
      }
      throw new UnauthenticatedError();
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminOrdersController],
      providers: [
        { provide: AdminOrdersService, useValue: mockAdminOrdersService },
        { provide: MfaService, useValue: mockMfaService },
        { provide: SessionService, useValue: mockSessionService },
        { provide: APP_FILTER, useClass: AppExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe("Access Control & Role Gating (docs/SECURITY/04)", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await request(app.getHttpServer()).get(
        "/api/v1/admin/orders",
      );
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("rejects regular user requests with 403 Forbidden", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/orders")
        .set("Authorization", "Bearer user-token");
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("allows admin requests", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/orders")
        .set("Authorization", "Bearer admin-token");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta).toEqual({ page: 1, per_page: 20, total: 2 });
    });
  });

  describe("GET /api/v1/admin/orders (List and Filter)", () => {
    it("filters orders by status", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/orders?status=paid")
        .set("Authorization", "Bearer admin-token");

      expect(res.status).toBe(200);
      expect(mockAdminOrdersService.listOrders).toHaveBeenCalledWith(
        expect.objectContaining({ status: "paid" }),
      );
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe("paid");
    });

    it("searches orders by search term", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/orders?search=budi")
        .set("Authorization", "Bearer admin-token");

      expect(res.status).toBe(200);
      expect(mockAdminOrdersService.listOrders).toHaveBeenCalledWith(
        expect.objectContaining({ search: "budi" }),
      );
    });

    it("never exposes provider secrets or credentials in order list", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/orders")
        .set("Authorization", "Bearer admin-token");

      expect(res.status).toBe(200);
      for (const item of res.body.data) {
        expect(item.serverKey).toBeUndefined();
        expect(item.server_key).toBeUndefined();
        expect(item.clientKey).toBeUndefined();
        expect(item.webhookSecret).toBeUndefined();
        expect(item.rawCallbackPayload).toBeUndefined();
      }
    });
  });

  describe("GET /api/v1/admin/orders/:id (Detail)", () => {
    it("returns order detail with payments and timeline", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/orders/${ORDER_1_ID}`)
        .set("Authorization", "Bearer admin-token");

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(ORDER_1_ID);
      expect(res.body.data.user.email).toBe("budi@example.com");
      expect(res.body.data.invitation.slug).toBe("budi-and-ratna");
      expect(res.body.data.payments).toHaveLength(1);
      expect(res.body.data.notifications).toHaveLength(2);
      expect(res.body.data.invoice?.number).toBe("INV-20260110-33333333");

      // Verify that rawCallbackPayload is redacted in default detail view (DoD 1)
      for (const p of res.body.data.payments) {
        expect(p.rawCallbackPayload).toBeUndefined();
        expect(p.raw_callback_payload).toBeUndefined();
      }
    });

    it("surfaces fraud alert flag when fake notification has signature mismatch (DoD 4)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/orders/${ORDER_1_ID}`)
        .set("Authorization", "Bearer admin-token");

      expect(res.status).toBe(200);
      expect(res.body.data.hasFraudAlert).toBe(true);

      const fakeNotif = res.body.data.notifications.find(
        (n: any) => n.id === "notif-fake-fraud",
      );
      expect(fakeNotif.signatureValid).toBe(false);
      expect(fakeNotif.rejectionReason).toBe("signature_mismatch");
    });

    it("returns 404 for unknown order", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/orders/99999999-9999-4999-8999-999999999999")
        .set("Authorization", "Bearer admin-token");

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("POST /api/v1/admin/orders/:id/refund (Manual Refund with 2FA Step-Up, P5-08)", () => {
    it("refuses refund without authentication with 401", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/orders/${ORDER_1_ID}/refund`)
        .send({ reason: "Permintaan pembatalan pelanggan" });

      expect(res.status).toBe(401);
    });

    it("refuses refund by non-admin with 403 Forbidden", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/orders/${ORDER_1_ID}/refund`)
        .set("Authorization", "Bearer user-token")
        .send({ reason: "Permintaan pembatalan pelanggan" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("refuses refund without 2FA step-up authentication (403 MFA_STEP_UP_REQUIRED)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/orders/${ORDER_1_ID}/refund`)
        .set("Authorization", "Bearer admin-token")
        .send({ reason: "Permintaan pembatalan pelanggan" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("MFA_STEP_UP_REQUIRED");
    });

    it("refuses refund when 2FA TOTP code is incorrect", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/orders/${ORDER_1_ID}/refund`)
        .set("Authorization", "Bearer admin-token")
        .send({
          reason: "Permintaan pembatalan pelanggan",
          step_up_code: "999999", // wrong code
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("MFA_STEP_UP_REQUIRED");
    });

    it("refuses refund when reason is shorter than 5 characters (400 VALIDATION_ERROR)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/orders/${ORDER_1_ID}/refund`)
        .set("Authorization", "Bearer admin-token")
        .set("X-MFA-Step-Up", "valid-step-up-token")
        .send({ reason: "no" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("refuses refund when order is not in paid status (409 ORDER_NOT_PAID)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/orders/${ORDER_2_ID}/refund`)
        .set("Authorization", "Bearer admin-token")
        .set("X-MFA-Step-Up", "valid-step-up-token")
        .send({ reason: "Pelanggan salah memilih paket dan minta refund" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ORDER_NOT_PAID");
    });

    it("processes refund with valid step-up token, resetting invitation to draft and returning manual money movement notice (ADR-019)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/orders/${ORDER_1_ID}/refund`)
        .set("Authorization", "Bearer admin-token")
        .set("X-MFA-Step-Up", "valid-step-up-token")
        .send({ reason: "Permintaan pembatalan resmi pelanggan" });

      expect(res.status).toBe(200);
      expect(res.body.data.orderId).toBe(ORDER_1_ID);
      expect(res.body.data.status).toBe("refunded");
      expect(res.body.data.invitationStatus).toBe("draft");
      expect(res.body.data.moneyMovement).toBe("manual");
      expect(res.body.data.message).toContain("Midtrans");
    });

    it("processes refund with valid 2FA TOTP code passed in body", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/orders/${ORDER_1_ID}/refund`)
        .set("Authorization", "Bearer admin-token")
        .send({
          reason: "Permintaan pembatalan resmi pelanggan",
          step_up_code: "123456",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("refunded");
      expect(res.body.data.invitationStatus).toBe("draft");
      expect(res.body.data.moneyMovement).toBe("manual");
    });
  });
});
