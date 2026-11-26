import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AdminSlugBlocklistRepository } from "../../src/modules/admin/admin-slug-blocklist.repository";
import { AdminSlugBlocklistService } from "../../src/modules/admin/admin-slug-blocklist.service";
import { slugBlocklistWriteSchema } from "../../src/modules/admin/schemas/admin-slug-blocklist.schema";
import { SlugService } from "../../src/modules/invitation/slug.service";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import { AuditLogService } from "../../src/shared/audit/audit-log.service";
import type { CachePort } from "../../src/infra/cache/cache.port";
import { startHarness, type Harness } from "../support/harness";
import { createTestInvitation, createTestUser } from "../support/factories";

describe("P5-13 real PostgreSQL blocklist governance", () => {
  let harness: Harness;
  let service: AdminSlugBlocklistService;
  let slugs: SlugService;
  let admin: { id: string };
  const audit = new AuditLogService();
  const cache = {
    getJson: vi.fn().mockResolvedValue(undefined),
    setJson: vi.fn().mockResolvedValue(undefined),
    invalidateNamespace: vi.fn().mockResolvedValue(1),
  } as unknown as CachePort;
  beforeAll(async () => {
    harness = await startHarness();
    slugs = new SlugService(
      harness.db,
      new InvitationRepository(harness.db),
      cache,
    );
    service = new AdminSlugBlocklistService(
      new AdminSlugBlocklistRepository(harness.db, audit),
      cache,
      slugs,
    );
  }, 120000);
  beforeEach(async () => {
    await harness.pool.query(
      "TRUNCATE users, templates, media RESTART IDENTITY CASCADE",
    );
    await harness.pool.query("DELETE FROM slug_blocklist");
    vi.clearAllMocks();
    admin = await createTestUser(harness.pool, { role: "admin" });
  });
  afterAll(async () => {
    await harness?.stop();
  });
  const data = (term: string, match_type: "exact" | "substring" = "exact") =>
    slugBlocklistWriteSchema.parse({
      term,
      match_type,
      category: "other",
      reason: "Support investigation",
    });
  it("creates audited data and reports matching existing invitations without changing them", async () => {
    const owner = await createTestUser(harness.pool);
    const inv = await createTestInvitation(harness.pool, {
      owner,
      slug: "sample",
      status: "published",
    });
    const result = await service.save(admin.id, data("SAMPLE"));
    expect(result.entry.term).toBe("sample");
    expect(result.existing_match_count).toBe(1);
    expect(result.existing_matches).toEqual([
      { id: inv.id, slug: "sample", status: "published" },
    ]);
    expect(
      (
        await harness.pool.query("SELECT status FROM invitations WHERE id=$1", [
          inv.id,
        ])
      ).rows[0].status,
    ).toBe("published");
    const { rows } = await harness.pool.query(
      "SELECT action, admin_id, resource_id, reason FROM audit_logs ORDER BY action",
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "slug_blocklist.create",
          admin_id: admin.id,
          resource_id: result.entry.id,
          reason: "Support investigation",
        }),
        expect.objectContaining({
          action: "admin.read",
          admin_id: admin.id,
          resource_id: inv.id,
        }),
      ]),
    );
    expect(cache.invalidateNamespace).toHaveBeenCalledWith("slug-blocklist");
    expect(await slugs.findBlockingTerm("sample")).toBe("sample");
    expect(await slugs.findBlockingTerm("sample-couple")).toBeUndefined();
  });
  it("updates/deletes with before-after audits and handles duplicate/missing ids", async () => {
    const created = await service.save(admin.id, data("original"));
    await expect(
      service.save(admin.id, data("ORIGINAL")),
    ).rejects.toMatchObject({ code: "BLOCKLIST_TERM_EXISTS" });
    await service.save(admin.id, data("revised"), created.entry.id);
    expect(await slugs.findBlockingTerm("original")).toBeUndefined();
    expect(await slugs.findBlockingTerm("revised")).toBe("revised");
    await service.remove(admin.id, created.entry.id, "Remove obsolete term");
    await expect(
      service.remove(admin.id, created.entry.id, "Remove obsolete term"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { rows } = await harness.pool.query(
      "SELECT action, before_state, after_state FROM audit_logs WHERE resource_id=$1 ORDER BY created_at",
      [created.entry.id],
    );
    expect(rows.map((row) => row.action)).toEqual([
      "slug_blocklist.create",
      "slug_blocklist.update",
      "slug_blocklist.delete",
    ]);
    expect(rows[1].before_state.term).toBe("original");
    expect(rows[1].after_state.term).toBe("revised");
  });
  it("keys a fetched blocklist snapshot with the same fingerprint as PostgreSQL", async () => {
    await service.save(admin.id, data("second"));
    await service.save(admin.id, data("first", "substring"));
    vi.clearAllMocks();

    expect(await slugs.findBlockingTerm("couple-first-day")).toBe("first");
    const { rows } = await harness.pool.query(
      "SELECT encode(sha256(convert_to(coalesce(string_agg(id::text || ':' || term || ':' || match_type, ',' order by id), ''), 'UTF8')), 'hex') AS fingerprint FROM slug_blocklist",
    );
    expect(cache.setJson).toHaveBeenCalledWith(
      "slug-blocklist",
      rows[0].fingerprint,
      expect.arrayContaining([
        { term: "second", matchType: "exact" },
        { term: "first", matchType: "substring" },
      ]),
      60,
    );
  });
  it("folded substring impact matches the enforcement checker including padding", async () => {
    const owner = await createTestUser(harness.pool);
    await createTestInvitation(harness.pool, { owner, slug: "couple-b4d-day" });
    const result = await service.save(admin.id, data("bad", "substring"));
    expect(result.existing_match_count).toBe(1);
    expect(await slugs.findBlockingTerm("couple-B4D-day")).toBe("bad");
    expect(await slugs.findBlockingTerm("sandi-april")).toBeUndefined();
  });
  it("cannot remove or rename an exact public route reservation", async () => {
    const result = await service.save(admin.id, data("preview"));
    await expect(
      service.remove(admin.id, result.entry.id, "Remove route word"),
    ).rejects.toMatchObject({ code: "RESERVED_PUBLIC_ROUTE" });
    await expect(
      service.save(admin.id, data("different"), result.entry.id),
    ).rejects.toMatchObject({ code: "RESERVED_PUBLIC_ROUTE" });
    await expect(
      service.save(admin.id, data("preview", "substring"), result.entry.id),
    ).rejects.toMatchObject({ code: "RESERVED_PUBLIC_ROUTE" });
    expect(await slugs.findBlockingTerm("preview")).toBe("preview");
  });
  it("rolls back a mutation if its audit insert fails", async () => {
    const brokenAudit = {
      record: vi.fn().mockRejectedValue(new Error("audit down")),
    } as unknown as AuditLogService;
    const broken = new AdminSlugBlocklistService(
      new AdminSlugBlocklistRepository(harness.db, brokenAudit),
      cache,
      slugs,
    );
    await expect(broken.save(admin.id, data("rollback"))).rejects.toThrow(
      "audit down",
    );
    expect(
      (
        await harness.pool.query(
          "SELECT count(*)::int AS total FROM slug_blocklist WHERE term='rollback'",
        )
      ).rows[0].total,
    ).toBe(0);
  });
});
