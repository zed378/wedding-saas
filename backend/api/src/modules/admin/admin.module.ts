import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../../shared/audit/audit.module";
import { AdminAuditLogsController } from "./audit-logs.controller";
import { AdminAuditLogService } from "./audit-logs.service";
import { AdminPaymentsController } from "./admin-payments.controller";

/**
 * P5-03: Administrative module.
 *
 * All routes mounted under `/api/v1/admin/*`, guarded by role verification
 * (admin / super_admin) and audited in the same database transaction.
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AdminAuditLogsController, AdminPaymentsController],
  providers: [AdminAuditLogService],
  exports: [AdminAuditLogService],
})
export class AdminModule {}
