import { Body, Controller, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import { rateLimit } from "../../shared/rate-limit/rate-limit.guard";
import { AnalyticsService } from "./analytics.service";

const viewSchema = z.object({}).strict().optional();

/**
 * `P4-09` — `POST /public/i/:slug/view`.
 *
 * Increments the page-view counter via Redis write-behind.
 * Fire-and-forget from the client; never blocks rendering and fails open.
 * Rate-limited under `general-public`.
 */
@Controller("public/i")
@UseGuards(rateLimit("general-public"))
export class PublicViewController {
  constructor(private readonly service: AnalyticsService) {}

  @Post(":slug/view")
  @HttpCode(200)
  async recordView(
    @Param("slug") slug: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    if (body !== undefined && body !== null && typeof body === "object") {
      const parsed = viewSchema.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError([
          { field: "body", message: "Unexpected fields in request body" },
        ]);
      }
    }

    const result = await this.service.recordView(slug);
    return ok(result);
  }
}
