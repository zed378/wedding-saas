import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Query, UseGuards, Req } from "@nestjs/common";
import type { Request } from "express";
import type { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import { currentUser } from "../../shared/auth-middleware/current-user";
import { requireAuth, requireRole } from "../../shared/auth-middleware/guards";
import { rateLimit } from "../../shared/rate-limit";
import { AdminInvitationsService } from "./admin-invitations.service";
import {
  adminInvitationDetailSchema,
  adminInvitationQuerySchema,
} from "./schemas/admin-invitation.schema";

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
 * P5-10: Administrative Invitation Overview Controller.
 *
 * GET /api/v1/admin/invitations — operational index, no invitation content.
 * GET /api/v1/admin/invitations/:id — audited detail read with tenancy bypass.
 *
 * docs/API/09-ADMIN-API.md § Invitation Overview
 */
@Controller("api/v1/admin/invitations")
@UseGuards(
  requireAuth(),
  requireRole("admin", "super_admin"),
  rateLimit("general-authenticated"),
)
export class AdminInvitationsController {
  constructor(private readonly service: AdminInvitationsService) {}

  @Get()
  @HttpCode(200)
  async listAdminInvitations(@Query() query: unknown) {
    const parsed = parse(adminInvitationQuerySchema, query);
    const result = await this.service.listInvitations(parsed);
    return ok(result.data, result.meta);
  }

  @Get(":id")
  @HttpCode(200)
  async getAdminInvitationById(@Param("id") id: string, @Req() req: Request) {
    const admin = currentUser(req);
    const { reason } = parse(adminInvitationDetailSchema, req.query);
    const invitation = await this.service.getInvitationById(
      admin.id,
      reason ?? "Admin read via overview page",
      id,
    );
    return ok(invitation);
  }
}
