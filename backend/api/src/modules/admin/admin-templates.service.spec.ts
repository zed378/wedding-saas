import { describe, expect, it, vi } from "vitest";

import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../http/errors";
import { AdminTemplatesService } from "./admin-templates.service";

const VALID_THEME = {
  colors: {
    primary: "#8B5E3C",
    secondary: "#F4EDE4",
    accent: "#C9A876",
    text: "#2B2B2B",
  },
  typography: {
    heading_font: "Playfair Display",
    body_font: "Lato",
    scale: "default",
  },
  spacing: "comfortable",
  border_radius: "rounded",
};

const VALID_SECTIONS = [
  {
    section_key: "hero",
    component: "HeroClassic",
    enabled_by_default: true,
    configurable: false,
    required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
    optional_fields: [],
  },
  {
    section_key: "gallery",
    component: "GalleryGrid",
    enabled_by_default: true,
    configurable: true,
    max_items: 20,
    required_fields: ["gallery.photos"],
    optional_fields: ["gallery.photos.*.caption"],
    layout_variant: "grid-3col",
    layout_options: ["grid-3col", "carousel"],
  },
];

const ADMIN = { id: "admin-1" };
const TEMPLATE = {
  id: "template-1",
  slug: "floral-classic",
  name: "Floral Classic",
  status: "draft",
};

type Queues = {
  dbSelect?: unknown[];
  txSelect?: unknown[];
  insert?: unknown[];
  update?: unknown[];
  delete?: unknown[];
};

function makeQuery(result: unknown) {
  const query: Record<string, unknown> = {};
  for (const method of [
    "from",
    "where",
    "limit",
    "orderBy",
    "groupBy",
    "set",
    "values",
    "returning",
  ]) {
    query[method] = vi.fn(() => query);
  }
  // Drizzle query builders are awaitable; the test double must model that API.
  // oxlint-disable-next-line unicorn/no-thenable
  query.then = (
    resolve: (value: unknown) => unknown,
    reject: (error: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return query;
}

function createHarness(results: Queues = {}) {
  const queues = {
    dbSelect: [...(results.dbSelect ?? [])],
    txSelect: [...(results.txSelect ?? [])],
    insert: [...(results.insert ?? [])],
    update: [...(results.update ?? [])],
    delete: [...(results.delete ?? [])],
  };
  const next = (key: keyof Queues) => makeQuery(queues[key].shift() ?? []);
  const tx = {
    select: vi.fn(() => next("txSelect")),
    insert: vi.fn(() => next("insert")),
    update: vi.fn(() => next("update")),
    delete: vi.fn(() => next("delete")),
  };
  const db = {
    select: vi.fn(() => next("dbSelect")),
    transaction: vi.fn(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  const auditLogs = { record: vi.fn().mockResolvedValue(undefined) };
  const templateService = { invalidate: vi.fn().mockResolvedValue(1) };
  const service = new AdminTemplatesService(
    db as never,
    auditLogs as never,
    templateService as never,
  );
  return { service, db, tx, auditLogs, templateService };
}

function draftVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-1",
    templateId: TEMPLATE.id,
    version: "1.0.0",
    sections: VALID_SECTIONS,
    theme: VALID_THEME,
    customizableThemeKeys: ["colors.primary"],
    status: "draft",
    ...overrides,
  };
}

function versionInput(overrides: Record<string, unknown> = {}) {
  return {
    version: "1.0.0",
    sections: VALID_SECTIONS,
    theme: VALID_THEME,
    customizable_theme_keys: ["colors.primary"],
    reason: "Create template version",
    ...overrides,
  };
}

describe("AdminTemplatesService", () => {
  it("groups versions and counts invitations without losing zero-use versions", async () => {
    const { service } = createHarness({
      dbSelect: [
        [{ id: "t1" }, { id: "t2" }],
        [
          { id: "v1", templateId: "t1" },
          { id: "v2", templateId: "t1" },
        ],
        [
          { versionId: "v1", total: "2" },
          { versionId: null, total: "9" },
        ],
      ],
    });

    await expect(service.listTemplates()).resolves.toEqual([
      {
        id: "t1",
        versions: [
          { id: "v1", templateId: "t1", invitation_count: 2 },
          { id: "v2", templateId: "t1", invitation_count: 0 },
        ],
      },
      { id: "t2", versions: [] },
    ]);
  });

  it("does not issue an invitation-count query when there are no versions", async () => {
    const { service, db } = createHarness({ dbSelect: [[{ id: "t1" }], []] });

    await expect(service.listTemplates()).resolves.toEqual([
      { id: "t1", versions: [] },
    ]);
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("returns a template with per-version invitation counts when found by slug", async () => {
    const template = { ...TEMPLATE };
    const { service } = createHarness({
      dbSelect: [
        [template],
        [
          { id: "v1", templateId: template.id },
          { id: "v2", templateId: template.id },
        ],
        [{ versionId: "v2", total: "4" }],
      ],
    });

    await expect(service.getTemplate(template.slug)).resolves.toEqual({
      ...template,
      versions: [
        { id: "v1", templateId: template.id, invitation_count: 0 },
        { id: "v2", templateId: template.id, invitation_count: 4 },
      ],
    });
  });

  it("returns an empty version list and a not-found error for a missing template", async () => {
    const { service } = createHarness({ dbSelect: [[TEMPLATE], []] });
    await expect(service.getTemplate(TEMPLATE.id)).resolves.toMatchObject({
      id: TEMPLATE.id,
      versions: [],
    });

    const missing = createHarness({ dbSelect: [[]] });
    await expect(missing.service.getTemplate("missing")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("rejects a duplicate template slug before opening a transaction", async () => {
    const { service, db } = createHarness({ dbSelect: [[{ id: "existing" }]] });

    await expect(
      service.createTemplate(ADMIN, {
        slug: TEMPLATE.slug,
        name: TEMPLATE.name,
        category: [],
        is_premium: false,
        reason: "Duplicate slug request",
      } as never),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("creates and audits a draft template, defaulting a missing thumbnail to null", async () => {
    const created = { ...TEMPLATE, thumbnailUrl: null };
    const { service, tx, auditLogs } = createHarness({
      dbSelect: [[]],
      insert: [[created]],
    });

    await expect(
      service.createTemplate(ADMIN, {
        slug: TEMPLATE.slug,
        name: TEMPLATE.name,
        category: [],
        is_premium: false,
        reason: "Add a new template",
      } as never),
    ).resolves.toEqual(created);
    expect(tx.insert).toHaveBeenCalledOnce();
    expect(auditLogs.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        adminId: ADMIN.id,
        action: "template.create",
        resourceType: "template",
        resourceId: created.id,
        reason: "Add a new template",
        afterState: created,
      }),
    );
  });

  it("fails clearly when template creation unexpectedly returns no row", async () => {
    const { service, auditLogs } = createHarness({
      dbSelect: [[]],
      insert: [[]],
    });

    await expect(
      service.createTemplate(ADMIN, {
        slug: TEMPLATE.slug,
        name: TEMPLATE.name,
        category: [],
        is_premium: false,
        reason: "Add a new template",
      } as never),
    ).rejects.toThrow("Failed to insert template");
    expect(auditLogs.record).not.toHaveBeenCalled();
  });

  it("updates supplied metadata fields and records before and after snapshots", async () => {
    const before = { ...TEMPLATE, isPremium: false, thumbnailUrl: null };
    const updated = {
      ...before,
      name: "Updated name",
      category: ["modern"],
      isPremium: true,
      thumbnailUrl: "https://cdn.example/thumb.webp",
      status: "deprecated",
    };
    const { service, tx, auditLogs } = createHarness({
      txSelect: [[before]],
      update: [[updated]],
    });

    await expect(
      service.updateTemplate(ADMIN, TEMPLATE.id, {
        name: updated.name,
        category: updated.category,
        is_premium: updated.isPremium,
        thumbnail_url: updated.thumbnailUrl,
        status: updated.status,
        reason: "Refresh template metadata",
      } as never),
    ).resolves.toEqual(updated);
    expect(auditLogs.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "template.update",
        beforeState: before,
        afterState: updated,
      }),
    );
  });

  it("updates only the timestamp when no optional metadata field is supplied", async () => {
    const before = { ...TEMPLATE };
    const updated = { ...before, updatedAt: new Date() };
    const { service, tx } = createHarness({
      txSelect: [[before]],
      update: [[updated]],
    });

    await service.updateTemplate(ADMIN, TEMPLATE.id, {
      reason: "Keep current template metadata",
    } as never);
    const updateQuery = tx.update.mock.results[0]!.value as ReturnType<
      typeof makeQuery
    >;
    expect(updateQuery.set).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAt: expect.any(Date) }),
    );
    expect(updateQuery.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: expect.anything() }),
    );
  });

  it("rejects a missing template and a failed metadata update", async () => {
    const missing = createHarness({ txSelect: [[]] });
    await expect(
      missing.service.updateTemplate(ADMIN, "missing", {
        reason: "No template",
      } as never),
    ).rejects.toBeInstanceOf(NotFoundError);

    const failed = createHarness({ txSelect: [[TEMPLATE]], update: [[]] });
    await expect(
      failed.service.updateTemplate(ADMIN, TEMPLATE.id, {
        reason: "Update template",
      } as never),
    ).rejects.toThrow("Failed to update template");
  });

  it("refuses template deletion for direct invitation references", async () => {
    const { service, templateService } = createHarness({
      txSelect: [[TEMPLATE], [{ count: "2" }]],
    });

    await expect(
      service.deleteTemplate(ADMIN, TEMPLATE.id, "Remove unused template"),
    ).rejects.toMatchObject({ code: "TEMPLATE_IN_USE" });
    expect(templateService.invalidate).not.toHaveBeenCalled();
  });

  it("refuses deletion when an invitation references one of the template versions", async () => {
    const { service } = createHarness({
      txSelect: [[TEMPLATE], [{ count: 0 }], [{ id: "v1" }], [{ count: "1" }]],
    });

    await expect(
      service.deleteTemplate(ADMIN, TEMPLATE.id, "Remove unused template"),
    ).rejects.toMatchObject({ code: "TEMPLATE_IN_USE" });
  });

  it("deletes a template with no invitations or versions and invalidates catalog cache", async () => {
    const { service, tx, auditLogs, templateService } = createHarness({
      txSelect: [[TEMPLATE], [], []],
    });

    await expect(
      service.deleteTemplate(ADMIN, TEMPLATE.id, "Remove obsolete template"),
    ).resolves.toEqual({ deleted: true, id: TEMPLATE.id });
    expect(tx.delete).toHaveBeenCalledOnce();
    expect(auditLogs.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "template.delete",
        resourceId: TEMPLATE.id,
        reason: "Remove obsolete template",
      }),
    );
    expect(templateService.invalidate).toHaveBeenCalledOnce();
  });

  it("deletes unreferenced versions before their template", async () => {
    const { service, tx } = createHarness({
      txSelect: [
        [TEMPLATE],
        [{ count: 0 }],
        [{ id: "v1" }, { id: "v2" }],
        [{ count: 0 }],
      ],
    });

    await service.deleteTemplate(ADMIN, TEMPLATE.id, "Remove old template");
    expect(tx.delete).toHaveBeenCalledTimes(2);
  });

  it("rejects template deletion when the template does not exist", async () => {
    const { service } = createHarness({ txSelect: [[]] });
    await expect(
      service.deleteTemplate(ADMIN, "missing", "Remove missing template"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects versions for missing templates, invalid definitions, and duplicate numbers", async () => {
    const missing = createHarness({ dbSelect: [[]] });
    await expect(
      missing.service.createVersion(
        ADMIN,
        TEMPLATE.id,
        versionInput() as never,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    const invalid = createHarness({ dbSelect: [[TEMPLATE]] });
    await expect(
      invalid.service.createVersion(
        ADMIN,
        TEMPLATE.id,
        versionInput({
          sections: [
            { section_key: "hero", component: "UnregisteredComponent" },
          ],
        }) as never,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    const duplicate = createHarness({
      dbSelect: [[TEMPLATE], [{ id: "existing" }]],
    });
    await expect(
      duplicate.service.createVersion(
        ADMIN,
        TEMPLATE.id,
        versionInput() as never,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(duplicate.db.transaction).not.toHaveBeenCalled();
  });

  it("creates a validated draft version and audits its accepted definition", async () => {
    const created = draftVersion();
    const { service, tx, auditLogs } = createHarness({
      dbSelect: [[{ id: TEMPLATE.id, slug: TEMPLATE.slug }], []],
      insert: [[created]],
    });

    await expect(
      service.createVersion(ADMIN, TEMPLATE.id, versionInput() as never),
    ).resolves.toEqual(created);
    expect(auditLogs.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "template_version.create",
        resourceType: "template_version",
        resourceId: created.id,
        reason: "Create template version",
        afterState: created,
      }),
    );
  });

  it("fails clearly if draft-version insertion returns no row", async () => {
    const { service, auditLogs } = createHarness({
      dbSelect: [[{ id: TEMPLATE.id, slug: TEMPLATE.slug }], []],
      insert: [[]],
    });

    await expect(
      service.createVersion(ADMIN, TEMPLATE.id, versionInput() as never),
    ).rejects.toThrow("Failed to create template version");
    expect(auditLogs.record).not.toHaveBeenCalled();
  });

  it("rejects missing, published, and deprecated versions from the edit path", async () => {
    const missing = createHarness({ txSelect: [[]] });
    await expect(
      missing.service.updateVersion(ADMIN, TEMPLATE.id, "missing", {
        reason: "Update draft",
      } as never),
    ).rejects.toBeInstanceOf(NotFoundError);

    for (const status of ["published", "deprecated"]) {
      const immutable = createHarness({
        txSelect: [[draftVersion({ status })]],
      });
      await expect(
        immutable.service.updateVersion(ADMIN, TEMPLATE.id, "1.0.0", {
          reason: "Update draft",
        } as never),
      ).rejects.toMatchObject({ code: "VERSION_IMMUTABLE" });
    }
  });

  it("validates merged draft definitions and audits updates while preserving omitted fields", async () => {
    const before = draftVersion();
    const updated = { ...before, changelog: "Refine first draft" };
    const { service, tx, auditLogs } = createHarness({
      txSelect: [[before]],
      update: [[updated]],
    });

    await expect(
      service.updateVersion(ADMIN, TEMPLATE.id, before.id, {
        changelog: "Refine first draft",
        reason: "Update template draft",
      } as never),
    ).resolves.toEqual(updated);
    const updateQuery = tx.update.mock.results[0]!.value as ReturnType<
      typeof makeQuery
    >;
    expect(updateQuery.set).toHaveBeenCalledWith({
      sections: VALID_SECTIONS,
      theme: VALID_THEME,
      customizableThemeKeys: ["colors.primary"],
      changelog: "Refine first draft",
    });
    expect(auditLogs.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "template_version.update",
        beforeState: before,
        afterState: updated,
      }),
    );

    const invalid = createHarness({ txSelect: [[before]] });
    await expect(
      invalid.service.updateVersion(ADMIN, TEMPLATE.id, before.id, {
        sections: [{ section_key: "hero", component: "UnknownComponent" }],
        reason: "Reject invalid draft",
      } as never),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts complete draft replacements without a changelog and detects a missing update row", async () => {
    const before = draftVersion();
    const updated = draftVersion({
      theme: { ...VALID_THEME, spacing: "compact" },
    });
    const { service, tx } = createHarness({
      txSelect: [[before]],
      update: [[updated]],
    });

    await service.updateVersion(ADMIN, TEMPLATE.id, "1.0.0", {
      sections: VALID_SECTIONS,
      theme: { ...VALID_THEME, spacing: "compact" },
      customizable_theme_keys: [],
      reason: "Replace draft definition",
    } as never);
    const updateQuery = tx.update.mock.results[0]!.value as ReturnType<
      typeof makeQuery
    >;
    expect(updateQuery.set).toHaveBeenCalledWith({
      sections: VALID_SECTIONS,
      theme: { ...VALID_THEME, spacing: "compact" },
      customizableThemeKeys: [],
    });

    const missingUpdate = createHarness({ txSelect: [[before]], update: [[]] });
    await expect(
      missingUpdate.service.updateVersion(ADMIN, TEMPLATE.id, before.id, {
        reason: "Update draft version",
      } as never),
    ).rejects.toThrow("Failed to update template version");
  });

  it("publishes a version, records the transition, promotes the template and invalidates cache", async () => {
    const before = draftVersion();
    const published = draftVersion({
      status: "published",
      releasedAt: new Date(),
    });
    const { service, tx, auditLogs, templateService } = createHarness({
      txSelect: [[before]],
      update: [[published], []],
    });

    await expect(
      service.publishVersion(
        ADMIN,
        TEMPLATE.id,
        "1.0.0",
        "Publish verified version",
      ),
    ).resolves.toEqual(published);
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(auditLogs.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "template_version.publish",
        beforeState: before,
        afterState: published,
        reason: "Publish verified version",
      }),
    );
    expect(templateService.invalidate).toHaveBeenCalledOnce();
  });

  it("reports missing or failed publication without writing an audit or invalidating cache", async () => {
    const missing = createHarness({ txSelect: [[]] });
    await expect(
      missing.service.publishVersion(
        ADMIN,
        TEMPLATE.id,
        "missing",
        "Publish version",
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    const failed = createHarness({
      txSelect: [[draftVersion()]],
      update: [[]],
    });
    await expect(
      failed.service.publishVersion(
        ADMIN,
        TEMPLATE.id,
        "1.0.0",
        "Publish version",
      ),
    ).rejects.toThrow("Failed to publish version");
    expect(failed.auditLogs.record).not.toHaveBeenCalled();
    expect(failed.templateService.invalidate).not.toHaveBeenCalled();
  });

  it("deprecates a version, audits the change, and invalidates catalog cache", async () => {
    const before = draftVersion({ status: "published" });
    const deprecated = { ...before, status: "deprecated" };
    const { service, tx, auditLogs, templateService } = createHarness({
      txSelect: [[before]],
      update: [[deprecated]],
    });

    await expect(
      service.deprecateVersion(
        ADMIN,
        TEMPLATE.id,
        before.id,
        "Replace old version",
      ),
    ).resolves.toEqual(deprecated);
    expect(auditLogs.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "template_version.deprecate",
        beforeState: before,
        afterState: deprecated,
        reason: "Replace old version",
      }),
    );
    expect(templateService.invalidate).toHaveBeenCalledOnce();
  });

  it("reports missing or failed deprecation without audit or cache invalidation", async () => {
    const missing = createHarness({ txSelect: [[]] });
    await expect(
      missing.service.deprecateVersion(
        ADMIN,
        TEMPLATE.id,
        "missing",
        "Deprecate version",
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    const failed = createHarness({
      txSelect: [[draftVersion()]],
      update: [[]],
    });
    await expect(
      failed.service.deprecateVersion(
        ADMIN,
        TEMPLATE.id,
        "1.0.0",
        "Deprecate version",
      ),
    ).rejects.toThrow("Failed to deprecate version");
    expect(failed.auditLogs.record).not.toHaveBeenCalled();
    expect(failed.templateService.invalidate).not.toHaveBeenCalled();
  });

  it("does not return a published version or invalidate cache when its transactional audit fails", async () => {
    const before = draftVersion();
    const published = draftVersion({ status: "published" });
    const { service, auditLogs, templateService } = createHarness({
      txSelect: [[before]],
      update: [[published], []],
    });
    auditLogs.record.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(
      service.publishVersion(
        ADMIN,
        TEMPLATE.id,
        before.id,
        "Publish audited version",
      ),
    ).rejects.toThrow("audit unavailable");
    expect(templateService.invalidate).not.toHaveBeenCalled();
  });
});
