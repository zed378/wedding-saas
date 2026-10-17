import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import { pageMeta, parsePagination } from "../../http/pagination";
import { rateLimit } from "../../shared/rate-limit/rate-limit.guard";
import { GuestbookService, type SubmitGuestbookDto } from "./guestbook.service";

const submitGuestbookSchema = z
  .object({
    guest_name: z
      .string()
      .trim()
      .min(1, "Nama tamu wajib diisi")
      .max(150, "Nama tamu maksimal 150 karakter"),
    message: z
      .string()
      .trim()
      .min(1, "Pesan wajib diisi")
      .max(1000, "Pesan maksimal 1000 karakter"),
  })
  .strict();

const listGuestbookQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    per_page: z.coerce.number().int().positive().max(100).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .strict();

function parseListQuery(query: Record<string, unknown>) {
  const result = listGuestbookQuerySchema.safeParse(query);
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
 * `P4-03` — Public Guestbook Submission and Listing.
 * Mounted under `/public/i`.
 */
@Controller("public/i")
export class PublicGuestbookController {
  constructor(private readonly service: GuestbookService) {}

  /**
   * Submit a guestbook entry on a published invitation.
   * Rate limited at 10/hr per IP hash and slug.
   */
  @Post(":slug/guestbook")
  @HttpCode(201)
  @UseGuards(rateLimit("guestbook"))
  async submit(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const parsed = submitGuestbookSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      );
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const result = await this.service.submitEntry(
      slug,
      parsed.data as SubmitGuestbookDto,
      ip,
    );
    return ok(result);
  }

  /**
   * List approved guestbook entries for a published invitation.
   */
  @Get(":slug/guestbook")
  @UseGuards(rateLimit("general-public"))
  async list(
    @Param("slug") slug: string,
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

    const { items, total } = await this.service.listApprovedEntries(slug, {
      page: pagination.page,
      limit: pagination.limit,
    });

    return ok(items, pageMeta(pagination, total));
  }
}
