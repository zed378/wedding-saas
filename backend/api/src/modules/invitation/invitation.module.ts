import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { TenancyModule } from "../../shared/tenancy/tenancy.module";
import { InvitationController } from "./invitation.controller";
import { InvitationCreateService } from "./invitation-create.service";
import { SlugService } from "./slug.service";
import { InvitationStatusService } from "../../shared/invitation-status/invitation-status.service";

/** P1-09. `P1-10` adds list, detail, update and soft delete. */
@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [InvitationController],
  providers: [InvitationCreateService, SlugService, InvitationStatusService],
  exports: [InvitationCreateService, SlugService],
})
export class InvitationModule {}
