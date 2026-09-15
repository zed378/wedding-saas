import { Module } from "@nestjs/common";

import { MetricsController } from "./metrics.controller";

/** `P3-05` — Prometheus scrape endpoint. */
@Module({ controllers: [MetricsController] })
export class MetricsModule {}
