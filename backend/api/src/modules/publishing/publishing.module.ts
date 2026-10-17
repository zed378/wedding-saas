import { Module } from "@nestjs/common";

import { PricingModule } from "../order/pricing.module";

import { PublicInvitationController } from "./public-invitation.controller";
import { PublicPreviewController } from "./public-preview.controller";
import { PublicRumController } from "./public-rum.controller";
import { PublicInvitationService } from "./public-invitation.service";
import { PublicInvitationCache } from "./public-invitation-cache";
import { PublishController } from "./publish.controller";
import { PublishService } from "./publish.service";
import { UnpublishService } from "./unpublish.service";
import { InvitationExpiryService } from "./invitation-expiry.service";
import { InvitationReminderService } from "./invitation-reminder.service";
import { AuthModule } from "../auth/auth.module";
import { InvitationModule } from "../invitation/invitation.module";

/**
 * `P2-07` — publishing. `docs/ARCHITECTURE/01`: publish/unpublish and slug resolution.
 *
 * At this point the module holds only the public read. `P3-09`'s publish and unpublish
 * endpoints and `P3-13`'s expiry sweep belong here too, and the slug **resolution** half
 * of `docs/BACKEND/06` is what this controller already is.
 */
@Module({
  imports: [PricingModule, AuthModule, InvitationModule],
  controllers: [
    PublishController,
    PublicInvitationController,
    PublicPreviewController,
    PublicRumController,
  ],
  // The repository comes from the global `TenancyModule`.
  providers: [
    PublicInvitationService,
    PublicInvitationCache,
    PublishService,
    UnpublishService,
    InvitationExpiryService,
    InvitationReminderService,
  ],
  exports: [
    PublicInvitationService,
    PublicInvitationCache,
    InvitationExpiryService,
    InvitationReminderService,
  ],
})
export class PublishingModule {}
