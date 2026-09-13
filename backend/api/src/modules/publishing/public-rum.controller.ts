import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { ValidationError } from "../../http/errors";
import { logger } from "../../shared/logging/logger";
import { rateLimit } from "../../shared/rate-limit/rate-limit.guard";

/**
 * `P2-13` step 5 — real-user Core Web Vitals. `docs/FRONTEND/09` § Monitoring.
 *
 * *"Real User Monitoring (RUM) for Core Web Vitals in production (e.g., via Vercel
 * Analytics/a self-hosted equivalent) — not just lab testing."* This is the self-hosted
 * equivalent at its smallest: the public page beacons each metric here, and each becomes one
 * structured log line, `rum.web_vital`, which the log pipeline (`docs/DEVOPS/06`) aggregates
 * into percentiles. No database table: a metric nobody queries per row does not need one.
 *
 * ## What a report may carry, and what it may not
 *
 * The metric's name, its value, its rating, and which **kind** of page produced it —
 * `invitation`, `preview` or `not_found`. Never the path: a preview path contains a
 * credential (`P2-12`), and an invitation path names a couple. Never the guest's IP in the
 * clear, because the logger does not receive it and the limiter only ever sees a hash.
 *
 * `.strict()` so an unknown field is refused rather than silently dropped — a client that
 * started sending `url` would otherwise have it ignored today and logged the day someone
 * spreads the body into the log context.
 *
 * ## 204, always, for a valid report
 *
 * `sendBeacon` ignores the response. Answering with a body would be bytes nobody reads.
 */

const reportSchema = z
  .object({
    metric: z.enum(["LCP", "CLS", "INP", "FCP", "TTFB"]),
    // Generous upper bounds. A value outside them is a broken client, not a slow page, and
    // would poison a percentile for everyone.
    value: z.number().finite().min(0).max(120_000),
    rating: z.enum(["good", "needs-improvement", "poor"]),
    page_kind: z.enum(["invitation", "preview", "not_found"]),
  })
  .strict();

export type WebVitalReport = z.infer<typeof reportSchema>;

@Controller("public/rum")
@UseGuards(rateLimit("general-public"))
export class PublicRumController {
  @Post()
  @HttpCode(204)
  report(@Body() body: unknown): void {
    const parsed = reportSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "body",
          message: issue.message,
        })),
      );
    }

    logger.info(
      {
        context: {
          event: "rum.web_vital",
          metric: parsed.data.metric,
          value: parsed.data.value,
          rating: parsed.data.rating,
          page_kind: parsed.data.page_kind,
        },
      },
      "web vital reported",
    );
  }
}
