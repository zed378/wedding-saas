import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PublishingModule } from "../publishing/publishing.module";
import { GuestbookService } from "./guestbook.service";
import { PublicGuestbookController } from "./public-guestbook.controller";
import { OwnerGuestbookController } from "./owner-guestbook.controller";

/**
 * `P4-03` & `P4-04` — Guestbook module.
 *
 * Provides:
 * - Public guestbook submission and approved listing (`/public/i/:slug/guestbook`)
 * - Owner guestbook management and moderation (`/api/v1/invitations/:id/guestbook`)
 */
@Module({
  imports: [AuthModule, PublishingModule],
  controllers: [PublicGuestbookController, OwnerGuestbookController],
  providers: [GuestbookService],
  exports: [GuestbookService],
})
export class GuestbookModule {}
