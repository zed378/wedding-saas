import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../../shared/audit/audit.module";
import { TemplateModule } from "../template/template.module";
import { AdminAuditLogsController } from "./audit-logs.controller";
import { AdminAuditLogService } from "./audit-logs.service";
import { AdminPaymentsController } from "./admin-payments.controller";
import { AdminTemplatesController } from "./admin-templates.controller";
import { AdminTemplatesService } from "./admin-templates.service";
import { AdminUsersController } from "./admin-users.controller";
import { AdminUsersService } from "./admin-users.service";

/**
 * P5-03, P5-04, P5-06: Administrative module.
 *
 * All routes mounted under `/api/v1/admin/*`, guarded by role verification
 * (admin / super_admin) and audited in the same database transaction.
 */
@Module({
  imports: [AuthModule, AuditModule, TemplateModule],
  controllers: [
    AdminAuditLogsController,
    AdminPaymentsController,
    AdminTemplatesController,
    AdminUsersController,
  ],
  providers: [
    AdminAuditLogService,
    AdminTemplatesService,
    AdminUsersService,
  ],
  exports: [
    AdminAuditLogService,
    AdminTemplatesService,
    AdminUsersService,
  ],
})
export class AdminModule {}
