import { Module } from "@nestjs/common";

import { PublicInvitationController } from "./public-invitation.controller";
import { PublicInvitationService } from "./public-invitation.service";
import { PublicInvitationRepository } from "../../shared/tenancy/public-invitation-repository";

/**
 * `P2-07` — publishing. `docs/ARCHITECTURE/01`: publish/unpublish and slug resolution.
 *
 * At this point the module holds only the public read. `P3-09`'s publish and unpublish
 * endpoints and `P3-13`'s expiry sweep belong here too, and the slug **resolution** half
 * of `docs/BACKEND/06` is what this controller already is.
 */
@Module({
  controllers: [PublicInvitationController],
  providers: [PublicInvitationService, PublicInvitationRepository],
  exports: [PublicInvitationService],
})
export class PublishingModule {}
