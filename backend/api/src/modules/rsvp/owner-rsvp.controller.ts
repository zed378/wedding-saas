import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import { pageMeta, parsePagination } from "../../http/pagination";
import {
  CurrentUserParam,
  requireAuth,
  type CurrentUser,
} from "../../shared/auth-middleware";
import { rateLimit } from "../../shared/rate-limit";
import { RsvpService } from "./rsvp.service";

const listRsvpsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    per_page: z.coerce.number().int().positive().max(100).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    status: z.enum(["attending", "not_attending", "maybe"]).optional(),
    attendance_status: z.enum(["attending", "not_attending", "maybe"]).optional(),
  })
  .strict();

function parseListQuery(query: Record<string, unknown>) {
  const result = listRsvpsQuerySchema.safeParse(query);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((i) => ({
        field: i.path.join(".") || "query",
        message: i.message,
      })),
    );
  }
  return result.data;
}

/**
 * `P4-02` — Owner RSVP management and CSV export.
 * Mounted at `/api/v1/invitations/:id/rsvps`.
 * All endpoints require authentication and object-level authorization (owner_id = user.id).
 */
@Controller("api/v1/invitations/:id/rsvps")
@UseGuards(requireAuth())
export class OwnerRsvpController {
  constructor(private readonly service: RsvpService) {}

  /**
   * List RSVPs with pagination and optional attendance_status filter.
   */
  @Get("")
  async list(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") invitationId: string,
    @Query() query: Record<string, unknown>,
  ) {
    const parsed = parseListQuery(query);
    const pagination = parsePagination({
      ...(parsed.page !== undefined ? { page: parsed.page } : {}),
      ...(parsed.per_page !== undefined
        ? { per_page: parsed.per_page }
        : parsed.limit !== undefined
          ? { per_page: parsed.limit }
          : {}),
    });

    const status = parsed.status ?? parsed.attendance_status;

    const { items, total } = await this.service.getRsvpsForOwner(
      user.scope,
      invitationId,
      {
        page: pagination.page,
        limit: pagination.limit,
        ...(status !== undefined ? { status } : {}),
      },
    );

    return ok(items, pageMeta(pagination, total));
  }

  /**
   * Aggregated RSVP summary calculated directly in SQL.
   */
  @Get("summary")
  async summary(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") invitationId: string,
  ) {
    const summary = await this.service.getRsvpSummaryForOwner(
      user.scope,
      invitationId,
    );
    return ok(summary);
  }

  /**
   * CSV export with spreadsheet formula injection protection.
   * Rate limited under the 'export' policy (30/hr per user).
   */
  @Get("export")
  @UseGuards(rateLimit("export"))
  async exportCsv(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") invitationId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, csv } = await this.service.exportRsvpsCsv(
      user.scope,
      invitationId,
    );

    res
      .status(200)
      .set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(csv);
  }

  /**
   * Delete an RSVP entry.
   */
  @Delete(":rsvp_id")
  async delete(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") invitationId: string,
    @Param("rsvp_id") rsvpId: string,
  ) {
    await this.service.deleteRsvpForOwner(user.scope, invitationId, rsvpId);
    return ok({ deleted: true });
  }
}
