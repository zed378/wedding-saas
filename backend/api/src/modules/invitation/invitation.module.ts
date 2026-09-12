import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { TenancyModule } from "../../shared/tenancy/tenancy.module";
import { InvitationController } from "./invitation.controller";
import { InvitationCreateService } from "./invitation-create.service";
import { InvitationService } from "./invitation.service";
import { CoupleService } from "./couple.service";
import { EventsService } from "./events.service";
import { GiftService, QuoteService } from "./gift.service";
import { SettingsService } from "./settings.service";
import { ChangeTemplateService } from "./change-template.service";
import { AuditModule } from "../../shared/audit/audit.module";
import { SlugService } from "./slug.service";
import { InvitationStatusService } from "../../shared/invitation-status/invitation-status.service";

/** P1-09 and P1-10. The sub-resources are `P1-11` onwards. */
@Module({
  imports: [AuthModule, TenancyModule, AuditModule],
  controllers: [InvitationController],
  providers: [
    InvitationCreateService,
    InvitationService,
    CoupleService,
    EventsService,
    GiftService,
    QuoteService,
    SettingsService,
    ChangeTemplateService,
    SlugService,
    InvitationStatusService,
  ],
  exports: [
    InvitationCreateService,
    InvitationService,
    CoupleService,
    EventsService,
    GiftService,
    QuoteService,
    SettingsService,
    ChangeTemplateService,
    SlugService,
  ],
})
export class InvitationModule {}
