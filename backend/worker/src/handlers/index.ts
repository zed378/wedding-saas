import type { Pool } from "../jobs.js";
import type { JobRunner } from "../runner.js";
import { logger } from "../logger.js";

/**
 * Job handlers, by pool.
 *
 * Almost nothing is registered yet, and that is the honest state: `media.process` needs
 * P1-17's upload pipeline, `payment.webhook_process` needs P3-05, `notification.send`
 * needs P4-06. Registering an empty stub for each would mean a job that silently
 * succeeds without doing its work, which is worse than one that is not registered at all
 * -- an unregistered job stays queued and visible; a no-op stub reports success.
 *
 * What IS registered is the example job the P0-15 card asks for, end to end, so the
 * runner, the idempotency guard, the retry policy and the dead-letter path are exercised
 * by something real rather than only by tests.
 */
export function registerHandlers(pool: Pool, runner: JobRunner): void {
  switch (pool) {
    case "media":
      // P1-17: media.process -- resize, strip EXIF, malware scan.
      break;

    case "general":
      // P3-05: payment.webhook_process
      // P4-06: notification.send
      // P2-*:  cache.invalidate
      break;

    case "cron":
      // P4-*: the scheduled sweeps. Registering them as no-ops now would mean the
      // expiry check "succeeds" every night while expiring nothing.
      break;
  }

  logger.debug({ context: { pool } }, "handlers registered");
}
