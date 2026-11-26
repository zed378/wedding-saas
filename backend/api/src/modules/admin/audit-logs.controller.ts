import {
  Controller,
  Get,
  HttpCode,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import { requireAuth, requireRole } from "../../shared/auth-middleware/guards";
import { currentUser } from "../../shared/auth-middleware/current-user";
import { rateLimit } from "../../shared/rate-limit";
import { AdminAuditLogService } from "./audit-logs.service";
import { auditLogQuerySchema } from "./schemas/admin-action.schema";

@Controller("api/v1/admin/audit-logs")
@UseGuards(
  requireAuth(),
  requireRole("admin", "super_admin"),
  rateLimit("general-authenticated"),
)
export class AdminAuditLogsController {
  constructor(private readonly auditLogsService: AdminAuditLogService) {}

  @Get("export")
  @HttpCode(200)
  async exportAuditLogs(@Query() query: unknown, @Req() req: Request) {
    const parsed = auditLogQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "query",
          message: issue.message,
        })),
      );
    }
    return ok(
      await this.auditLogsService.export(currentUser(req).id, parsed.data),
    );
  }

  @Get()
  @HttpCode(200)
  async listAuditLogs(@Query() query: unknown) {
    const parsed = auditLogQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => ({
          field: i.path.join(".") || "query",
          message: i.message,
        })),
      );
    }

    const result = await this.auditLogsService.list(parsed.data);
    return ok(result);
  }
}
