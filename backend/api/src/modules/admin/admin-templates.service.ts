import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { validateTemplateVersion } from "@wi/schema";

import { DB, type Database } from "../../infra/db/client";
import { templates, templateVersions } from "../../infra/db/schema/templates";
import { invitations } from "../../infra/db/schema/invitations";
import { AuditLogService } from "../../shared/audit/audit-log.service";
import { TemplateService } from "../template/template.service";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../http/errors";
import type {
  CreateTemplateDto,
  CreateTemplateVersionDto,
  UpdateTemplateDto,
  UpdateTemplateVersionDto,
} from "./schemas/admin-template.schema";

/**
 * P5-04 — Admin Template and Version Management Service.
 *
 * Enforces:
 * - Templates are data, not code (docs/PLAN/07).
 * - Version definitions must pass validateTemplateVersion from @wi/schema (docs/DATABASE/03).
 * - Published versions are immutable (BR-3.1).
 * - Deletion is refused if any invitation references the template.
 * - Cache invalidation on publish & deprecate.
 * - Every write produces an audit_logs row in the same transaction.
 */
@Injectable()
export class AdminTemplatesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auditLogs: AuditLogService,
    private readonly templateService: TemplateService,
  ) {}

  async listTemplates() {
    const templateRows = await this.db
      .select()
      .from(templates)
      .orderBy(desc(templates.createdAt));

    const versionRows = await this.db
      .select()
      .from(templateVersions)
      .orderBy(desc(templateVersions.createdAt));

    const versionIds = versionRows.map((v) => v.id);
    const countsByVersion = new Map<string, number>();
    if (versionIds.length > 0) {
      const usage = await this.db
        .select({
          versionId: invitations.templateVersionId,
          total: count(),
        })
        .from(invitations)
        .where(inArray(invitations.templateVersionId, versionIds))
        .groupBy(invitations.templateVersionId);
      for (const u of usage) {
        if (u.versionId) {
          countsByVersion.set(u.versionId, Number(u.total));
        }
      }
    }

    const versionsByTemplate = new Map<string, Array<(typeof versionRows)[0] & { invitation_count: number }>>();
    for (const v of versionRows) {
      const list = versionsByTemplate.get(v.templateId) ?? [];
      list.push({
        ...v,
        invitation_count: countsByVersion.get(v.id) ?? 0,
      });
      versionsByTemplate.set(v.templateId, list);
    }

    return templateRows.map((t) => ({
      ...t,
      versions: versionsByTemplate.get(t.id) ?? [],
    }));
  }

  async getTemplate(id: string) {
    const [template] = await this.db
      .select()
      .from(templates)
      .where(or(eq(templates.id, id), eq(templates.slug, id)))
      .limit(1);

    if (!template) {
      throw new NotFoundError(`Template "${id}" not found.`);
    }

    const versionRows = await this.db
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.templateId, template.id))
      .orderBy(desc(templateVersions.createdAt));

    const versionIds = versionRows.map((v) => v.id);
    const countsByVersion = new Map<string, number>();
    if (versionIds.length > 0) {
      const usage = await this.db
        .select({
          versionId: invitations.templateVersionId,
          total: count(),
        })
        .from(invitations)
        .where(inArray(invitations.templateVersionId, versionIds))
        .groupBy(invitations.templateVersionId);
      for (const u of usage) {
        if (u.versionId) {
          countsByVersion.set(u.versionId, Number(u.total));
        }
      }
    }

    const versions = versionRows.map((v) => ({
      ...v,
      invitation_count: countsByVersion.get(v.id) ?? 0,
    }));

    return {
      ...template,
      versions,
    };
  }

  async createTemplate(
    adminUser: { id: string },
    input: CreateTemplateDto,
  ) {
    const [existing] = await this.db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.slug, input.slug))
      .limit(1);

    if (existing) {
      throw new ConflictError(
        "SLUG_ALREADY_EXISTS",
        `Template slug "${input.slug}" is already in use.`,
      );
    }

    return await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(templates)
        .values({
          slug: input.slug,
          name: input.name,
          category: input.category,
          isPremium: input.is_premium,
          thumbnailUrl: input.thumbnail_url ?? null,
          status: "draft",
        })
        .returning();

      if (!created) {
        throw new Error("Failed to insert template.");
      }

      await this.auditLogs.record(tx, {
        adminId: adminUser.id,
        action: "template.create",
        resourceType: "template",
        resourceId: created.id,
        reason: input.reason,
        afterState: created as unknown as Record<string, unknown>,
      });

      return created;
    });
  }

  async updateTemplate(
    adminUser: { id: string },
    id: string,
    input: UpdateTemplateDto,
  ) {
    return await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(templates)
        .where(eq(templates.id, id))
        .limit(1);

      if (!before) {
        throw new NotFoundError(`Template "${id}" not found.`);
      }

      const patch: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) patch.name = input.name;
      if (input.category !== undefined) patch.category = input.category;
      if (input.is_premium !== undefined) patch.isPremium = input.is_premium;
      if (input.thumbnail_url !== undefined)
        patch.thumbnailUrl = input.thumbnail_url;
      if (input.status !== undefined) patch.status = input.status;

      const [updated] = await tx
        .update(templates)
        .set(patch)
        .where(eq(templates.id, id))
        .returning();

      if (!updated) {
        throw new Error("Failed to update template.");
      }

      await this.auditLogs.record(tx, {
        adminId: adminUser.id,
        action: "template.update",
        resourceType: "template",
        resourceId: id,
        reason: input.reason,
        beforeState: before as unknown as Record<string, unknown>,
        afterState: updated as unknown as Record<string, unknown>,
      });

      return updated;
    });
  }

  async deleteTemplate(
    adminUser: { id: string },
    id: string,
    reason: string,
  ) {
    const result = await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(templates)
        .where(eq(templates.id, id))
        .limit(1);

      if (!before) {
        throw new NotFoundError(`Template "${id}" not found.`);
      }

      // 1. Refuse if referenced directly by any invitation
      const [directUsage] = await tx
        .select({ count: count() })
        .from(invitations)
        .where(eq(invitations.templateId, id));

      const directCount = Number(directUsage?.count ?? 0);
      if (directCount > 0) {
        throw new ConflictError(
          "TEMPLATE_IN_USE",
          `Cannot delete template "${before.name}": it is referenced by ${directCount} existing invitation(s).`,
        );
      }

      // 2. Also check if any invitation references any version of this template
      const templateVersionRows = await tx
        .select({ id: templateVersions.id })
        .from(templateVersions)
        .where(eq(templateVersions.templateId, id));

      const versionIds = templateVersionRows.map((v) => v.id);
      if (versionIds.length > 0) {
        const [versionUsage] = await tx
          .select({ count: count() })
          .from(invitations)
          .where(inArray(invitations.templateVersionId, versionIds));

        const versionCount = Number(versionUsage?.count ?? 0);
        if (versionCount > 0) {
          throw new ConflictError(
            "TEMPLATE_IN_USE",
            `Cannot delete template "${before.name}": one of its versions is referenced by ${versionCount} existing invitation(s).`,
          );
        }

        // Delete versions first
        await tx
          .delete(templateVersions)
          .where(eq(templateVersions.templateId, id));
      }

      // Delete template
      await tx.delete(templates).where(eq(templates.id, id));

      await this.auditLogs.record(tx, {
        adminId: adminUser.id,
        action: "template.delete",
        resourceType: "template",
        resourceId: id,
        reason,
        beforeState: before as unknown as Record<string, unknown>,
      });

      return { deleted: true, id };
    });

    await this.templateService.invalidate();
    return result;
  }

  async createVersion(
    adminUser: { id: string },
    templateId: string,
    input: CreateTemplateVersionDto,
  ) {
    const [template] = await this.db
      .select({ id: templates.id, slug: templates.slug })
      .from(templates)
      .where(eq(templates.id, templateId))
      .limit(1);

    if (!template) {
      throw new NotFoundError(`Template "${templateId}" not found.`);
    }

    // Validate section, theme, and keys against @wi/schema
    const validation = validateTemplateVersion({
      sections: input.sections as any,
      theme: input.theme as any,
      customizable_theme_keys: input.customizable_theme_keys,
    });

    if (!validation.ok) {
      throw new ValidationError(
        validation.errors.map((e) => ({
          field: e.field,
          message: e.message,
        })),
        "Invalid template version definition.",
      );
    }

    const [existing] = await this.db
      .select({ id: templateVersions.id })
      .from(templateVersions)
      .where(
        and(
          eq(templateVersions.templateId, templateId),
          eq(templateVersions.version, input.version),
        ),
      )
      .limit(1);

    if (existing) {
      throw new ConflictError(
        "VERSION_ALREADY_EXISTS",
        `Version "${input.version}" already exists for template "${template.slug}".`,
      );
    }

    return await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(templateVersions)
        .values({
          templateId,
          version: input.version,
          sections: validation.value.sections,
          theme: validation.value.theme,
          customizableThemeKeys: [...validation.value.customizable_theme_keys],
          changelog: input.changelog ?? null,
          status: "draft",
        })
        .returning();

      if (!created) {
        throw new Error("Failed to create template version.");
      }

      await this.auditLogs.record(tx, {
        adminId: adminUser.id,
        action: "template_version.create",
        resourceType: "template_version",
        resourceId: created.id,
        reason: input.reason,
        afterState: created as unknown as Record<string, unknown>,
      });

      return created;
    });
  }

  async updateVersion(
    adminUser: { id: string },
    templateId: string,
    vid: string,
    input: UpdateTemplateVersionDto,
  ) {
    return await this.db.transaction(async (tx) => {
      const [versionRow] = await tx
        .select()
        .from(templateVersions)
        .where(
          and(
            eq(templateVersions.templateId, templateId),
            or(eq(templateVersions.id, vid), eq(templateVersions.version, vid)),
          ),
        )
        .limit(1);

      if (!versionRow) {
        throw new NotFoundError(
          `Version "${vid}" not found for template "${templateId}".`,
        );
      }

      // BR-3.1: Published & deprecated versions are immutable
      if (versionRow.status !== "draft") {
        throw new ConflictError(
          "VERSION_IMMUTABLE",
          `Version "${versionRow.version}" is in status "${versionRow.status}" and cannot be edited (BR-3.1). Published and deprecated versions are immutable. Publish a new version instead.`,
        );
      }

      const mergedSections =
        input.sections !== undefined ? input.sections : versionRow.sections;
      const mergedTheme =
        input.theme !== undefined ? input.theme : versionRow.theme;
      const mergedKeys =
        input.customizable_theme_keys !== undefined
          ? input.customizable_theme_keys
          : versionRow.customizableThemeKeys;

      const validation = validateTemplateVersion({
        sections: mergedSections as any,
        theme: mergedTheme as any,
        customizable_theme_keys: mergedKeys,
      });

      if (!validation.ok) {
        throw new ValidationError(
          validation.errors.map((e) => ({
            field: e.field,
            message: e.message,
          })),
          "Invalid template version definition.",
        );
      }

      const [updated] = await tx
        .update(templateVersions)
        .set({
          sections: validation.value.sections,
          theme: validation.value.theme,
          customizableThemeKeys: [...validation.value.customizable_theme_keys],
          ...(input.changelog !== undefined
            ? { changelog: input.changelog }
            : {}),
        })
        .where(eq(templateVersions.id, versionRow.id))
        .returning();

      if (!updated) {
        throw new Error("Failed to update template version.");
      }

      await this.auditLogs.record(tx, {
        adminId: adminUser.id,
        action: "template_version.update",
        resourceType: "template_version",
        resourceId: versionRow.id,
        reason: input.reason,
        beforeState: versionRow as unknown as Record<string, unknown>,
        afterState: updated as unknown as Record<string, unknown>,
      });

      return updated;
    });
  }

  async publishVersion(
    adminUser: { id: string },
    templateId: string,
    vid: string,
    reason: string,
  ) {
    const updated = await this.db.transaction(async (tx) => {
      const [versionRow] = await tx
        .select()
        .from(templateVersions)
        .where(
          and(
            eq(templateVersions.templateId, templateId),
            or(eq(templateVersions.id, vid), eq(templateVersions.version, vid)),
          ),
        )
        .limit(1);

      if (!versionRow) {
        throw new NotFoundError(
          `Version "${vid}" not found for template "${templateId}".`,
        );
      }

      const [published] = await tx
        .update(templateVersions)
        .set({
          status: "published",
          releasedAt: new Date(),
        })
        .where(eq(templateVersions.id, versionRow.id))
        .returning();

      if (!published) {
        throw new Error("Failed to publish version.");
      }

      // Ensure parent template is published so it can appear in catalog
      await tx
        .update(templates)
        .set({
          status: "published",
          updatedAt: new Date(),
        })
        .where(
          and(eq(templates.id, templateId), eq(templates.status, "draft")),
        );

      await this.auditLogs.record(tx, {
        adminId: adminUser.id,
        action: "template_version.publish",
        resourceType: "template_version",
        resourceId: versionRow.id,
        reason,
        beforeState: versionRow as unknown as Record<string, unknown>,
        afterState: published as unknown as Record<string, unknown>,
      });

      return published;
    });

    // Invalidate catalog cache so newly published version is immediately visible
    await this.templateService.invalidate();
    return updated;
  }

  async deprecateVersion(
    adminUser: { id: string },
    templateId: string,
    vid: string,
    reason: string,
  ) {
    const updated = await this.db.transaction(async (tx) => {
      const [versionRow] = await tx
        .select()
        .from(templateVersions)
        .where(
          and(
            eq(templateVersions.templateId, templateId),
            or(eq(templateVersions.id, vid), eq(templateVersions.version, vid)),
          ),
        )
        .limit(1);

      if (!versionRow) {
        throw new NotFoundError(
          `Version "${vid}" not found for template "${templateId}".`,
        );
      }

      const [deprecated] = await tx
        .update(templateVersions)
        .set({
          status: "deprecated",
        })
        .where(eq(templateVersions.id, versionRow.id))
        .returning();

      if (!deprecated) {
        throw new Error("Failed to deprecate version.");
      }

      await this.auditLogs.record(tx, {
        adminId: adminUser.id,
        action: "template_version.deprecate",
        resourceType: "template_version",
        resourceId: versionRow.id,
        reason,
        beforeState: versionRow as unknown as Record<string, unknown>,
        afterState: deprecated as unknown as Record<string, unknown>,
      });

      return deprecated;
    });

    // Invalidate catalog cache so deprecated version disappears from public catalog
    await this.templateService.invalidate();
    return updated;
  }
}
