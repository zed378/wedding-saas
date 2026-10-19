import { Module } from "@nestjs/common";

import { AnalyticsService } from "./analytics.service";
import { PublicViewController } from "./public-view.controller";

/**
 * `P4-09`, `P4-10` — Analytics Module.
 *
 * Provides page view counter aggregation and analytics summaries.
 */
@Module({
  controllers: [PublicViewController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
