import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Redis as IORedis } from "ioredis";
import { AdminTemplatesService } from "../../src/modules/admin/admin-templates.service";
import { TemplateRepository } from "../../src/modules/template/template.repository";
import { TemplateService } from "../../src/modules/template/template.service";
import { RedisCache } from "../../src/infra/cache/redis-cache";
import { AuditLogService } from "../../src/shared/audit/audit-log.service";
import { PublicInvitationRepository } from "../../src/shared/tenancy/public-invitation-repository";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import { InvitationStatusService } from "../../src/shared/invitation-status/invitation-status.service";
import { InvitationCreateService } from "../../src/modules/invitation/invitation-create.service";
import { SlugService } from "../../src/modules/invitation/slug.service";
import {
  createTestTemplateVersion,
  createTestUser,
} from "../support/factories";
import { startHarness, type Harness } from "../support/harness";
import { resetTenantData } from "./helpers";

describe("P5-14 live template authoring and counted audit trail", () => {
  let harness: Harness;
  let redis: IORedis;
  let catalog: TemplateService;
  let authors: AdminTemplatesService;
  let invitations: InvitationCreateService;
  beforeAll(async () => {
    harness = await startHarness();
    redis = new IORedis(
      process.env["TEST_REDIS_URL"] ??
        process.env["REDIS_URL"] ??
        "redis://localhost:56379",
      { maxRetriesPerRequest: 1, connectTimeout: 2000 },
    );
    await redis.ping();
    catalog = new TemplateService(
      new TemplateRepository(harness.db),
      new RedisCache(redis),
      new PublicInvitationRepository(harness.db),
    );
    authors = new AdminTemplatesService(
      harness.db,
      new AuditLogService(),
      catalog,
    );
    const repository = new InvitationRepository(harness.db);
    invitations = new InvitationCreateService(
      harness.db,
      new SlugService(harness.db, repository),
      new InvitationStatusService(harness.db),
      repository,
    );
  }, 120_000);
  beforeEach(async () => {
    await resetTenantData(harness.pool);
    await catalog.invalidate();
  });
  afterAll(async () => {
    await redis?.quit().catch(() => redis.disconnect());
    await harness?.stop();
  });

  it("BR-3.1 authors and publishes data without restart, immediately exposes catalog, locks user version and audits every successful template action", async () => {
    const admin = await createTestUser(harness.pool, { role: "admin" });
    const owner = await createTestUser(harness.pool);
    // Reuse the canonical factory definition, not an invented/template-specific component.
    const reference = await createTestTemplateVersion(harness.pool);
    const source = await harness.pool.query(
      "SELECT sections,theme,customizable_theme_keys FROM template_versions WHERE id=$1",
      [reference.versionId],
    );
    const definition = source.rows[0]!;
    const query = { search: "Acceptance Live", limit: 20, offset: 0 };
    expect((await catalog.list(query)).items).toHaveLength(0); // prime a negative Redis entry
    const reason = "Phase 5 acceptance authored through service";
    const template = await authors.createTemplate(admin, {
      slug: "acceptance-live",
      name: "Acceptance Live",
      category: ["classic"],
      is_premium: false,
      reason,
    });
    await authors.updateTemplate(admin, template.id, {
      name: "Acceptance Live Updated",
      reason,
    });
    const version = await authors.createVersion(admin, template.id, {
      version: "1.0.0",
      sections: definition.sections,
      theme: definition.theme,
      customizable_theme_keys: definition.customizable_theme_keys,
      reason,
    });
    await authors.updateVersion(admin, template.id, version.id, {
      changelog: "Authored without deploy",
      reason,
    });
    await authors.publishVersion(admin, template.id, version.id, reason);
    expect((await catalog.list(query)).items).toMatchObject([
      { id: template.id },
    ]);
    const invitation = await invitations.create(owner.scope, {
      templateId: template.id,
      internalName: "Acceptance invitation",
    });
    expect(invitation.templateVersionId).toBe(version.id);
    await expect(
      authors.updateVersion(admin, template.id, version.id, {
        changelog: "Tampering",
        reason,
      }),
    ).rejects.toMatchObject({ code: "VERSION_IMMUTABLE" });
    await expect(
      authors.deleteTemplate(admin, template.id, reason),
    ).rejects.toMatchObject({ code: "TEMPLATE_IN_USE" });
    await authors.deprecateVersion(admin, template.id, version.id, reason);
    expect((await catalog.list(query)).items).toHaveLength(0);
    const persisted = await harness.pool.query(
      "SELECT template_version_id FROM invitations WHERE id=$1",
      [invitation.id],
    );
    expect(persisted.rows[0].template_version_id).toBe(version.id);

    const disposable = await authors.createTemplate(admin, {
      slug: "acceptance-disposable",
      name: "Disposable",
      category: [],
      is_premium: false,
      reason,
    });
    await authors.deleteTemplate(admin, disposable.id, reason);
    const expected = [
      ["template.create", "template", template.id],
      ["template.update", "template", template.id],
      ["template_version.create", "template_version", version.id],
      ["template_version.update", "template_version", version.id],
      ["template_version.publish", "template_version", version.id],
      ["template_version.deprecate", "template_version", version.id],
      ["template.create", "template", disposable.id],
      ["template.delete", "template", disposable.id],
    ];
    const audit = await harness.pool.query(
      "SELECT action,reason,resource_type,resource_id,before_state,after_state FROM audit_logs WHERE admin_id=$1 ORDER BY created_at,id",
      [admin.id],
    );
    // Compare the complete scripted session, rather than checking a single sample row.
    expect(audit.rows).toHaveLength(expected.length);
    expect(
      audit.rows
        .map((row) => [row.action, row.resource_type, row.resource_id])
        .sort(),
    ).toEqual(expected.sort());
    for (const row of audit.rows) {
      expect(row.reason).toBe(reason);
      expect([template.id, version.id, disposable.id]).toContain(
        row.resource_id,
      );
      expect(row.before_state !== null || row.after_state !== null).toBe(true);
    }
  });
});
