import {
  Body,
  Controller,
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
import { AdminUsersService } from "./admin-users.service";
import {
  adminUserActionReasonSchema,
  adminUserQuerySchema,
} from "./schemas/admin-user.schema";

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
 * P5-06: Administrative User Management Controller.
 * docs/API/09-ADMIN-API.md § User Management
 */
@Controller("api/v1/admin/users")
@UseGuards(requireAuth(), requireRole("admin", "super_admin"))
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @HttpCode(200)
  async list(@Query() rawQuery: unknown) {
    const query = parse(adminUserQuerySchema, rawQuery);
    const result = await this.users.listUsers(query);
    return ok(result.data, result.meta);
  }

  @Get(":id")
  @HttpCode(200)
  async get(@Param("id") id: string) {
    const user = await this.users.getUser(id);
    return ok(user);
  }

  @Patch(":id/suspend")
  @HttpCode(200)
  async suspend(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const { reason } = parse(adminUserActionReasonSchema, body);
    const admin = currentUser(req);
    const updated = await this.users.suspendUser(admin, id, reason);
    return ok(updated);
  }

  @Patch(":id/unsuspend")
  @HttpCode(200)
  async unsuspend(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const { reason } = parse(adminUserActionReasonSchema, body);
    const admin = currentUser(req);
    const updated = await this.users.unsuspendUser(admin, id, reason);
    return ok(updated);
  }
}
