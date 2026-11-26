import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AdminUsersService } from "../../src/modules/admin/admin-users.service";
import { AdminOrdersService } from "../../src/modules/admin/admin-orders.service";
import { AdminModerationService } from "../../src/modules/admin/admin-moderation.service";
import { AdminSlugBlocklistService } from "../../src/modules/admin/admin-slug-blocklist.service";
import { AdminSlugBlocklistRepository } from "../../src/modules/admin/admin-slug-blocklist.repository";
import { AuditLogService } from "../../src/shared/audit/audit-log.service";
import { InvitationStatusService } from "../../src/shared/invitation-status/invitation-status.service";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import { SlugService } from "../../src/modules/invitation/slug.service";
import type { CachePort } from "../../src/infra/cache/cache.port";
import type { PublicInvitationCache } from "../../src/modules/publishing/public-invitation-cache";
import type { CurrentUser } from "../../src/shared/auth-middleware/current-user";
import { startHarness, type Harness } from "../support/harness";
import {
  createTestInvitation,
  createTestOrder,
  createTestUser,
} from "../support/factories";
import { resetTenantData } from "./helpers";

describe("P5-14 counted support, moderation, refund and blocklist audit coverage", () => {
  let harness: Harness;
  beforeAll(async () => {
    harness = await startHarness();
  }, 120000);
  beforeEach(async () => {
    await resetTenantData(harness.pool);
  });
  afterAll(async () => {
    await harness?.stop();
  });

  it("persists exactly one reasoned before/after audit per successful write and invalidates public effects", async () => {
    const adminRow = await createTestUser(harness.pool, { role: "admin" });
    const admin = { ...adminRow, role: "admin" } as unknown as CurrentUser;
    const owner = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, {
      owner,
      status: "published",
      slug: "counted-audit-wedding",
    });
    const order = await createTestOrder(harness.pool, {
      invitation,
      user: owner,
      status: "paid",
    });
    const entry = await harness.pool.query(
      "INSERT INTO invitation_guestbook (invitation_id,guest_name,message,status) VALUES ($1,'Guest','Public message','pending') RETURNING id",
      [invitation.id],
    );
    const reason = "Manual acceptance review of support actions";
    const audit = new AuditLogService();
    const cache = {
      invalidate: vi.fn().mockResolvedValue(undefined),
    } as unknown as PublicInvitationCache;
    const users = new AdminUsersService(harness.db, audit);
    const moderation = new AdminModerationService(harness.db, cache);
    const orders = new AdminOrdersService(
      harness.db,
      new InvitationStatusService(harness.db),
      undefined,
      cache,
    );
    const blockCache = {
      getJson: vi.fn().mockResolvedValue(undefined),
      setJson: vi.fn(),
      invalidateNamespace: vi.fn(),
    } as unknown as CachePort;
    const blocks = new AdminSlugBlocklistService(
      new AdminSlugBlocklistRepository(harness.db, audit),
      blockCache,
      new SlugService(
        harness.db,
        new InvitationRepository(harness.db),
        blockCache,
      ),
    );
    await users.suspendUser(admin, owner.id, reason);
    expect(
      (
        await harness.pool.query("SELECT status FROM invitations WHERE id=$1", [
          invitation.id,
        ])
      ).rows[0].status,
    ).toBe("published");
    await users.unsuspendUser(admin, owner.id, reason);
    await moderation.moderateGuestbook(admin, entry.rows[0].id, {
      status: "approved",
      reason,
    });
    await moderation.moderateGuestbook(admin, entry.rows[0].id, {
      status: "rejected",
      reason,
    });
    await moderation.deleteGuestbook(admin, entry.rows[0].id, { reason });
    await orders.refundOrder(admin, order.id, reason);
    const block = await blocks.save(admin.id, {
      term: "acceptance-audit-term",
      match_type: "exact",
      category: "other",
      reason,
    });
    await blocks.save(
      admin.id,
      {
        term: "acceptance-audit-term-updated",
        match_type: "exact",
        category: "other",
        reason,
      },
      block.entry.id,
    );
    await blocks.remove(admin.id, block.entry.id, reason);
    const expected = [
      ["user.suspend", "user", owner.id],
      ["user.unsuspend", "user", owner.id],
      ["guestbook.moderate", "guestbook_entry", entry.rows[0].id],
      ["guestbook.moderate", "guestbook_entry", entry.rows[0].id],
      ["guestbook.delete", "guestbook_entry", entry.rows[0].id],
      ["order.refund", "order", order.id],
      ["slug_blocklist.create", "slug_blocklist", block.entry.id],
      ["slug_blocklist.update", "slug_blocklist", block.entry.id],
      ["slug_blocklist.delete", "slug_blocklist", block.entry.id],
    ];
    const rows = await harness.pool.query(
      "SELECT action,resource_type,resource_id,admin_id,reason,before_state,after_state FROM audit_logs WHERE admin_id=$1 ORDER BY created_at,id",
      [admin.id],
    );
    // Reconcile the whole actor session: filtering to expected actions would hide
    // duplicate or mislabelled audit records instead of proving exact coverage.
    expect(rows.rows).toHaveLength(expected.length);
    expect(
      rows.rows
        .map((row) => [row.action, row.resource_type, row.resource_id])
        .sort(),
    ).toEqual(expected.sort());
    for (const row of rows.rows) {
      expect(row.admin_id).toBe(admin.id);
      expect(row.reason).toBe(reason);
      expect(row.before_state !== null || row.after_state !== null).toBe(true);
    }
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "user.suspend",
          before_state: expect.objectContaining({ status: "active" }),
          after_state: expect.objectContaining({ status: "suspended" }),
        }),
        expect.objectContaining({
          action: "user.unsuspend",
          before_state: expect.objectContaining({ status: "suspended" }),
          after_state: expect.objectContaining({ status: "active" }),
        }),
        expect.objectContaining({
          action: "guestbook.moderate",
          before_state: expect.objectContaining({ status: "pending" }),
          after_state: expect.objectContaining({ status: "approved" }),
        }),
        expect.objectContaining({
          action: "guestbook.moderate",
          before_state: expect.objectContaining({ status: "approved" }),
          after_state: expect.objectContaining({ status: "rejected" }),
        }),
        expect.objectContaining({
          action: "order.refund",
          before_state: expect.objectContaining({
            order_status: "paid",
            invitation_status: "published",
          }),
          after_state: expect.objectContaining({
            order_status: "refunded",
            invitation_status: "draft",
          }),
        }),
        expect.objectContaining({
          action: "slug_blocklist.update",
          before_state: expect.objectContaining({
            term: "acceptance-audit-term",
          }),
          after_state: expect.objectContaining({
            term: "acceptance-audit-term-updated",
          }),
        }),
      ]),
    );
    expect(cache.invalidate).toHaveBeenCalledTimes(4);
    expect(
      (
        await harness.pool.query("SELECT status FROM invitations WHERE id=$1", [
          invitation.id,
        ])
      ).rows[0].status,
    ).toBe("draft");
    expect(
      (
        await harness.pool.query("SELECT status FROM orders WHERE id=$1", [
          order.id,
        ])
      ).rows[0].status,
    ).toBe("refunded");
  });

  it("rejects missing or sanitized-away service reasons before any write or audit", async () => {
    const admin = await createTestUser(harness.pool, { role: "admin" });
    const owner = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, { owner });
    const entry = await harness.pool.query(
      "INSERT INTO invitation_guestbook (invitation_id,guest_name,message,status) VALUES ($1,'Guest','Keep me','pending') RETURNING id",
      [invitation.id],
    );
    const moderation = new AdminModerationService(harness.db);
    const identity = admin as unknown as CurrentUser;
    await expect(
      moderation.moderateGuestbook(identity, entry.rows[0].id, {
        status: "approved",
        reason: "<script>alert(1)</script>",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      moderation.deleteGuestbook(identity, entry.rows[0].id, { reason: "" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(
      (
        await harness.pool.query(
          "SELECT status FROM invitation_guestbook WHERE id=$1",
          [entry.rows[0].id],
        )
      ).rows,
    ).toEqual([{ status: "pending" }]);
    expect(
      (
        await harness.pool.query(
          "SELECT count(*)::int AS count FROM audit_logs WHERE admin_id=$1",
          [admin.id],
        )
      ).rows[0].count,
    ).toBe(0);
  });
});
