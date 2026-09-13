import { Module } from "@nestjs/common";

import { RegionsController } from "./regions.controller";
import { RegionsRepository } from "./regions.repository";
import { RegionsService } from "./regions.service";

/**
 * `P2-17` — Indonesia's administrative regions. `RegionsService` is exported for the events
 * service, which takes an event's timezone from its region's province.
 */
@Module({
  controllers: [RegionsController],
  providers: [RegionsService, RegionsRepository],
  exports: [RegionsService],
})
export class RegionsModule {}
