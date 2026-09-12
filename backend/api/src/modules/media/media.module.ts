import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { TenancyModule } from "../../shared/tenancy/tenancy.module";
import { MediaController } from "./media.controller";
import { MediaService } from "./media.service";

/**
 * P1-17 — the synchronous upload stage. The worker half is `P1-18`.
 *
 * No `AuditModule`: an upload is not an owner action over somebody's money or identity, and
 * `media` rows carry their own trail through `status` and `created_at`. `P1-19`'s delete may
 * need one.
 */
@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
