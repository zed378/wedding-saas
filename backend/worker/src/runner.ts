import { Worker, Queue, type Job, type ConnectionOptions } from "bullmq";
import type { Redis } from "ioredis";

import { policyFor, type Pool, type JobPolicy } from "./jobs.js";
import { claim, markProcessed, release } from "./idempotency.js";
import { logger } from "./logger.js";

/**
 * The job runner: policy, idempotency, dead-lettering and observability in one place.
 *
 * Every handler is wrapped by `run()` below rather than each one remembering to check an
 * idempotency key and log its own timings. `docs/BACKEND/08` § Idempotency Pattern
 * applies "to all jobs", and a pattern applied by convention is applied to most jobs.
 */

/** The envelope every job payload travels in. Mirrors the API's `enqueueEnvelope`. */
export interface JobPayload<T = unknown> {
  /** Correlation, so a photo can be traced from the HTTP request to worker completion. */
  readonly trace?: {
    request_id?: string;
    user_id?: string;
    enqueued_at?: string;
  };
  /** The idempotency key. Absent means the job is inherently safe to repeat. */
  readonly idempotencyKey?: string;
  /** An invitation or order id, for the `related_id` observability field. */
  readonly relatedId?: string;
  readonly data: T;
}

export type Handler<T> = (data: T, context: JobContext) => Promise<void>;

export interface JobContext {
  readonly jobName: string;
  readonly attempt: number;
  readonly requestId: string | undefined;
}

/** The dead-letter queue name. One queue for all pools -- one dashboard, one alert. */
export const DLQ_NAME = "dead-letter";

export interface RunnerOptions {
  readonly pool: Pool;
  readonly connection: ConnectionOptions;
  readonly redis: Redis;
  readonly concurrency?: number;
}

export class JobRunner {
  private readonly handlers = new Map<string, Handler<never>>();
  private readonly workers: Worker[] = [];
  private readonly dlq: Queue;

  constructor(private readonly options: RunnerOptions) {
    this.dlq = new Queue(DLQ_NAME, { connection: options.connection });
  }

  register<T>(jobName: string, handler: Handler<T>): this {
    // Throws for an unregistered name -- a job with no policy has no retry count, no
    // pool and no dead-letter decision, and inventing those silently is how a job ends
    // up dropping work nobody agreed it could drop.
    const policy = policyFor(jobName);
    if (policy.pool !== this.options.pool) {
      throw new Error(
        `Job "${jobName}" belongs to the ${policy.pool} pool, not ${this.options.pool}. ` +
          `Pools are separated because they fail and scale differently (docs/BACKEND/08).`,
      );
    }
    this.handlers.set(jobName, handler as Handler<never>);
    return this;
  }

  /** Start consuming. One BullMQ worker per registered job name. */
  start(): void {
    for (const [jobName, handler] of this.handlers) {
      const policy = policyFor(jobName);
      const worker = new Worker(
        jobName,
        async (job: Job<JobPayload>) => this.run(policy, job, handler),
        {
          connection: this.options.connection,
          concurrency:
            this.options.concurrency ?? (this.options.pool === "media" ? 2 : 5),
        },
      );

      // `failed` fires on every attempt. Only the LAST one dead-letters, or a job with
      // three attempts would produce three DLQ entries and the alert would fire twice
      // before the job had actually given up.
      worker.on("failed", (job, error) => {
        void this.onFailed(policy, job, error);
      });

      this.workers.push(worker);
    }

    logger.info(
      { context: { pool: this.options.pool, jobs: [...this.handlers.keys()] } },
      "worker pool started",
    );
  }

  async stop(): Promise<void> {
    // `close()` waits for in-flight jobs. A media transform killed mid-write leaves a
    // half-written object in storage, which the hourly cleanup then has to find.
    await Promise.all(this.workers.map((w) => w.close()));
    await this.dlq.close();
  }

  /**
   * Run one job: claim, work, mark, log.
   *
   * The observability fields are exactly those `docs/BACKEND/08` § Observability per Job
   * names -- `job_name`, `started_at`, `finished_at`, `status`, `related_id`,
   * `error_message` -- so the monitoring dashboard has one shape to parse.
   */
  private async run(
    policy: JobPolicy,
    job: Job<JobPayload>,
    handler: Handler<never>,
  ): Promise<void> {
    const startedAt = new Date();
    const payload = job.data;
    const requestId = payload.trace?.request_id;
    const key = payload.idempotencyKey;

    const base = {
      job_name: policy.name,
      job_id: job.id,
      attempt: job.attemptsMade + 1,
      related_id: payload.relatedId,
      ...(requestId !== undefined ? { request_id: requestId } : {}),
    };

    if (key !== undefined) {
      const result = await claim(this.options.redis, policy.name, key);
      if (!result.claimed) {
        // The safe no-op the document asks for. Logged rather than silent: a sudden
        // rise in skips means a producer is enqueuing duplicates, which is worth
        // seeing even though nothing is broken.
        logger.info(
          {
            context: {
              ...base,
              started_at: startedAt.toISOString(),
              finished_at: new Date().toISOString(),
              status: result.alreadyProcessed
                ? "skipped_already_processed"
                : "skipped_in_progress",
            },
          },
          "job skipped",
        );
        return;
      }
    }

    try {
      await handler(payload.data as never, {
        jobName: policy.name,
        attempt: job.attemptsMade + 1,
        requestId,
      });

      if (key !== undefined)
        await markProcessed(this.options.redis, policy.name, key);

      const finishedAt = new Date();
      logger.info(
        {
          context: {
            ...base,
            started_at: startedAt.toISOString(),
            finished_at: finishedAt.toISOString(),
            duration_ms: finishedAt.getTime() - startedAt.getTime(),
            status: "success",
          },
        },
        "job completed",
      );
    } catch (error) {
      // Release the claim so the retry is not blocked by its own predecessor. Without
      // this, "retry 3 times" becomes "try once, then skip twice", which looks
      // identical to three genuine failures.
      if (key !== undefined)
        await release(this.options.redis, policy.name, key);

      const finishedAt = new Date();
      logger.warn(
        {
          context: {
            ...base,
            started_at: startedAt.toISOString(),
            finished_at: finishedAt.toISOString(),
            status: "failed",
            error_message:
              error instanceof Error ? error.message : String(error),
          },
        },
        "job failed",
      );

      throw error; // BullMQ decides whether to retry.
    }
  }

  /**
   * Dead-letter a job that has exhausted its attempts.
   *
   * `docs/ARCHITECTURE/07`: a permanently failed **high or medium** job "must never be
   * silently dropped". Low-priority jobs may be dropped only where the document says so
   * -- `analytics_counter_flush` is the one such case, and its policy carries
   * `deadLetter: false` explicitly so the drop is a decision rather than an oversight.
   */
  private async onFailed(
    policy: JobPolicy,
    job: Job | undefined,
    error: Error,
  ): Promise<void> {
    if (job === undefined) return;

    const exhausted = job.attemptsMade >= policy.attempts;
    if (!exhausted) return;

    if (!policy.deadLetter) {
      logger.warn(
        {
          context: {
            job_name: policy.name,
            job_id: job.id,
            status: "dropped",
            error_message: error.message,
          },
        },
        "job dropped after final attempt (best-effort, deadLetter: false)",
      );
      return;
    }

    await this.dlq.add(
      policy.name,
      {
        job_name: policy.name,
        original_job_id: job.id,
        priority: policy.priority,
        attempts_made: job.attemptsMade,
        failed_at: new Date().toISOString(),
        error_message: error.message,
        payload: job.data,
      },
      // Never retried and never removed automatically: this queue IS the record.
      { attempts: 1, removeOnComplete: false, removeOnFail: false },
    );

    logger.error(
      {
        context: {
          job_name: policy.name,
          job_id: job.id,
          priority: policy.priority,
          status: "dead_lettered",
          attempts_made: job.attemptsMade,
          error_message: error.message,
        },
      },
      "job dead-lettered",
    );
  }
}

/**
 * The DLQ depth, for `docs/DEVOPS/07`'s alert.
 *
 * Counts waiting **and** delayed: a dead-lettered job sits waiting because nothing
 * consumes this queue, and counting only one state would under-report during a burst.
 */
export async function deadLetterDepth(
  connection: ConnectionOptions,
): Promise<number> {
  const queue = new Queue(DLQ_NAME, { connection });
  try {
    const counts = await queue.getJobCounts("waiting", "delayed", "failed");
    return (
      (counts["waiting"] ?? 0) +
      (counts["delayed"] ?? 0) +
      (counts["failed"] ?? 0)
    );
  } finally {
    await queue.close();
  }
}
