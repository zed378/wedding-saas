import { timingSafeEqual } from "node:crypto";

import { Controller, Get, Header, Headers, Inject } from "@nestjs/common";

import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import { NotFoundError } from "../../http/errors";
import { renderMetrics } from "./metrics";

/**
 * `P3-05` — `GET /metrics` for Prometheus.
 *
 * Behind a bearer token, and **404** rather than 401 without it: an unauthenticated scanner learns
 * nothing, not even that an endpoint exists. Unset `METRICS_TOKEN` disables it entirely.
 */
@Controller()
export class MetricsController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get("metrics")
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  @Header("Cache-Control", "no-store")
  scrape(@Headers("authorization") authorization: string | undefined): string {
    const token = this.env.METRICS_TOKEN;
    if (token === undefined || !matches(authorization, `Bearer ${token}`)) {
      throw new NotFoundError();
    }
    return renderMetrics();
  }
}

function matches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
