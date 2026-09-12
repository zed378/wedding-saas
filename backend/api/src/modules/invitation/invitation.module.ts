import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { TenancyModule } from "../../shared/tenancy/tenancy.module";
import { InvitationController } from "./invitation.controller";
import { InvitationCreateService } from "./invitation-create.service";
import { InvitationService } from "./invitation.service";
import { SlugService } from "./slug.service";
import { InvitationStatusService } from "../../shared/invitation-status/invitation-status.service";

/** P1-09 and P1-10. The sub-resources are `P1-11` onwards. */
@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [InvitationController],
  providers: [
    InvitationCreateService,
    InvitationService,
    SlugService,
    InvitationStatusService,
  ],
  exports: [InvitationCreateService, InvitationService, SlugService],
})
export class InvitationModule {}
