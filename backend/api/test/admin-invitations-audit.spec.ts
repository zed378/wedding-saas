import { describe, expect, it, vi } from "vitest";
import { AdminInvitationsService } from "../src/modules/admin/admin-invitations.service";
import type { Database } from "../src/infra/db/client";
import type { InvitationRepository } from "../src/shared/tenancy/invitation-repository";
import type { PublishCheckService } from "../src/modules/invitation/publish-check.service";

const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = "11111111-1111-4111-8111-111111111111";
function harness(
  rows: unknown[] = [{ id, slug: "sample", status: "draft" }],
  failAudit = false,
) {
  const audits = vi.fn(async (_entries: unknown) => {
    if (failAudit) throw new Error("audit unavailable");
  });
  const where = vi.fn().mockResolvedValue([{ count: rows.length }]);
  const results = {
    leftJoin: vi.fn(),
    where,
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn().mockResolvedValue(rows),
  };
  results.where = vi.fn().mockReturnValue(results);
  results.leftJoin.mockReturnValue(results);
  results.orderBy.mockReturnValue(results);
  results.limit.mockReturnValue(results);
  const countQuery = { leftJoin: vi.fn(), where };
  countQuery.leftJoin.mockReturnValue(countQuery);
  const from = vi.fn().mockReturnValueOnce(countQuery).mockReturnValue(results);
  const tx = {
    select: vi.fn().mockReturnValue({ from }),
    insert: vi.fn().mockReturnValue({ values: audits }),
  };
  const db = {
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
  };
  const repo = { adminFindInvitationBypassingOwnership: vi.fn() };
  const service = new AdminInvitationsService(
    db as unknown as Database,
    repo as unknown as InvitationRepository,
    { check: vi.fn() } as unknown as PublishCheckService,
  );
  return { service, audits, tx, db, repo, results };
}
describe("P5-10 admin invitation audit boundary", () => {
  it("does not read support details or content completeness when the detail audit fails", async () => {
    const repo = {
      adminFindInvitationBypassingOwnership: vi
        .fn()
        .mockRejectedValue(new Error("audit unavailable")),
    };
    const db = { select: vi.fn() };
    const check = vi.fn();
    const service = new AdminInvitationsService(
      db as unknown as Database,
      repo as unknown as InvitationRepository,
      { check } as unknown as PublishCheckService,
    );
    await expect(
      service.getInvitationById(admin, "Support ticket", id),
    ).rejects.toThrow("audit unavailable");
    expect(db.select).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });
  it("uses the audited invitation owner for completeness and exposes no field values", async () => {
    const ownerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const repo = {
      adminFindInvitationBypassingOwnership: vi.fn().mockResolvedValue({
        id,
        ownerId,
        templateVersionId: id,
        status: "draft",
      }),
    };
    const rows = {
      limit: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn().mockResolvedValue([]),
    };
    const query = { leftJoin: vi.fn(), where: vi.fn().mockReturnValue(rows) };
    query.leftJoin.mockReturnValue(query);
    const db = {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(query) }),
    };
    const check = vi.fn().mockResolvedValue({
      ready: false,
      details: [
        {
          field: "couple.groom.nickname",
          message: "PRIVATE FIELD DESCRIPTION",
        },
      ],
      incomplete_sections: ["hero"],
    });
    const service = new AdminInvitationsService(
      db as unknown as Database,
      repo as unknown as InvitationRepository,
      { check } as unknown as PublishCheckService,
    );
    const result = await service.getInvitationById(admin, "Support ticket", id);
    expect(check).toHaveBeenCalledWith(ownerId, id, { strict: true });
    expect(
      repo.adminFindInvitationBypassingOwnership.mock.invocationCallOrder[0],
    ).toBeLessThan(check.mock.invocationCallOrder[0]!);
    expect(result.validation_summary).toEqual({
      ready: false,
      missing_required_fields: 1,
      incomplete_sections: ["hero"],
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE FIELD DESCRIPTION");
    expect(JSON.stringify(result)).not.toContain("couple.groom.nickname");
  });
  it("audits the admin identity and every listed invitation before returning", async () => {
    const h = harness();
    const result = await h.service.listInvitations(admin, {
      page: 2,
      limit: 20,
      search_slug: "sample",
    });
    expect(result.meta).toEqual({ page: 2, per_page: 20, total: 1 });
    expect(h.db.transaction).toHaveBeenCalledOnce();
    expect(h.audits).toHaveBeenCalledWith([
      expect.objectContaining({
        adminId: admin,
        action: "invitation.admin_search",
        resourceType: "invitation_search",
      }),
      expect.objectContaining({
        adminId: admin,
        resourceId: id,
        action: "invitation.admin_read",
        afterState: { surface: "list" },
      }),
    ]);
    expect(h.results.offset).toHaveBeenCalledWith(20);
  });
  it("records even an empty search so enumeration remains detectable", async () => {
    const h = harness([]);
    expect(
      (await h.service.listInvitations(admin, { page: 1, limit: 20 })).data,
    ).toEqual([]);
    expect(h.audits.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        adminId: admin,
        action: "invitation.admin_search",
      }),
    ]);
  });
  it("fails closed when the list audit insert fails", async () => {
    const h = harness(undefined, true);
    await expect(
      h.service.listInvitations(admin, { page: 1, limit: 20 }),
    ).rejects.toThrow("audit unavailable");
  });
  it("routes unknown detail reads through the audited bypass and returns 404", async () => {
    const h = harness();
    h.repo.adminFindInvitationBypassingOwnership.mockResolvedValue(null);
    await expect(
      h.service.getInvitationById(admin, "Support ticket", id),
    ).rejects.toThrow("Undangan tidak ditemukan");
    expect(h.repo.adminFindInvitationBypassingOwnership).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ adminId: admin, reason: "Support ticket" }),
    );
  });
});
