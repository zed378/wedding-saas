import { Controller, Get, Param, UseGuards } from "@nestjs/common";

import { ok } from "../../http/envelope";
import {
  CurrentUserParam,
  requireAuth,
  type CurrentUser,
} from "../../shared/auth-middleware";
import { tenantScope } from "../../shared/tenancy/tenant-scope";
import { AnalyticsService } from "./analytics.service";

/**
 * `P4-10` — `GET /api/v1/invitations/:id/analytics`.
 *
 * Owner analytics summary: total and daily page opens, RSVP response breakdown,
 * and guestbook message counts.
 * Ownership-scoped; non-owners get 404 (zero tolerance IDOR).
 */
@Controller("api/v1/invitations/:id/analytics")
@UseGuards(requireAuth())
export class OwnerAnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get("")
  async getAnalytics(
    @Param("id") invitationId: string,
    @CurrentUserParam() user: CurrentUser,
  ): Promise<unknown> {
    const scope = tenantScope(user.id);
    const summary = await this.service.getAnalyticsSummary(scope, invitationId);
    return ok(summary);
  }
}
