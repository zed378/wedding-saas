import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import { currentUser } from "../../shared/auth-middleware/current-user";
import { requireAuth, requireRole } from "../../shared/auth-middleware/guards";
import { AdminTemplatesService } from "./admin-templates.service";
import {
  createTemplateSchema,
  createTemplateVersionSchema,
  deleteTemplateSchema,
  templateVersionActionSchema,
  updateTemplateSchema,
  updateTemplateVersionSchema,
} from "./schemas/admin-template.schema";
import type { z } from "zod";

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  throw new ValidationError(
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    })),
  );
}

/**
 * P5-04: Administrative Template and Version Management Controller.
 *
 * docs/API/03-TEMPLATE-API.md § Admin
 * docs/API/09-ADMIN-API.md § Principles
 */
@Controller("api/v1/admin/templates")
@UseGuards(requireAuth(), requireRole("admin", "super_admin"))
export class AdminTemplatesController {
  constructor(private readonly templates: AdminTemplatesService) {}

  @Get()
  @HttpCode(200)
  async list() {
    const items = await this.templates.listTemplates();
    return ok(items);
  }

  @Get(":id")
  @HttpCode(200)
  async get(@Param("id") id: string) {
    const template = await this.templates.getTemplate(id);
    return ok(template);
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @Req() req: Request) {
    const parsed = parse(createTemplateSchema, body);
    const admin = currentUser(req);
    const created = await this.templates.createTemplate(admin, parsed);
    return ok(created);
  }

  @Patch(":id")
  @HttpCode(200)
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const parsed = parse(updateTemplateSchema, body);
    const admin = currentUser(req);
    const updated = await this.templates.updateTemplate(admin, id, parsed);
    return ok(updated);
  }

  @Delete(":id")
  @HttpCode(200)
  async delete(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const parsed = parse(deleteTemplateSchema, body);
    const admin = currentUser(req);
    const result = await this.templates.deleteTemplate(admin, id, parsed.reason);
    return ok(result);
  }

  @Post(":id/versions")
  @HttpCode(201)
  async createVersion(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const parsed = parse(createTemplateVersionSchema, body);
    const admin = currentUser(req);
    const created = await this.templates.createVersion(admin, id, parsed);
    return ok(created);
  }

  @Patch(":id/versions/:vid")
  @HttpCode(200)
  async updateVersion(
    @Param("id") id: string,
    @Param("vid") vid: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const parsed = parse(updateTemplateVersionSchema, body);
    const admin = currentUser(req);
    const updated = await this.templates.updateVersion(
      admin,
      id,
      vid,
      parsed,
    );
    return ok(updated);
  }

  @Post(":id/versions/:vid/publish")
  @HttpCode(200)
  async publishVersion(
    @Param("id") id: string,
    @Param("vid") vid: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const parsed = parse(templateVersionActionSchema, body);
    const admin = currentUser(req);
    const published = await this.templates.publishVersion(
      admin,
      id,
      vid,
      parsed.reason,
    );
    return ok(published);
  }

  @Post(":id/versions/:vid/deprecate")
  @HttpCode(200)
  async deprecateVersion(
    @Param("id") id: string,
    @Param("vid") vid: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const parsed = parse(templateVersionActionSchema, body);
    const admin = currentUser(req);
    const deprecated = await this.templates.deprecateVersion(
      admin,
      id,
      vid,
      parsed.reason,
    );
    return ok(deprecated);
  }
}
