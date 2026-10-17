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
import { PublicInvitationCache } from "../../src/modules/publishing/public-invitation-cache";

/**
 * `P4-04` — Owner Guestbook Moderation. `docs/API/04`, `docs/PLAN/04` § F11.
 *
 * Verifies:
 * - List: Paginated results and status filtering (`pending`, `approved`, `rejected`).
 * - Moderate: Transitioning between statuses (`pending` -> `approved`, `pending` -> `rejected`),
 *   recording moderator identity and timestamp.
 * - Delete: Removing guestbook entries.
 * - Tenancy / IDOR: All endpoints return 404 (never 403) for non-owners.
 * - Cross-invitation protection: moderating or deleting an entry under another invitation of the same user returns 404.
 * - Cache invalidation: public cache is invalidated when an entry becomes approved or is deleted while approved.
 * - Validation & mass assignment rejection.
 */

const SIGNING_KEY = "owner-guestbook-test-signing-key-0000000000";

describe("owner guestbook moderation (P4-04)", () => {
  let app: INestApplication;
  let pool: Pool;
  let redis: Redis;
  let alice: PhaseOneTenant;
  let mallory: PhaseOneTenant;
  let aliceSlug: string;

  beforeAll(async () => {
    process.env["DATABASE_URL"] = (
      process.env["MIGRATION_DATABASE_URL"] ??
      "postgres://wedding_owner:wedding_owner_dev@localhost:55432/wedding"
    ).replace(/\/\/[^@]+@/, "//wedding_app:wedding_app_dev@");
    process.env["REDIS_URL"] =
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56279";
    process.env["JWT_SIGNING_KEY"] = SIGNING_KEY;
    process.env["RATE_LIMIT_OVERRIDES"] = JSON.stringify({
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
      "invitation_guestbook",
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

    const { rows } = await pool.query<{ slug: string }>(
      "SELECT slug FROM invitations WHERE id = $1",
      [alice.invitation.id],
    );
    aliceSlug = rows[0]!.slug;
  });

  async function insertGuestbookEntry(params: {
    invitationId: string;
    guestName: string;
    message: string;
    status?: "pending" | "approved" | "rejected";
    submittedIpHash?: string;
  }): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO invitation_guestbook
         (invitation_id, guest_name, message, status, submitted_ip_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        params.invitationId,
        params.guestName,
        params.message,
        params.status ?? "pending",
        params.submittedIpHash ?? "hash-123",
      ],
    );
    return rows[0]!.id;
  }

  // ------------------------------------------------------------------ Listing & Filtering

  it("lists all guestbook entries with pagination and allows filtering by status", async () => {
    // Alice has 1 fixture entry from createPhaseOneTenant (pending)
    // Add 2 more: 1 approved, 1 rejected
    await insertGuestbookEntry({
      invitationId: alice.invitation.id,
      guestName: "Guest Two",
      message: "Approved message",
      status: "approved",
    });
    await insertGuestbookEntry({
      invitationId: alice.invitation.id,
      guestName: "Guest Three",
      message: "Rejected message",
      status: "rejected",
    });

    // 1. List all without filter
    const resAll = await request(app.getHttpServer())
      .get(`/api/v1/invitations/${alice.invitation.id}/guestbook`)
      .set("Authorization", `Bearer ${alice.token}`);

    expect(resAll.status).toBe(200);
    expect(resAll.body.success).toBe(true);
    expect(resAll.body.data.length).toBe(3);
    expect(resAll.body.meta.total).toBe(3);

    // 2. Filter by status = 'approved'
    const resApproved = await request(app.getHttpServer())
      .get(`/api/v1/invitations/${alice.invitation.id}/guestbook?status=approved`)
      .set("Authorization", `Bearer ${alice.token}`);

    expect(resApproved.status).toBe(200);
    expect(resApproved.body.data.length).toBe(1);
    expect(resApproved.body.data[0].guest_name).toBe("Guest Two");
    expect(resApproved.body.data[0].status).toBe("approved");

    // 3. Filter by status = 'pending'
    const resPending = await request(app.getHttpServer())
      .get(`/api/v1/invitations/${alice.invitation.id}/guestbook?status=pending`)
      .set("Authorization", `Bearer ${alice.token}`);

    expect(resPending.status).toBe(200);
    expect(resPending.body.data.length).toBe(1);
    expect(resPending.body.data[0].status).toBe("pending");

    // 4. Filter by status = 'rejected'
    const resRejected = await request(app.getHttpServer())
      .get(`/api/v1/invitations/${alice.invitation.id}/guestbook?status=rejected`)
      .set("Authorization", `Bearer ${alice.token}`);

    expect(resRejected.status).toBe(200);
    expect(resRejected.body.data.length).toBe(1);
    expect(resRejected.body.data[0].status).toBe("rejected");
  });

  // ------------------------------------------------------------------ Moderation (Approve / Reject)

  it("approves a pending guestbook entry, recording moderator identity and timestamp", async () => {
    const entryId = await insertGuestbookEntry({
      invitationId: alice.invitation.id,
      guestName: "Pending Guest",
      message: "Please approve me",
      status: "pending",
    });

    // Pre-populate public cache for alice's slug
    const publicCache = app.get(PublicInvitationCache);
    await publicCache.set(
      aliceSlug,
      alice.invitation.id,
      "test-v1",
      { status: "published" } as any,
    );
    expect(await publicCache.get(aliceSlug)).toBeDefined();

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/invitations/${alice.invitation.id}/guestbook/${entryId}`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("approved");
    expect(res.body.data.moderated_by).toBe(alice.user.id);
    expect(res.body.data.moderated_at).not.toBeNull();

    // Verify persisted in DB
    const { rows } = await pool.query<{ status: string; moderated_by: string; moderated_at: Date }>(
      "SELECT status, moderated_by, moderated_at FROM invitation_guestbook WHERE id = $1",
      [entryId],
    );
    expect(rows[0]!.status).toBe("approved");
    expect(rows[0]!.moderated_by).toBe(alice.user.id);
    expect(rows[0]!.moderated_at).not.toBeNull();

    // Verify public cache was invalidated
    expect(await publicCache.get(aliceSlug)).toBeUndefined();
  });

  it("rejects an entry, updating status and moderator metadata", async () => {
    const entryId = await insertGuestbookEntry({
      invitationId: alice.invitation.id,
      guestName: "Spammer",
      message: "Inappropriate advertisement",
      status: "pending",
    });

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/invitations/${alice.invitation.id}/guestbook/${entryId}`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ status: "rejected" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("rejected");
    expect(res.body.data.moderated_by).toBe(alice.user.id);
    expect(res.body.data.moderated_at).not.toBeNull();

    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM invitation_guestbook WHERE id = $1",
      [entryId],
    );
    expect(rows[0]!.status).toBe("rejected");
  });

  // ------------------------------------------------------------------ Deletion

  it("deletes a guestbook entry as the owner", async () => {
    const entryId = await insertGuestbookEntry({
      invitationId: alice.invitation.id,
      guestName: "To Delete",
      message: "Delete this wish",
      status: "approved",
    });

    // Populate cache to check invalidation
    const publicCache = app.get(PublicInvitationCache);
    await publicCache.set(
      aliceSlug,
      alice.invitation.id,
      "test-v1",
      { status: "published" } as any,
    );
    expect(await publicCache.get(aliceSlug)).toBeDefined();

    const res = await request(app.getHttpServer())
      .delete(`/api/v1/invitations/${alice.invitation.id}/guestbook/${entryId}`)
      .set("Authorization", `Bearer ${alice.token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.deleted).toBe(true);

    const { rows } = await pool.query(
      "SELECT id FROM invitation_guestbook WHERE id = $1",
      [entryId],
    );
    expect(rows.length).toBe(0);

    // Cache should be invalidated because deleted entry was approved
    expect(await publicCache.get(aliceSlug)).toBeUndefined();
  });

  // ------------------------------------------------------------------ Tenancy & IDOR Safety

  it("returns 404 for a non-owner on list, patch, and delete (IDOR protection)", async () => {
    const entryId = await insertGuestbookEntry({
      invitationId: alice.invitation.id,
      guestName: "Alice Guest",
      message: "Alice wedding wish",
      status: "pending",
    });

    // 1. Mallory attempts to list Alice's guestbook
    const resList = await request(app.getHttpServer())
      .get(`/api/v1/invitations/${alice.invitation.id}/guestbook`)
      .set("Authorization", `Bearer ${mallory.token}`);
    expect(resList.status).toBe(404);
    expect(resList.body.error.code).toBe("NOT_FOUND");

    // 2. Mallory attempts to moderate Alice's guestbook entry
    const resPatch = await request(app.getHttpServer())
      .patch(`/api/v1/invitations/${alice.invitation.id}/guestbook/${entryId}`)
      .set("Authorization", `Bearer ${mallory.token}`)
      .send({ status: "approved" });
    expect(resPatch.status).toBe(404);
    expect(resPatch.body.error.code).toBe("NOT_FOUND");

    // 3. Mallory attempts to delete Alice's guestbook entry
    const resDelete = await request(app.getHttpServer())
      .delete(`/api/v1/invitations/${alice.invitation.id}/guestbook/${entryId}`)
      .set("Authorization", `Bearer ${mallory.token}`);
    expect(resDelete.status).toBe(404);
    expect(resDelete.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 when attempting to moderate or delete an entry belonging to a different invitation of the same user", async () => {
    // Entry belongs to alice's second invitation
    const secondEntryId = await insertGuestbookEntry({
      invitationId: alice.second.invitation.id,
      guestName: "Second Wedding Guest",
      message: "Second wedding message",
      status: "pending",
    });

    // Alice calls patch on first invitation with secondEntryId
    const resPatch = await request(app.getHttpServer())
      .patch(`/api/v1/invitations/${alice.invitation.id}/guestbook/${secondEntryId}`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ status: "approved" });
    expect(resPatch.status).toBe(404);

    // Alice calls delete on first invitation with secondEntryId
    const resDelete = await request(app.getHttpServer())
      .delete(`/api/v1/invitations/${alice.invitation.id}/guestbook/${secondEntryId}`)
      .set("Authorization", `Bearer ${alice.token}`);
    expect(resDelete.status).toBe(404);
  });

  // ------------------------------------------------------------------ Validation & Mass Assignment

  it("validates moderation status and rejects unexpected request body fields", async () => {
    const entryId = await insertGuestbookEntry({
      invitationId: alice.invitation.id,
      guestName: "Validation Test",
      message: "Validating inputs",
      status: "pending",
    });

    // Invalid status enum
    const resInvalidStatus = await request(app.getHttpServer())
      .patch(`/api/v1/invitations/${alice.invitation.id}/guestbook/${entryId}`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ status: "spam_blocked" });
    expect(resInvalidStatus.status).toBe(400);

    // Attempted mass assignment of moderated_by or guest_name
    const resMassAssignment = await request(app.getHttpServer())
      .patch(`/api/v1/invitations/${alice.invitation.id}/guestbook/${entryId}`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({
        status: "approved",
        moderated_by: "hacked-user-id",
        guest_name: "Tampered Name",
      });
    expect(resMassAssignment.status).toBe(400);
  });

  it("requires authentication for all endpoints", async () => {
    const resList = await request(app.getHttpServer())
      .get(`/api/v1/invitations/${alice.invitation.id}/guestbook`);
    expect(resList.status).toBe(401);

    const resPatch = await request(app.getHttpServer())
      .patch(`/api/v1/invitations/${alice.invitation.id}/guestbook/${alice.guestbookId}`)
      .send({ status: "approved" });
    expect(resPatch.status).toBe(401);

    const resDelete = await request(app.getHttpServer())
      .delete(`/api/v1/invitations/${alice.invitation.id}/guestbook/${alice.guestbookId}`);
    expect(resDelete.status).toBe(401);
  });
});
