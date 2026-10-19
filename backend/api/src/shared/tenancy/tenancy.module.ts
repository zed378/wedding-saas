import { Global, Module } from "@nestjs/common";

import { AnalyticsRepository } from "./analytics-repository";
import { GuestbookRepository } from "./guestbook-repository";
import { InvitationRepository } from "./invitation-repository";
import { PublicInvitationRepository } from "./public-invitation-repository";
import { RsvpRepository } from "./rsvp-repository";

/**
 * The tenant-scoped data access layer.
 *
 * Global, because every module that touches an invitation needs it and the alternative
 * -- importing it per module -- is one forgotten import away from someone writing their
 * own query instead. `scripts/check-tenant-scope.mjs` refuses that, but making the right
 * thing frictionless matters more than refusing the wrong one.
 */
@Global()
@Module({
  // `PublicInvitationRepository` is global too since `P2-11`: the catalogue needs the
  // demo lookup, and a second module providing its own instance would be a second
  // place the no-owner query could be constructed from.
  providers: [
    AnalyticsRepository,
    GuestbookRepository,
    InvitationRepository,
    PublicInvitationRepository,
    RsvpRepository,
  ],
  exports: [
    AnalyticsRepository,
    GuestbookRepository,
    InvitationRepository,
    PublicInvitationRepository,
    RsvpRepository,
  ],
})
export class TenancyModule {}
