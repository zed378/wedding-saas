import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../infra/db/client";
import { EmailBounceService } from "./email-bounce.service";
import { EmailWebhookController } from "./email-webhook.controller";
import { DlqMonitorService } from "./dlq-monitor.service";

/**
 * `P4-08` — Notification preferences and delivery monitoring.
 *
 * Provides bounce tracking, suppression list queries, webhook ingestion,
 * and DLQ dead-letter alerting for critical transactional emails.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [EmailWebhookController],
  providers: [EmailBounceService, DlqMonitorService],
  exports: [EmailBounceService, DlqMonitorService],
})
export class NotificationModule {}
