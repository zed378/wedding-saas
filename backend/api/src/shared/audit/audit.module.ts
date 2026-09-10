import { Global, Module } from "@nestjs/common";

import { AuditLogService } from "./audit-log.service";
import { InvitationStatusService } from "../invitation-status/invitation-status.service";

/**
 * The two writers that make an unrecorded change inexpressible.
 *
 * Global for the same reason the tenancy module is: every module that changes an
 * invitation's status or performs an admin action needs these, and a per-module import
 * is one omission away from someone writing the update directly.
 */
@Global()
@Module({
  providers: [AuditLogService, InvitationStatusService],
  exports: [AuditLogService, InvitationStatusService],
})
export class AuditModule {}
