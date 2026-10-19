import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import { AdminModerationController } from "../src/modules/admin/admin-moderation.controller";
import { AdminModerationService } from "../src/modules/admin/admin-moderation.service";
import { PublicGuestbookController } from "../src/modules/guestbook/public-guestbook.controller";
import { GuestbookService } from "../src/modules/guestbook/guestbook.service";
import { SessionService } from "../src/modules/auth/session.service";
import {
  RATE_LIMITER,
  POLICY_REGISTRY,
} from "../src/shared/rate-limit/rate-limit.guard";
import { PolicyRegistry } from "../src/shared/rate-limit/config";
import { NotFoundError, UnauthenticatedError } from "../src/http/errors";

describe("Admin Moderation Queue API (P5-09)", () => {
  let app: INestApplication;

  const INVITATION_1_ID = "11111111-1111-4111-8111-111111111111";
  const ENTRY_1_ID = "22222222-2222-4222-8222-222222222221";
  const ENTRY_2_ID = "22222222-2222-4222-8222-222222222222";
  const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  const mockQueueItems = [
    {
      id: ENTRY_1_ID,
      invitationId: INVITATION_1_ID,
      invitationSlug: "budi-and-ratna",
      invitationTitle: "Undangan Budi & Ratna",
      invitationStatus: "published",
      owner: {
        id: "owner-1",
        email: "budi@example.com",
        fullName: "Budi Santoso",
      },
      guestName: "Spammer",
      message: "Cek link promo penipuan http://spam.xyz",
      status: "pending" as const,
      submittedIpHash: "hash-ip-1",
      moderatedBy: null,
      moderatedAt: null,
      createdAt: "2026-10-18T10:00:00.000Z",
      reportCount: 2,
      reports: [
        {
          id: "rep-1",
          reason: "Spam link promosi berbahaya",
          createdAt: "2026-10-18T10:05:00.000Z",
        },
        {
          id: "rep-2",
          reason: "Penipuan",
          createdAt: "2026-10-18T10:10:00.000Z",
        },
      ],
      flagSource: "reported" as const,
      flagLabel: "Dilaporkan Tamu (2x)",
    },
    {
      id: ENTRY_2_ID,
      invitationId: INVITATION_1_ID,
      invitationSlug: "budi-and-ratna",
      invitationTitle: "Undangan Budi & Ratna",
      invitationStatus: "published",
      owner: {
        id: "owner-1",
        email: "budi@example.com",
        fullName: "Budi Santoso",
      },
      guestName: "Anonymous",
      message: "Kata kasar terdeteksi dalam pesan",
      status: "pending" as const,
      submittedIpHash: "hash-ip-2",
      moderatedBy: null,
      moderatedAt: null,
      createdAt: "2026-10-18T11:00:00.000Z",
      reportCount: 0,
      reports: [],
      flagSource: "auto_flagged" as const,
      flagLabel: "Filter Otomatis (Spam / Profanity)",
    },
  ];

  const mockAdminModerationService = {
    listGuestbook: vi.fn(async (query: any) => {
      let filtered = [...mockQueueItems];
      if (query.status && query.status !== "all") {
        filtered = filtered.filter((i) => i.status === query.status);
      }
      if (query.flag_source === "reported") {
        filtered = filtered.filter((i) => i.reportCount > 0);
      } else if (query.flag_source === "auto_flagged") {
        filtered = filtered.filter((i) => i.flagSource === "auto_flagged");
      }
      if (query.invitation_id) {
        filtered = filtered.filter((i) => i.invitationId === query.invitation_id);
      }
      if (query.search) {
        filtered = filtered.filter(
          (i) =>
            i.guestName.toLowerCase().includes(query.search.toLowerCase()) ||
            i.message.toLowerCase().includes(query.search.toLowerCase()),
        );
      }
      return {
        data: filtered,
        meta: { page: 1, per_page: 20, total: filtered.length },
      };
    }),

    moderateGuestbook: vi.fn(async (_admin: any, id: string, dto: any) => {
      if (id === ENTRY_1_ID || id === ENTRY_2_ID) {
        return {
          id,
          status: dto.status,
          moderatedAt: new Date().toISOString(),
          message: `Pesan buku tamu berhasil di-${dto.status === "approved" ? "setujui" : "tolak"}.`,
        };
      }
      throw new NotFoundError(`Pesan buku tamu "${id}" tidak ditemukan.`);
    }),

    deleteGuestbook: vi.fn(async (_admin: any, id: string, _dto: any) => {
      if (id === ENTRY_1_ID || id === ENTRY_2_ID) {
        return {
          id,
          deleted: true,
          message: "Pesan buku tamu berhasil dihapus permanen dari platform.",
        };
      }
      throw new NotFoundError(`Pesan buku tamu "${id}" tidak ditemukan.`);
    }),
  };

  const mockGuestbookService = {
    reportEntry: vi.fn(async (slug: string, entryId: string, _reason: string | undefined) => {
      if (slug !== "budi-and-ratna") {
        throw new NotFoundError(`Undangan "${slug}" tidak ditemukan.`);
      }
      if (entryId !== ENTRY_1_ID) {
        throw new NotFoundError("Pesan buku tamu tidak ditemukan.");
      }
      return {
        message: "Laporan berhasil diterima dan akan ditinjau oleh tim moderasi.",
      };
    }),
    submitEntry: vi.fn(),
    listApprovedEntries: vi.fn(),
    isCaptchaRequired: vi.fn(async () => false),
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
          id: USER_ID,
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
      controllers: [AdminModerationController, PublicGuestbookController],
      providers: [
        { provide: AdminModerationService, useValue: mockAdminModerationService },
        { provide: GuestbookService, useValue: mockGuestbookService },
        { provide: SessionService, useValue: mockSessionService },
        { provide: APP_FILTER, useClass: AppExceptionFilter },
        {
          provide: RATE_LIMITER,
          useValue: {
            check: async () => ({ allowed: true, remaining: 99, resetAt: 0 }),
            recordFailure: async () => undefined,
          },
        },
        {
          provide: POLICY_REGISTRY,
          useValue: new PolicyRegistry(undefined as never, undefined),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe("Public Guestbook Report Endpoint (POST /public/i/:slug/guestbook/:entry_id/report)", () => {
    it("submits report anonymously without requiring authentication (DoD 4)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/i/budi-and-ratna/guestbook/${ENTRY_1_ID}/report`)
        .send({ reason: "Iklan penipuan dan link mencurigakan" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain("Laporan berhasil diterima");
      expect(mockGuestbookService.reportEntry).toHaveBeenCalledWith(
        "budi-and-ratna",
        ENTRY_1_ID,
        "Iklan penipuan dan link mencurigakan",
        expect.any(String),
      );
    });

    it("returns 404 when reporting entry on unknown invitation", async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/i/unknown-wedding/guestbook/${ENTRY_1_ID}/report`)
        .send({ reason: "Spam" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 when entry ID does not exist", async () => {
      const res = await request(app.getHttpServer())
        .post("/public/i/budi-and-ratna/guestbook/99999999-9999-4999-8999-999999999999/report")
        .send({ reason: "Spam" });

      expect(res.status).toBe(404);
    });
  });

  describe("Access Control & Role Gating on Moderation Queue", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await request(app.getHttpServer()).get(
        "/api/v1/admin/moderation/guestbook",
      );
      expect(res.status).toBe(401);
    });

    it("rejects regular users with 403 Forbidden", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/moderation/guestbook")
        .set("Authorization", "Bearer user-token");
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("allows admin access to moderation queue", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/moderation/guestbook")
        .set("Authorization", "Bearer admin-token");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);
    });
  });

  describe("Queue Listing and Filtering (GET /api/v1/admin/moderation/guestbook)", () => {
    it("feeds reported and auto-flagged entries into one unified queue (DoD 1)", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/moderation/guestbook")
        .set("Authorization", "Bearer admin-token");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);

      const reportedEntry = res.body.data.find((e: any) => e.flagSource === "reported");
      const autoFlaggedEntry = res.body.data.find((e: any) => e.flagSource === "auto_flagged");

      expect(reportedEntry).toBeDefined();
      expect(reportedEntry.reportCount).toBe(2);
      expect(reportedEntry.reports).toHaveLength(2);

      expect(autoFlaggedEntry).toBeDefined();
      expect(autoFlaggedEntry.flagLabel).toContain("Filter Otomatis");
    });

    it("filters queue by flag source (reported only)", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/moderation/guestbook?flag_source=reported")
        .set("Authorization", "Bearer admin-token");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].flagSource).toBe("reported");
    });

    it("filters queue by flag source (auto_flagged only)", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/moderation/guestbook?flag_source=auto_flagged")
        .set("Authorization", "Bearer admin-token");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].flagSource).toBe("auto_flagged");
    });

    it("filters queue per invitation ID", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/moderation/guestbook?invitation_id=${INVITATION_1_ID}`)
        .set("Authorization", "Bearer admin-token");

      expect(res.status).toBe(200);
      expect(mockAdminModerationService.listGuestbook).toHaveBeenCalledWith(
        expect.objectContaining({ invitation_id: INVITATION_1_ID }),
      );
    });

    it("searches queue by query text", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/moderation/guestbook?search=promosi")
        .set("Authorization", "Bearer admin-token");

      expect(res.status).toBe(200);
      expect(mockAdminModerationService.listGuestbook).toHaveBeenCalledWith(
        expect.objectContaining({ search: "promosi" }),
      );
    });
  });

  describe("Admin Moderation Decisions (PATCH & DELETE)", () => {
    it("approves a pending guestbook entry (DoD 2)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/moderation/guestbook/${ENTRY_1_ID}`)
        .set("Authorization", "Bearer admin-token")
        .send({ status: "approved", reason: "Tinjauan manual menyatakan pesan aman" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("approved");
      expect(mockAdminModerationService.moderateGuestbook).toHaveBeenCalledWith(
        expect.objectContaining({ id: ADMIN_ID }),
        ENTRY_1_ID,
        expect.objectContaining({ status: "approved" }),
      );
    });

    it("rejects a guestbook entry (DoD 2, 3)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/moderation/guestbook/${ENTRY_1_ID}`)
        .set("Authorization", "Bearer admin-token")
        .send({ status: "rejected", reason: "Konten terbukti spam komersial" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("rejected");
    });

    it("refuses moderation when status is invalid", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/moderation/guestbook/${ENTRY_1_ID}`)
        .set("Authorization", "Bearer admin-token")
        .send({ status: "invalid_status" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("deletes a guestbook entry permanently (DoD 2, 3)", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/admin/moderation/guestbook/${ENTRY_1_ID}`)
        .set("Authorization", "Bearer admin-token")
        .send({ reason: "Pelanggaran berat ketentuan layanan" });

      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
      expect(mockAdminModerationService.deleteGuestbook).toHaveBeenCalledWith(
        expect.objectContaining({ id: ADMIN_ID }),
        ENTRY_1_ID,
        expect.objectContaining({ reason: "Pelanggaran berat ketentuan layanan" }),
      );
    });

    it("returns 404 when moderating unknown entry", async () => {
      const res = await request(app.getHttpServer())
        .patch("/api/v1/admin/moderation/guestbook/99999999-9999-4999-8999-999999999999")
        .set("Authorization", "Bearer admin-token")
        .send({ status: "rejected" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });
});
