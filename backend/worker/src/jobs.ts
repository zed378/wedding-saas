/**
 * The job catalogue: every job, its pool, and its retry policy.
 *
 * One table, taken from `docs/ARCHITECTURE/07` § Job Types and `docs/BACKEND/08`
 * § Scheduled Job List, because the alternative is a retry count next to each handler
 * and no way to answer "which jobs dead-letter?" without reading all of them.
 *
 * The `priority` column is not decoration. `docs/ARCHITECTURE/07` says a permanently
 * failed **high or medium** job must never be silently dropped, so it decides whether a
 * failure lands in the dead-letter queue or is allowed to disappear.
 */

export type Pool = "media" | "general" | "cron";
export type Priority = "high" | "medium" | "low";

export interface JobPolicy {
  readonly name: string;
  readonly pool: Pool;
  readonly priority: Priority;
  /** Total attempts, including the first. `docs/ARCHITECTURE/07` § Retry Policy. */
  readonly attempts: number;
  readonly backoff: {
    readonly type: "exponential" | "fixed";
    readonly delay: number;
  };
  /**
   * Whether a permanent failure is preserved for investigation.
   *
   * True for high and medium. False only where the document says so explicitly:
   * `analytics_counter_flush` is "best-effort, safe to drop on failure" -- and that has
   * to be a stated decision rather than an accident, or a dropped batch looks the same
   * as a bug.
   */
  readonly deadLetter: boolean;
  readonly description: string;
}

/**
 * Event-driven jobs. `docs/BACKEND/08` § Event-Driven (Triggered) Job List.
 */
export const JOBS = {
  "payment.webhook_process": {
    name: "payment.webhook_process",
    pool: "general",
    priority: "high",
    // 5 attempts, exponential. A provider retrying is normal, and the DB unique index
    // from P0-10 is what makes repeating this safe.
    attempts: 5,
    backoff: { type: "exponential", delay: 2_000 },
    deadLetter: true,
    description: "Process a verified payment webhook",
  },
  "media.process": {
    name: "media.process",
    pool: "media",
    priority: "high",
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    deadLetter: true,
    description: "Resize, strip EXIF, scan an upload",
  },
  "notification.send": {
    name: "notification.send",
    pool: "general",
    priority: "medium",
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    deadLetter: true,
    description: "Send a transactional email",
  },
  "cache.invalidate": {
    name: "cache.invalidate",
    pool: "general",
    priority: "medium",
    attempts: 3,
    backoff: { type: "exponential", delay: 1_000 },
    deadLetter: true,
    description: "Invalidate or regenerate a cached invitation",
  },
} as const satisfies Record<string, JobPolicy>;

/**
 * Scheduled jobs. `docs/BACKEND/08` § Scheduled Job List, with the times from
 * `docs/ARCHITECTURE/07` § Scheduling.
 *
 * Times are **WIB (UTC+7)** in the documents. The cron expressions carry an explicit
 * timezone rather than assuming the container clock: a server in UTC would otherwise run
 * "daily at 00:05 WIB" at 07:05 local, and the expiry sweep would fire seven hours late
 * every day without anything looking wrong.
 */
export const CRON_JOBS = {
  media_cleanup_staging: {
    name: "media_cleanup_staging",
    pool: "cron",
    priority: "low",
    attempts: 1,
    backoff: { type: "fixed", delay: 0 },
    deadLetter: false,
    description: "Delete orphaned staging files older than an hour",
    pattern: "0 * * * *",
  },
  order_expire_check: {
    name: "order_expire_check",
    pool: "cron",
    priority: "medium",
    attempts: 3,
    backoff: { type: "fixed", delay: 30_000 },
    deadLetter: true,
    description: "Expire pending orders past their expiry",
    pattern: "*/15 * * * *",
  },
  invitation_expiry_check: {
    name: "invitation_expiry_check",
    pool: "cron",
    priority: "low",
    attempts: 3,
    backoff: { type: "fixed", delay: 60_000 },
    deadLetter: false,
    description: "Expire published invitations past their expiry date",
    pattern: "5 0 * * *",
  },
  invitation_soft_delete_cleanup: {
    name: "invitation_soft_delete_cleanup",
    pool: "cron",
    priority: "low",
    attempts: 3,
    backoff: { type: "fixed", delay: 60_000 },
    deadLetter: false,
    description: "Hard-delete soft-deleted invitations older than 90 days",
    pattern: "0 1 * * *",
  },
  reminder_email_h7_h1: {
    name: "reminder_email_h7_h1",
    pool: "cron",
    priority: "medium",
    attempts: 3,
    backoff: { type: "fixed", delay: 60_000 },
    deadLetter: true,
    description: "Send H-7 and H-1 expiry reminders",
    pattern: "0 8 * * *",
  },
  analytics_counter_flush: {
    name: "analytics_counter_flush",
    pool: "cron",
    priority: "low",
    attempts: 1,
    backoff: { type: "fixed", delay: 0 },
    // The ONE job allowed to lose work. docs/ARCHITECTURE/07 calls it "best-effort,
    // safe to drop on failure (non-critical)". Stated here so a dropped batch reads as
    // a decision rather than a bug -- and so nobody copies this line onto a job where
    // losing work matters.
    deadLetter: false,
    description: "Flush the Redis view counter to the database",
    pattern: "* * * * *",
  },
} as const satisfies Record<string, JobPolicy & { pattern: string }>;

export type JobName = keyof typeof JOBS | keyof typeof CRON_JOBS;

const ALL: Record<string, JobPolicy> = { ...JOBS, ...CRON_JOBS };

export function policyFor(name: string): JobPolicy {
  const policy = ALL[name];
  if (policy === undefined) {
    // An unregistered job means someone enqueued a name with no retry policy, no pool
    // and no dead-letter decision. Refusing is better than inventing defaults, because
    // the invented default would be silent.
    throw new Error(
      `No job policy registered for "${name}". Add it to backend/worker/src/jobs.ts ` +
        `with a pool, a retry policy and an explicit dead-letter decision.`,
    );
  }
  return policy;
}

export function jobsForPool(pool: Pool): JobPolicy[] {
  return Object.values(ALL).filter((j) => j.pool === pool);
}

/** The timezone the documented cron times are expressed in. */
export const CRON_TIMEZONE = "Asia/Jakarta";
