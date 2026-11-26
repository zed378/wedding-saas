import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AdminInvitationsService } from "../../src/modules/admin/admin-invitations.service";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import { PublishCheckService } from "../../src/modules/invitation/publish-check.service";
import {
  createTestInvitation,
  createTestOrder,
  createTestUser,
} from "../support/factories";
import { startHarness, type Harness } from "../support/harness";
import { resetTenantData } from "./helpers";

describe("P5-10 invitation overview SQL and audit", () => {
  let harness: Harness;
  let service: AdminInvitationsService;
  beforeAll(async () => {
    harness = await startHarness();
    service = new AdminInvitationsService(
      harness.db,
      new InvitationRepository(harness.db),
      new PublishCheckService(new InvitationRepository(harness.db)),
    );
  }, 120_000);
  beforeEach(async () => {
    await resetTenantData(harness.pool);
  });
  afterAll(async () => {
    await harness?.stop();
  });
  it("filters by slug and owner, audits every returned ID and returns only operational detail", async () => {
    const admin = await createTestUser(harness.pool, { role: "admin" });
    const owner = await createTestUser(harness.pool, {
      fullName: "Support Owner",
    });
    const other = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, {
      owner,
      slug: "support-wedding",
      internalName: "PRIVATE FAMILY TITLE",
    });
    await createTestInvitation(harness.pool, {
      owner: other,
      slug: "unrelated-wedding",
    });
    const paid = await createTestOrder(harness.pool, {
      invitation,
      user: owner,
      status: "paid",
    });
    await createTestOrder(harness.pool, {
      invitation,
      user: owner,
      status: "failed",
    });
    await harness.pool.query(
      "INSERT INTO invitation_status_history (invitation_id,from_status,to_status) VALUES ($1,'draft','paid')",
      [invitation.id],
    );
    const listed = await service.listInvitations(admin.id, {
      search_slug: "support",
      search_user: owner.email,
      page: 1,
      limit: 20,
    });
    expect(listed.meta.total).toBe(1);
    expect(listed.data).toMatchObject([
      { id: invitation.id, owner_email: owner.email, version: "1.0.0" },
    ]);
    const read = await service.getInvitationById(
      admin.id,
      "Support ticket 123",
      invitation.id,
    );
    expect(read.template_version).toMatchObject({
      id: invitation.templateVersionId,
      version: "1.0.0",
    });
    expect(read.order_history).toHaveLength(2);
    expect(read.validation_summary).toEqual({
      ready: false,
      missing_required_fields: 2,
      incomplete_sections: ["hero"],
    });
    expect(read.order_history).toContainEqual(
      expect.objectContaining({
        id: paid.id,
        status: "paid",
        amount_total: "139000",
      }),
    );
    expect(read.status_history).toEqual([
      expect.objectContaining({ from_status: "draft", to_status: "paid" }),
    ]);
    expect(
      JSON.stringify({ listed, read }, (_, value) =>
        typeof value === "bigint" ? String(value) : value,
      ),
    ).not.toContain("PRIVATE FAMILY TITLE");
    const audit = await harness.pool.query(
      "SELECT admin_id,resource_id,action FROM audit_logs WHERE admin_id=$1 ORDER BY created_at",
      [admin.id],
    );
    expect(
      audit.rows.filter((row) => row.action === "invitation.admin_read"),
    ).toEqual([
      expect.objectContaining({
        admin_id: admin.id,
        resource_id: invitation.id,
      }),
      expect.objectContaining({
        admin_id: admin.id,
        resource_id: invitation.id,
      }),
    ]);
    expect(audit.rows).toContainEqual(
      expect.objectContaining({ action: "invitation.admin_search" }),
    );
  });
  it("updates operational completeness from missing fields to complete without exposing content", async () => {
    const admin = await createTestUser(harness.pool, { role: "admin" });
    const owner = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, { owner });
    const incomplete = await service.getInvitationById(
      admin.id,
      "Support content readiness",
      invitation.id,
    );
    expect(incomplete.validation_summary).toEqual({
      ready: false,
      missing_required_fields: 2,
      incomplete_sections: ["hero"],
    });
    await harness.pool.query(
      `INSERT INTO invitation_people (invitation_id, role, full_name, nickname)
       VALUES ($1, 'groom', 'PRIVATE GROOM NAME', 'PRIVATE GROOM'),
              ($1, 'bride', 'PRIVATE BRIDE NAME', 'PRIVATE BRIDE')`,
      [invitation.id],
    );
    const complete = await service.getInvitationById(
      admin.id,
      "Support content readiness",
      invitation.id,
    );
    expect(complete.validation_summary).toEqual({
      ready: true,
      missing_required_fields: 0,
      incomplete_sections: [],
    });
    expect(JSON.stringify(complete)).not.toContain("PRIVATE");
    const audited = await harness.pool.query(
      "SELECT count(*)::int AS count FROM audit_logs WHERE admin_id=$1 AND resource_id=$2 AND action='invitation.admin_read'",
      [admin.id, invitation.id],
    );
    expect(audited.rows[0].count).toBe(2);
  });
  it("audits nonexistent detail probes before returning 404", async () => {
    const admin = await createTestUser(harness.pool, { role: "admin" });
    const missing = randomUUID();
    await expect(
      service.getInvitationById(admin.id, "Support missing record", missing),
    ).rejects.toThrow("Undangan tidak ditemukan");
    const rows = await harness.pool.query(
      "SELECT after_state FROM audit_logs WHERE resource_id=$1 AND admin_id=$2",
      [missing, admin.id],
    );
    expect(rows.rows).toEqual([{ after_state: { found: false } }]);
  });
});
