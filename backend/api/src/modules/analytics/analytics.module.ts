import { Module } from "@nestjs/common";

import { AnalyticsService } from "./analytics.service";
import { OwnerAnalyticsController } from "./owner-analytics.controller";
import { PublicViewController } from "./public-view.controller";

/**
 * `P4-09`, `P4-10` — Analytics Module.
 *
 * Provides page view counter aggregation and analytics summaries.
 */
@Module({
  controllers: [PublicViewController, OwnerAnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
