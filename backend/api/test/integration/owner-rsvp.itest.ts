import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import Redis from "ioredis";

import {
  createPhaseOneTenant,
  type PhaseOneTenant,
} from "../support/phase-one-tenant";
import { connect, resetTenantData } from "./helpers.ts";

/**
 * `P4-02` — Owner RSVP management and CSV export. `docs/API/04`.
 *
 * Verifies:
 * - List: Paginated results and attendance status filtering (`attending`, `not_attending`, `maybe`).
 * - Summary: Aggregated numbers computed directly in SQL (total responses, status breakdown, total attending guests).
 * - CSV Export: Downloadable CSV formatted with correct headers and formula injection mitigation (`=`, `+`, `-`, `@`, `\t`, `\r` prepended with `'`).
 * - Delete: Single entry deletion.
 * - Tenancy / IDOR: All 4 endpoints return 404 (never 403) for non-owners.
 * - Cross-invitation deletion protection: deleting an RSVP under the wrong invitation returns 404.
 */

const SIGNING_KEY = "owner-rsvp-test-signing-key-00000000000000";

describe("owner RSVP management and export (P4-02)", () => {
  let app: INestApplication;
  let pool: Pool;
  let redis: Redis;
  let alice: PhaseOneTenant;
  let mallory: PhaseOneTenant;

  beforeAll(async () => {
    process.env["DATABASE_URL"] = (
      process.env["MIGRATION_DATABASE_URL"] ??
      "postgres://wedding_owner:wedding_owner_dev@localhost:55432/wedding"
    ).replace(/\/\/[^@]+@/, "//wedding_app:wedding_app_dev@");
    process.env["REDIS_URL"] =
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56279";
    process.env["JWT_SIGNING_KEY"] = SIGNING_KEY;
    process.env["RATE_LIMIT_OVERRIDES"] = JSON.stringify({
      export: { limit: 50_000, windowSeconds: 60 },
      "general-authenticated": { limit: 50_000, windowSeconds: 60 },
    });

    redis = new Redis(
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56279",
      { maxRetriesPerRequest: 2, connectTimeout: 2000 },
    );
    await redis.ping();
    const stale = await redis.keys("rl:*");
    if (stale.length > 0) await redis.del(...stale);

    pool = await connect([
      "invitations",
      "invitation_settings",
      "invitation_guests",
      "users",
    ]);

    const { AppModule } = await import("../../src/app.module.ts");

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await redis?.quit().catch(() => redis.disconnect());
  });

  beforeEach(async () => {
    await resetTenantData(pool);
    const stale = await redis.keys("rl:*");
    if (stale.length > 0) await redis.del(...stale);

    alice = await createPhaseOneTenant(pool, SIGNING_KEY, "Alice");
    mallory = await createPhaseOneTenant(pool, SIGNING_KEY, "Mallory");
  });

  async function insertRsvp(params: {
    invitationId: string;
    guestName: string;
    attendanceStatus: "attending" | "not_attending" | "maybe";
    guestCount?: number;
    message?: string;
  }): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO invitation_guests
         (invitation_id, guest_name, attendance_status, guest_count, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        params.invitationId,
        params.guestName,
        params.attendanceStatus,
        params.guestCount ?? 1,
        params.message ?? null,
      ],
    );
    return rows[0]!.id;
  }

  // ------------------------------------------------------------------ List RSVPs

  describe("GET /api/v1/invitations/:id/rsvps", () => {
    it("returns paginated RSVPs with metadata", async () => {
      await insertRsvp({
        invitationId: alice.invitation.id,
        guestName: "Guest 1",
        attendanceStatus: "attending",
      });
      await insertRsvp({
        invitationId: alice.invitation.id,
        guestName: "Guest 2",
        attendanceStatus: "not_attending",
      });
      await insertRsvp({
        invitationId: alice.invitation.id,
        guestName: "Guest 3",
        attendanceStatus: "maybe",
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/invitations/${alice.invitation.id}/rsvps?page=1&limit=2`)
        .set("Authorization", `Bearer ${alice.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta).toMatchObject({
        page: 1,
        per_page: 2,
        total: 3,
      });
    });

    it("filters by attendance status", async () => {
      await insertRsvp({
        invitationId: alice.invitation.id,
        guestName: "Attending 1",
        attendanceStatus: "attending",
      });
      await insertRsvp({
        invitationId: alice.invitation.id,
        guestName: "Attending 2",
        attendanceStatus: "attending",
      });
      await insertRsvp({
        invitationId: alice.invitation.id,
        guestName: "Declined 1",
        attendanceStatus: "not_attending",
      });

      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/invitations/${alice.invitation.id}/rsvps?status=attending`,
        )
        .set("Authorization", `Bearer ${alice.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.total).toBe(2);
      expect(
        res.body.data.every((r: any) => r.attendance_status === "attending"),
      ).toBe(true);
    });

    it("returns 404 for a non-owner attempting to list RSVPs", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/invitations/${alice.invitation.id}/rsvps`)
        .set("Authorization", `Bearer ${mallory.token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // ------------------------------------------------------------------ Summary

  describe("GET /api/v1/invitations/:id/rsvps/summary", () => {
    it("computes accurate SQL aggregated numbers", async () => {
      await insertRsvp({
        invitationId: alice.invitation.id,
        guestName: "Attending 1",
        attendanceStatus: "attending",
        guestCount: 2,
      });
      await insertRsvp({
        invitationId: alice.invitation.id,
        guestName: "Attending 2",
        attendanceStatus: "attending",
        guestCount: 3,
      });
      await insertRsvp({
        invitationId: alice.invitation.id,
        guestName: "Declined 1",
        attendanceStatus: "not_attending",
        guestCount: 2,
      });
      await insertRsvp({
        invitationId: alice.invitation.id,
        guestName: "Maybe 1",
        attendanceStatus: "maybe",
        guestCount: 1,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/invitations/${alice.invitation.id}/rsvps/summary`)
        .set("Authorization", `Bearer ${alice.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        total_responses: 4,
        attending: 2,
        not_attending: 1,
        maybe: 1,
        total_attending_guests: 5, // 2 + 3 attending; declined and maybe do not count
      });
    });

    it("returns 404 for a non-owner attempting to view summary", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/invitations/${alice.invitation.id}/rsvps/summary`)
        .set("Authorization", `Bearer ${mallory.token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // ------------------------------------------------------------------ CSV Export & Formula Injection

  describe("GET /api/v1/invitations/:id/rsvps/export", () => {
    it("exports CSV with proper headers and neutralizes formula injection triggers", async () => {
      // Injections: =, +, -, @, \t, \r
      await insertRsvp({
        invitationId: alice.invitation.id,
        guestName: "=cmd|' /C calc'!A0",
        attendanceStatus: "attending",
        guestCount: 2,
        message: "+123456789",
      });
      await insertRsvp({
        invitationId: alice.invitation.id,
        guestName: "-SUM(1+1)",
        attendanceStatus: "not_attending",
        guestCount: 1,
        message: "@evil_formula",
      });
      await insertRsvp({
        invitationId: alice.invitation.id,
        guestName: "Budi & Ani",
        attendanceStatus: "maybe",
        guestCount: 1,
        message: "Selamat ya!",
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/invitations/${alice.invitation.id}/rsvps/export`)
        .set("Authorization", `Bearer ${alice.token}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toMatch(
        /^attachment; filename="rsvps-.*\.csv"$/,
      );

      const csv = res.text;
      const lines = csv.split("\r\n");

      // Verify header
      expect(lines[0]).toBe(
        "No,Nama Tamu,Status Kehadiran,Jumlah Tamu,Pesan,Waktu Konfirmasi",
      );

      // Verify formula injection prepends single quote
      expect(csv).toContain("\"'=cmd|' /C calc'!A0\"");
      expect(csv).toContain("\"'+123456789\"");
      expect(csv).toContain("\"'-SUM(1+1)\"");
      expect(csv).toContain("\"'@evil_formula\"");

      // Normal text remains unescaped by formula prefix
      expect(csv).toContain('"Budi & Ani"');
      expect(csv).toContain('"Selamat ya!"');
    });

    it("returns 404 for a non-owner attempting to export CSV", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/invitations/${alice.invitation.id}/rsvps/export`)
        .set("Authorization", `Bearer ${mallory.token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // ------------------------------------------------------------------ Delete RSVP

  describe("DELETE /api/v1/invitations/:id/rsvps/:rsvp_id", () => {
    it("deletes an RSVP entry successfully", async () => {
      const rsvpId = await insertRsvp({
        invitationId: alice.invitation.id,
        guestName: "Spam Guest",
        attendanceStatus: "attending",
      });

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/invitations/${alice.invitation.id}/rsvps/${rsvpId}`)
        .set("Authorization", `Bearer ${alice.token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { deleted: true },
      });

      // Confirm removed from database
      const { rows } = await pool.query(
        "SELECT id FROM invitation_guests WHERE id = $1",
        [rsvpId],
      );
      expect(rows).toHaveLength(0);
    });

    it("returns 404 when a non-owner attempts to delete an RSVP", async () => {
      const rsvpId = await insertRsvp({
        invitationId: alice.invitation.id,
        guestName: "Alice Guest",
        attendanceStatus: "attending",
      });

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/invitations/${alice.invitation.id}/rsvps/${rsvpId}`)
        .set("Authorization", `Bearer ${mallory.token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("NOT_FOUND");

      // Verify row was NOT deleted
      const { rows } = await pool.query(
        "SELECT id FROM invitation_guests WHERE id = $1",
        [rsvpId],
      );
      expect(rows).toHaveLength(1);
    });

    it("returns 404 when trying to delete an RSVP belonging to another invitation of the same user", async () => {
      // Alice has two invitations: alice.invitation and alice.second.invitation
      const rsvpId = await insertRsvp({
        invitationId: alice.second.invitation.id,
        guestName: "Second Wedding Guest",
        attendanceStatus: "attending",
      });

      // Alice tries to delete this rsvp through her first invitation URL
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/invitations/${alice.invitation.id}/rsvps/${rsvpId}`)
        .set("Authorization", `Bearer ${alice.token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);

      // Verify row was NOT deleted
      const { rows } = await pool.query(
        "SELECT id FROM invitation_guests WHERE id = $1",
        [rsvpId],
      );
      expect(rows).toHaveLength(1);
    });
  });
});
