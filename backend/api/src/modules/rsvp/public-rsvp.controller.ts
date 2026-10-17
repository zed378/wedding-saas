import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import { rateLimit } from "../../shared/rate-limit/rate-limit.guard";
import { RsvpService, type SubmitRsvpDto } from "./rsvp.service";

const submitRsvpSchema = z
  .object({
    guest_name: z
      .string()
      .trim()
      .min(1, "Nama tamu wajib diisi")
      .max(150, "Nama tamu maksimal 150 karakter"),
    attendance_status: z.enum(["attending", "not_attending", "maybe"]),
    guest_count: z.number().int().min(1).max(10).optional(),
    message: z.string().trim().max(1000, "Pesan maksimal 1000 karakter").nullable().optional(),
    captcha_token: z.string().trim().max(2048).optional(),
  })
  .strict();

/**
 * `P4-01` — `POST /public/i/:slug/rsvp`
 * Public RSVP attendance submission.
 */
@Controller("public/i")
@UseGuards(rateLimit("rsvp"))
export class PublicRsvpController {
  constructor(private readonly service: RsvpService) {}

  @Post(":slug/rsvp")
  @HttpCode(201)
  async submit(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const parsed = submitRsvpSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      );
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const result = await this.service.submitRsvp(slug, parsed.data as SubmitRsvpDto, ip);
    return ok(result);
  }
}
