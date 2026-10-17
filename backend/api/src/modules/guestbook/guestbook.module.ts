import { Module } from "@nestjs/common";

import { GuestbookService } from "./guestbook.service";
import { PublicGuestbookController } from "./public-guestbook.controller";

/**
 * `P4-03` — Guestbook module.
 *
 * Provides public guestbook submission and approved listing endpoints (`/public/i/:slug/guestbook`).
 */
@Module({
  controllers: [PublicGuestbookController],
  providers: [GuestbookService],
  exports: [GuestbookService],
})
export class GuestbookModule {}
