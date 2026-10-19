import { Inject, Injectable } from "@nestjs/common";
import { Queue } from "bullmq";

import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import { EmailBounceService } from "./email-bounce.service";
import { logger } from "../../shared/logging/logger";

export interface DlqCheckResult {
  readonly totalDeadLettered: number;
  readonly criticalFailuresFound: number;
}

/**
 * `P4-08` — DLQ delivery monitor (`docs/DEVOPS/07-ALERTING.md`).
 *
 * Inspects the Redis dead-letter queue (`dead-letter`) for permanently failed background jobs,
 * particularly critical transactional notifications (`order_paid` / invoice, `email_verification`,
 * `password_reset`, `bank_account_changed`).
 *
 * When a critical failure is identified, it increments the Prometheus counter to trigger alerts
 * (`deploy/prometheus/alerts.yml` › `CriticalEmailDeadLettered`).
 */
@Injectable()
export class DlqMonitorService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly bounceService: EmailBounceService,
  ) {}

  async checkDlq(): Promise<DlqCheckResult> {
    const redisUrl = new URL(this.env.REDIS_URL);
    const connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      password: redisUrl.password || undefined,
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    };

    const dlq = new Queue("dead-letter", { connection });

    try {
      const counts = await dlq.getJobCounts("wait", "delayed", "failed", "completed");
      const totalDeadLettered = (counts.wait ?? 0) + (counts.delayed ?? 0) + (counts.failed ?? 0);

      const jobs = await dlq.getJobs(["wait", "delayed", "failed"], 0, 50);
      let criticalFailuresFound = 0;

      for (const job of jobs) {
        const data = job.data as {
          job_name?: string;
          payload?: { template?: string; orderId?: string; userId?: string };
        };

        const template = data.payload?.template;
        const isCritical =
          template === "order_paid" ||
          template === "email_verification" ||
          template === "password_reset" ||
          template === "bank_account_changed";

        if (isCritical && template) {
          criticalFailuresFound++;
          this.bounceService.recordDeadLetter(template, {
            jobId: job.id,
            jobName: data.job_name,
            attempts: job.attemptsMade,
          });
        }
      }

      logger.info(
        {
          context: {
            total_dead_lettered: totalDeadLettered,
            critical_failures: criticalFailuresFound,
          },
        },
        "DLQ monitoring sweep completed",
      );

      return { totalDeadLettered, criticalFailuresFound };
    } catch (err) {
      logger.error({ err }, "failed to inspect DLQ during monitoring sweep");
      return { totalDeadLettered: 0, criticalFailuresFound: 0 };
    } finally {
      await dlq.close();
    }
  }
}
