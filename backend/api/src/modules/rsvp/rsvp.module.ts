import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { OwnerRsvpController } from "./owner-rsvp.controller";
import { PublicRsvpController } from "./public-rsvp.controller";
import { RsvpService } from "./rsvp.service";
import { RsvpDigestService } from "./rsvp-digest.service";

/**
 * `P4-01`, `P4-02` & `P4-08` — RSVP module.
 *
 * Provides public RSVP attendance confirmation (`POST /public/i/:slug/rsvp`),
 * owner RSVP management and export endpoints (`/api/v1/invitations/:id/rsvps`),
 * and the daily aggregated RSVP digest service (`RsvpDigestService`).
 */
@Module({
  imports: [AuthModule],
  controllers: [PublicRsvpController, OwnerRsvpController],
  providers: [RsvpService, RsvpDigestService],
  exports: [RsvpService, RsvpDigestService],
})
export class RsvpModule {}
