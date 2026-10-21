import { Controller, Get, HttpCode, Query, UseGuards } from "@nestjs/common";
import type { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import { requireAuth, requireRole } from "../../shared/auth-middleware/guards";
import { rateLimit } from "../../shared/rate-limit";
import { AdminDashboardService } from "./admin-dashboard.service";
import { adminDashboardQuerySchema } from "./schemas/admin-dashboard.schema";

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
 * P5-11: Dashboard Metrics Controller.
 *
 * GET /api/v1/admin/dashboard/summary — aggregated operational KPIs.
 * Read-only; no write endpoints exist.
 *
 * docs/API/09-ADMIN-API.md § Dashboard
 */
@Controller("api/v1/admin/dashboard")
@UseGuards(
  requireAuth(),
  requireRole("admin", "super_admin"),
  rateLimit("general-authenticated"),
)
export class AdminDashboardController {
  constructor(private readonly service: AdminDashboardService) {}

  @Get("summary")
  @HttpCode(200)
  async getDashboardSummary(@Query() query: unknown) {
    const parsed = parse(adminDashboardQuerySchema, query);
    const result = await this.service.getDashboardMetrics(parsed);
    return ok(result);
  }
}

