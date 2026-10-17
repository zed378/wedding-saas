import { Module } from "@nestjs/common";

import { PublicRsvpController } from "./public-rsvp.controller";
import { RsvpService } from "./rsvp.service";

/**
 * `P4-01` — RSVP module.
 *
 * Provides public RSVP attendance confirmation (`POST /public/i/:slug/rsvp`)
 * and (in P4-02) owner RSVP management and export endpoints.
 */
@Module({
  controllers: [PublicRsvpController],
  providers: [RsvpService],
  exports: [RsvpService],
})
export class RsvpModule {}
