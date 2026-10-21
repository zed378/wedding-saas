import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../../shared/audit/audit.module";
import { TemplateModule } from "../template/template.module";
import { AdminAuditLogsController } from "./audit-logs.controller";
import { AdminAuditLogService } from "./audit-logs.service";
import { AdminPaymentsController } from "./admin-payments.controller";
import { AdminTemplatesController } from "./admin-templates.controller";
import { AdminTemplatesService } from "./admin-templates.service";
import { AdminOrdersController } from "./admin-orders.controller";
import { AdminOrdersService } from "./admin-orders.service";
import { AdminUsersController } from "./admin-users.controller";
import { AdminUsersService } from "./admin-users.service";

import { AdminModerationController } from "./admin-moderation.controller";
import { AdminModerationService } from "./admin-moderation.service";

import { AdminInvitationsController } from "./admin-invitations.controller";
import { AdminInvitationsService } from "./admin-invitations.service";

import { AdminDashboardController } from "./admin-dashboard.controller";
import { AdminDashboardService } from "./admin-dashboard.service";

/**
 * P5-03, P5-04, P5-06, P5-07, P5-09, P5-10: Administrative module.
 *
 * All routes mounted under `/api/v1/admin/*`, guarded by role verification
 * (admin / super_admin) and audited in the same database transaction.
 */
@Module({
  imports: [AuthModule, AuditModule, TemplateModule],
  controllers: [
    AdminAuditLogsController,
    AdminModerationController,
    AdminOrdersController,
    AdminPaymentsController,
    AdminTemplatesController,
    AdminUsersController,
    AdminInvitationsController,
    AdminDashboardController,
  ],
  providers: [
    AdminAuditLogService,
    AdminModerationService,
    AdminOrdersService,
    AdminTemplatesService,
    AdminUsersService,
    AdminInvitationsService,
    AdminDashboardService,
  ],
  exports: [
    AdminAuditLogService,
    AdminModerationService,
    AdminOrdersService,
    AdminTemplatesService,
    AdminUsersService,
    AdminInvitationsService,
    AdminDashboardService,
  ],
})
export class AdminModule {}
