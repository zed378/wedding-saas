import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import { pageMeta, parsePagination } from "../../http/pagination";
import {
  CurrentUserParam,
  requireAuth,
  type CurrentUser,
} from "../../shared/auth-middleware";
import {
  GuestbookService,
  type GuestbookEntryStatus,
} from "./guestbook.service";

const listOwnerGuestbookQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    per_page: z.coerce.number().int().positive().max(100).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    status: z.enum(["pending", "approved", "rejected"]).optional(),
  })
  .strict();

function parseListQuery(query: Record<string, unknown>) {
  const result = listOwnerGuestbookQuerySchema.safeParse(query);
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

const patchModerationSchema = z
  .object({
    status: z.enum(["approved", "rejected"]),
  })
  .strict();

function parsePatchBody(body: unknown) {
  const result = patchModerationSchema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((i) => ({
        field: i.path.join(".") || "body",
        message: i.message,
      })),
    );
  }
  return result.data;
}

/**
 * `P4-04` — Owner Guestbook Moderation.
 * Mounted at `/api/v1/invitations/:id/guestbook`.
 * All endpoints require JWT authentication and object-level authorization (`owner_id = user.id`).
 */
@Controller("api/v1/invitations/:id/guestbook")
@UseGuards(requireAuth())
export class OwnerGuestbookController {
  constructor(private readonly service: GuestbookService) {}

  /**
   * List guestbook entries with pagination and optional status filter.
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

    const { items, total } = await this.service.findForOwner(
      user.scope,
      invitationId,
      {
        page: pagination.page,
        limit: pagination.limit,
        ...(parsed.status !== undefined
          ? { status: parsed.status as GuestbookEntryStatus }
          : {}),
      },
    );

    return ok(items, pageMeta(pagination, total));
  }

  /**
   * Moderate a guestbook entry: approve or reject.
   * Records moderator user ID and timestamp, and invalidates public cache.
   */
  @Patch(":entry_id")
  async moderate(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") invitationId: string,
    @Param("entry_id") entryId: string,
    @Body() body: unknown,
  ) {
    const parsed = parsePatchBody(body);
    const updated = await this.service.moderateEntry(
      user.scope,
      invitationId,
      entryId,
      parsed.status as GuestbookEntryStatus,
      user.id,
    );

    return ok(updated);
  }

  /**
   * Delete a guestbook entry.
   * Enforces ownership and invalidates public cache if the entry was approved.
   */
  @Delete(":entry_id")
  async delete(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") invitationId: string,
    @Param("entry_id") entryId: string,
  ) {
    const result = await this.service.deleteEntry(
      user.scope,
      invitationId,
      entryId,
    );

    return ok(result);
  }
}
