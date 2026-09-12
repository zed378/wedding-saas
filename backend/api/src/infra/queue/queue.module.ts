import { Global, Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";

import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import { logger } from "../../shared/logging/logger";

/**
 * P1-02 — the API's side of the queue.
 *
 * `P0-15` built the worker; this is the producer. The split matters: the API may
 * **enqueue** and nothing else. It does not process, and it does not own the job
 * catalogue -- `backend/worker/src/jobs.ts` does, and the pool names here must match it.
 *
 * ## Enqueue failure does not fail the request
 *
 * `enqueue` resolves even when Redis is unreachable. That is a deliberate reading of
 * `docs/BACKEND/07`: the notification is asynchronous precisely so the user is not made
 * to wait for it, and rolling back a registration because Redis blinked would be a worse
 * outcome than a user who exists and can ask for the email again. The failure is logged
 * so it is not silent.
 *
 * Jobs whose loss is NOT acceptable -- a payment webhook -- must not use this. They are
 * `P3`'s, and the webhook is persisted before acknowledgement for exactly that reason.
 */

export const JOB_QUEUE = Symbol("JOB_QUEUE");

/** The pools `backend/worker/src/jobs.ts` defines. */
export type PoolName = "general" | "media" | "cron";

/**
 * The envelope every job travels in. **This shape is the contract with the worker**, and
 * `JobPayload` in `backend/worker/src/runner.ts` is the other half of it.
 *
 * Duplicated rather than shared, for now: the API cannot import `@wi/worker` and the worker
 * cannot import the API. Each side has a test pinning its half — `queue.spec.ts` here and
 * `media-process.itest.ts` there — which is what stops the two drifting until the shape
 * moves into a package (`P4-06`, when `notification.send` gets its handler).
 */
export interface JobEnvelope {
  readonly trace?: {
    request_id?: string;
    user_id?: string;
    enqueued_at?: string;
  };
  /** Absent means the job is inherently safe to repeat. */
  readonly idempotencyKey?: string;
  /** An invitation or order id, for the worker's `related_id` log field. */
  readonly relatedId?: string;
  readonly data: Record<string, unknown>;
}

export interface JobQueue {
  readonly enqueue: (
    pool: PoolName,
    name: string,
    data: Record<string, unknown>,
    options?: {
      readonly idempotencyKey?: string;
      readonly relatedId?: string;
    },
  ) => Promise<void>;
  readonly close: () => Promise<void>;
}

@Global()
@Module({
  providers: [
    {
      provide: JOB_QUEUE,
      inject: [ENV],
      useFactory: (env: Env): JobQueue => {
        // `maxRetriesPerRequest: null` is what BullMQ requires of a connection it owns.
        // `lazyConnect` so constructing the module does not itself fail when Redis is
        // down -- the API must still start and serve /health.
        const connection = new IORedis(env.REDIS_URL, {
          maxRetriesPerRequest: null,
          lazyConnect: true,
          enableOfflineQueue: false,
        });

        /**
         * A Queue per **job name**, not per pool.
         *
         * This was a queue per pool until `P1-18`, and it was a real defect rather than a
         * style choice: `JobRunner.start()` creates one `new Worker(jobName)` per registered
         * job, so a job added to a queue called `general` is a job no worker is listening
         * for. Nothing noticed because no handler had ever been registered — `P1-02`'s eight
         * `notification.send` calls were all landing in a queue nobody consumed.
         *
         * The pool is still a parameter because it is real — `docs/BACKEND/08` separates
         * `worker-media` from `worker-general` so they scale and fail independently — but it
         * is a property of the *worker process*, decided by `jobs.ts`, not an address.
         */
        const queues = new Map<string, Queue>();
        const queueFor = (jobName: string): Queue => {
          let queue = queues.get(jobName);
          if (queue === undefined) {
            queue = new Queue(jobName, { connection });
            queues.set(jobName, queue);
          }
          return queue;
        };

        return {
          enqueue: async (pool, name, data, options) => {
            try {
              const envelope: JobEnvelope = {
                data,
                ...(options?.idempotencyKey !== undefined
                  ? { idempotencyKey: options.idempotencyKey }
                  : {}),
                ...(options?.relatedId !== undefined
                  ? { relatedId: options.relatedId }
                  : {}),
                trace: { enqueued_at: new Date().toISOString() },
              };

              await queueFor(name).add(name, envelope, {
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 1000 },
              });
            } catch (cause) {
              // Deliberately swallowed. See the note above: the caller's transaction has
              // already committed and undoing it would be worse than a missing email.
              logger.warn(
                {
                  context: {
                    pool,
                    job: name,
                    reason: cause instanceof Error ? cause.message : "unknown",
                  },
                },
                "failed to enqueue job",
              );
            }
          },
          close: async () => {
            await Promise.all([...queues.values()].map((q) => q.close()));
            connection.disconnect();
          },
        };
      },
    },
  ],
  exports: [JOB_QUEUE],
})
export class QueueModule implements OnModuleDestroy {
  constructor(@Inject(JOB_QUEUE) private readonly queue: JobQueue) {}

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
