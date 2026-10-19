import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import type { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import { currentUser } from "../../shared/auth-middleware/current-user";
import { requireAuth, requireRole } from "../../shared/auth-middleware/guards";
import { AdminModerationService } from "./admin-moderation.service";
import {
  adminDeleteActionSchema,
  adminModerateActionSchema,
  adminModerationQuerySchema,
} from "./schemas/admin-moderation.schema";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  throw new ValidationError(
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    })),
  );
}

/**
 * P5-09: Administrative Platform Moderation Queue Controller.
 * docs/API/09-ADMIN-API.md § Moderation
 */
@Controller("api/v1/admin/moderation/guestbook")
@UseGuards(requireAuth(), requireRole("admin", "super_admin"))
export class AdminModerationController {
  constructor(private readonly moderation: AdminModerationService) {}

  @Get()
  @HttpCode(200)
  async list(@Query() rawQuery: unknown) {
    const query = parse(adminModerationQuerySchema, rawQuery);
    const result = await this.moderation.listGuestbook(query);
    return ok(result.data, result.meta);
  }

  @Patch(":id")
  @HttpCode(200)
  async moderate(
    @Param("id") id: string,
    @Body() rawBody: unknown,
    @Req() req: Request,
  ) {
    const admin = currentUser(req);
    const body = parse(adminModerateActionSchema, rawBody);
    const result = await this.moderation.moderateGuestbook(admin, id, body);
    return ok(result);
  }

  @Delete(":id")
  @HttpCode(200)
  async delete(
    @Param("id") id: string,
    @Body() rawBody: unknown,
    @Req() req: Request,
  ) {
    const admin = currentUser(req);
    const body = parse(adminDeleteActionSchema, rawBody ?? {});
    const result = await this.moderation.deleteGuestbook(admin, id, body);
    return ok(result);
  }
}
