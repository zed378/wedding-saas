import { Global, Module } from "@nestjs/common";

import { InvitationRepository } from "./invitation-repository";

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
  providers: [InvitationRepository],
  exports: [InvitationRepository],
})
export class TenancyModule {}
