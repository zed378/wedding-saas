import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { OwnerRsvpController } from "./owner-rsvp.controller";
import { PublicRsvpController } from "./public-rsvp.controller";
import { RsvpService } from "./rsvp.service";

/**
 * `P4-01` & `P4-02` — RSVP module.
 *
 * Provides public RSVP attendance confirmation (`POST /public/i/:slug/rsvp`)
 * and owner RSVP management and export endpoints (`/api/v1/invitations/:id/rsvps`).
 */
@Module({
  imports: [AuthModule],
  controllers: [PublicRsvpController, OwnerRsvpController],
  providers: [RsvpService],
  exports: [RsvpService],
})
export class RsvpModule {}
