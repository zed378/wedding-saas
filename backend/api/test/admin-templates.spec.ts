import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import { AdminTemplatesController } from "../src/modules/admin/admin-templates.controller";
import { AdminTemplatesService } from "../src/modules/admin/admin-templates.service";
import { SessionService } from "../src/modules/auth/session.service";
import { DB } from "../src/infra/db/client";
import { templates, templateVersions } from "../src/infra/db/schema/templates";
import { AuditLogService } from "../src/shared/audit/audit-log.service";
import { TemplateService } from "../src/modules/template/template.service";
import {
  ConflictError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../src/http/errors";

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

describe("Admin Template and Version Management API (P5-04)", () => {
  let app: INestApplication;

  const mockUsers = {
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "user@example.test",
      fullName: "Regular User",
      role: "user",
      status: "active",
      emailVerified: true,
    },
    admin: {
      id: "22222222-2222-4222-8222-222222222222",
      email: "admin@vizunicum.test",
      fullName: "Platform Admin",
      role: "admin",
      status: "active",
      emailVerified: true,
    },
  };

  const mockTemplates = [
    {
      id: "tpl-1111-1111-1111-1111",
      slug: "floral-classic",
      name: "Floral Classic",
      category: ["floral", "classic"],
      isPremium: false,
      thumbnailUrl: "https://example.com/thumb.jpg",
      status: "published",
      createdAt: new Date(),
      updatedAt: new Date(),
      versions: [
        {
          id: "ver-1111-1111-1111-1111",
          templateId: "tpl-1111-1111-1111-1111",
          version: "1.0.0",
          sections: VALID_SECTIONS,
          theme: VALID_THEME,
          customizableThemeKeys: ["colors.primary"],
          changelog: "Initial version",
          status: "published",
          releasedAt: new Date(),
          createdAt: new Date(),
        },
      ],
    },
  ];

  const mockAdminTemplatesService = {
    listTemplates: vi.fn().mockResolvedValue(mockTemplates),
    getTemplate: vi.fn().mockImplementation(async (id: string) => {
      if (id === mockTemplates[0]!.id || id === mockTemplates[0]!.slug) {
        return mockTemplates[0];
      }
      throw new NotFoundError(`Template "${id}" not found.`);
    }),
    createTemplate: vi.fn().mockImplementation(async (_admin, input) => {
      if (input.slug === "floral-classic") {
        throw new ConflictError(
          "SLUG_ALREADY_EXISTS",
          `Template slug "${input.slug}" is already in use.`,
        );
      }
      return {
        id: "tpl-new-uuid",
        slug: input.slug,
        name: input.name,
        category: input.category ?? [],
        isPremium: input.is_premium ?? false,
        thumbnailUrl: input.thumbnail_url ?? null,
        status: "draft",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }),
    updateTemplate: vi.fn().mockImplementation(async (_admin, id, input) => {
      if (id !== mockTemplates[0]!.id) {
        throw new NotFoundError(`Template "${id}" not found.`);
      }
      return {
        ...mockTemplates[0],
        ...input,
        updatedAt: new Date(),
      };
    }),
    deleteTemplate: vi.fn().mockImplementation(async (_admin, id, _reason) => {
      if (id === "tpl-in-use") {
        throw new ConflictError(
          "TEMPLATE_IN_USE",
          "Cannot delete template: it is referenced by existing invitations.",
        );
      }
      if (id !== mockTemplates[0]!.id) {
        throw new NotFoundError(`Template "${id}" not found.`);
      }
      return { deleted: true, id };
    }),
    createVersion: vi.fn().mockImplementation(async (_admin, id, input) => {
      if (id !== mockTemplates[0]!.id) {
        throw new NotFoundError(`Template "${id}" not found.`);
      }
      if (input.version === "1.0.0") {
        throw new ConflictError(
          "VERSION_ALREADY_EXISTS",
          `Version "${input.version}" already exists.`,
        );
      }
      // Section check
      const hasUnknownComponent = (input.sections as any[])?.some(
        (s) => s.component === "InvalidComponent",
      );
      if (hasUnknownComponent) {
        throw new ValidationError(
          [
            {
              field: "sections[0].component",
              message: "unknown component: InvalidComponent",
            },
          ],
          "Invalid template version definition.",
        );
      }
      return {
        id: "ver-new-uuid",
        templateId: id,
        version: input.version,
        sections: input.sections,
        theme: input.theme,
        customizableThemeKeys: input.customizable_theme_keys ?? [],
        changelog: input.changelog ?? null,
        status: "draft",
        createdAt: new Date(),
      };
    }),
    updateVersion: vi
      .fn()
      .mockImplementation(async (_admin, templateId, vid, _input) => {
        if (vid === "ver-published") {
          throw new ConflictError(
            "VERSION_IMMUTABLE",
            "Published or deprecated versions are immutable (BR-3.1). Publish a new version instead.",
          );
        }
        return {
          id: vid,
          templateId,
          version: "1.1.0",
          status: "draft",
          updatedAt: new Date(),
        };
      }),
    publishVersion: vi
      .fn()
      .mockImplementation(async (_admin, templateId, vid, _reason) => {
        return {
          id: vid,
          templateId,
          status: "published",
          releasedAt: new Date(),
        };
      }),
    deprecateVersion: vi
      .fn()
      .mockImplementation(async (_admin, templateId, vid, _reason) => {
        return {
          id: vid,
          templateId,
          status: "deprecated",
        };
      }),
  };

  const mockSessions = {
    authenticate: vi.fn().mockImplementation(async (token?: string) => {
      if (!token || !token.startsWith("Bearer ")) {
        throw new UnauthenticatedError();
      }
      const raw = token.slice(7);
      if (raw === "admin-token") return mockUsers.admin;
      if (raw === "user-token") return mockUsers.user;
      throw new UnauthenticatedError();
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminTemplatesController],
      providers: [
        { provide: APP_FILTER, useClass: AppExceptionFilter },
        { provide: SessionService, useValue: mockSessions },
        {
          provide: AdminTemplatesService,
          useValue: mockAdminTemplatesService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Authentication and Role Guards", () => {
    it("returns 401 Unauthenticated when token is missing", async () => {
      const res = await request(app.getHttpServer()).get(
        "/api/v1/admin/templates",
      );
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 403 Forbidden when accessed by a regular user", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/templates")
        .set("Authorization", "Bearer user-token");
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("Template CRUD Operations", () => {
    it("allows admin to list all templates", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/templates")
        .set("Authorization", "Bearer admin-token");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].slug).toBe("floral-classic");
    });

    it("creates a new draft template with mandatory reason", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/admin/templates")
        .set("Authorization", "Bearer admin-token")
        .send({
          slug: "modern-minimal",
          name: "Modern Minimal",
          category: ["modern", "minimal"],
          is_premium: true,
          thumbnail_url: "https://example.com/thumb.jpg",
          reason: "Adding new spring collection template",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slug).toBe("modern-minimal");
      expect(res.body.data.status).toBe("draft");
    });

    it("rejects template creation without a reason (BR-Admin.3)", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/admin/templates")
        .set("Authorization", "Bearer admin-token")
        .send({
          slug: "modern-minimal-2",
          name: "Modern Minimal 2",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("updates template metadata with valid reason", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/templates/${mockTemplates[0]!.id}`)
        .set("Authorization", "Bearer admin-token")
        .send({
          name: "Floral Classic Updated",
          reason: "Corrected naming typo per design review",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Floral Classic Updated");
    });

    it("deletes an unused template", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/admin/templates/${mockTemplates[0]!.id}`)
        .set("Authorization", "Bearer admin-token")
        .send({
          reason: "Decommissioning test template",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deleted).toBe(true);
    });

    it("refuses to delete a template in use by invitations (409 Conflict)", async () => {
      const res = await request(app.getHttpServer())
        .delete("/api/v1/admin/templates/tpl-in-use")
        .set("Authorization", "Bearer admin-token")
        .send({
          reason: "Attempting to delete active template",
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("TEMPLATE_IN_USE");
    });
  });

  describe("Version Lifecycle and Immutability (BR-3.1, BR-3.3)", () => {
    it("rejects version creation with invalid section definition", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/templates/${mockTemplates[0]!.id}/versions`)
        .set("Authorization", "Bearer admin-token")
        .send({
          version: "1.1.0",
          sections: [
            {
              section_key: "hero",
              component: "InvalidComponent",
            },
          ],
          theme: VALID_THEME,
          reason: "Creating version with unknown component",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details[0].field).toBe("sections[0].component");
    });

    it("creates a draft version when definition is valid", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/templates/${mockTemplates[0]!.id}/versions`)
        .set("Authorization", "Bearer admin-token")
        .send({
          version: "1.1.0",
          sections: VALID_SECTIONS,
          theme: VALID_THEME,
          customizable_theme_keys: ["colors.primary"],
          changelog: "Updated grid columns",
          reason: "Releasing improved gallery layout",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.version).toBe("1.1.0");
      expect(res.body.data.status).toBe("draft");
    });

    it("publishes a draft version", async () => {
      const res = await request(app.getHttpServer())
        .post(
          `/api/v1/admin/templates/${mockTemplates[0]!.id}/versions/ver-1/publish`,
        )
        .set("Authorization", "Bearer admin-token")
        .send({
          reason: "Publishing verified version to catalog",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("published");
    });

    it("refuses to update an already published version (BR-3.1 immutability)", async () => {
      const res = await request(app.getHttpServer())
        .patch(
          `/api/v1/admin/templates/${mockTemplates[0]!.id}/versions/ver-published`,
        )
        .set("Authorization", "Bearer admin-token")
        .send({
          changelog: "Attempting edit on immutable version",
          reason: "Trying to fix typo directly in published version",
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("VERSION_IMMUTABLE");
    });

    it("deprecates an active version", async () => {
      const res = await request(app.getHttpServer())
        .post(
          `/api/v1/admin/templates/${mockTemplates[0]!.id}/versions/ver-1/deprecate`,
        )
        .set("Authorization", "Bearer admin-token")
        .send({
          reason: "Deprecating version in favor of v2.0.0",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("deprecated");
    });
  });

  describe("AdminTemplatesService Integration with validateTemplateVersion", () => {
    it("service enforces validateTemplateVersion on createVersion", async () => {
      const mockTx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                id: "v-real",
                version: "2.0.0",
                status: "draft",
              },
            ]),
          }),
        }),
      };

      const mockDbInstance = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => {
                // If querying templates table, return the template row
                if (table === templates) {
                  return [{ id: "tpl-1", slug: "tpl-1" }];
                }
                // If querying templateVersions for existing version, return empty
                return [];
              }),
            })),
          })),
        })),
        transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };

      const mockAudit = { record: vi.fn().mockResolvedValue(undefined) };
      const mockTplService = { invalidate: vi.fn().mockResolvedValue(1) };

      const service = new AdminTemplatesService(
        mockDbInstance as any,
        mockAudit as any,
        mockTplService as any,
      );

      // 1. Invalid payload rejected by real @wi/schema validateTemplateVersion
      await expect(
        service.createVersion(
          { id: "admin-1" },
          "tpl-1",
          {
            version: "2.0.0",
            sections: [
              {
                section_key: "hero",
                component: "NonExistentComponent",
              },
            ],
            theme: VALID_THEME,
            customizable_theme_keys: [],
            reason: "Valid reason for invalid component",
          },
        ),
      ).rejects.toThrow(ValidationError);

      // 2. Valid payload accepted and saved
      const created = await service.createVersion(
        { id: "admin-1" },
        "tpl-1",
        {
          version: "2.0.0",
          sections: VALID_SECTIONS,
          theme: VALID_THEME,
          customizable_theme_keys: ["colors.primary"],
          reason: "Valid version 2.0.0",
        },
      );

      expect(created?.version).toBe("2.0.0");
      expect(mockAudit.record).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          action: "template_version.create",
          resourceType: "template_version",
          reason: "Valid version 2.0.0",
        }),
      );
    });
  });
});
