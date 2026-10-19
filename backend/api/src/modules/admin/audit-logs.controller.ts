import {
  Controller,
  Get,
  HttpCode,
  Query,
  UseGuards,
} from "@nestjs/common";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import { requireAuth, requireRole } from "../../shared/auth-middleware/guards";
import { AdminAuditLogService } from "./audit-logs.service";
import {
  auditLogQuerySchema,
  type AuditLogQueryDto,
} from "./schemas/admin-action.schema";

@Controller("api/v1/admin/audit-logs")
@UseGuards(requireAuth(), requireRole("admin", "super_admin"))
export class AdminAuditLogsController {
  constructor(private readonly auditLogsService: AdminAuditLogService) {}

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
