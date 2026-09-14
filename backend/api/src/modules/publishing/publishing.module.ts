import { Module } from "@nestjs/common";

import { PricingModule } from "../order/pricing.module";

import { PublicInvitationController } from "./public-invitation.controller";
import { PublicPreviewController } from "./public-preview.controller";
import { PublicRumController } from "./public-rum.controller";
import { PublicInvitationService } from "./public-invitation.service";

/**
 * `P2-07` — publishing. `docs/ARCHITECTURE/01`: publish/unpublish and slug resolution.
 *
 * At this point the module holds only the public read. `P3-09`'s publish and unpublish
 * endpoints and `P3-13`'s expiry sweep belong here too, and the slug **resolution** half
 * of `docs/BACKEND/06` is what this controller already is.
 */
@Module({
  imports: [PricingModule],
  controllers: [
    PublicInvitationController,
    PublicPreviewController,
    PublicRumController,
  ],
  // The repository comes from the global `TenancyModule`.
  providers: [PublicInvitationService],
  exports: [PublicInvitationService],
})
export class PublishingModule {}
