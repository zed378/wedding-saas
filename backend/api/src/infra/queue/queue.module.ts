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

export interface JobQueue {
  readonly enqueue: (
    pool: PoolName,
    name: string,
    data: Record<string, unknown>,
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

        // A Queue per pool. BullMQ addresses a queue by name, and the worker listens on
        // one name per pool.
        const queues = new Map<PoolName, Queue>();
        const queueFor = (pool: PoolName): Queue => {
          let queue = queues.get(pool);
          if (queue === undefined) {
            queue = new Queue(pool, { connection });
            queues.set(pool, queue);
          }
          return queue;
        };

        return {
          enqueue: async (pool, name, data) => {
            try {
              await queueFor(pool).add(name, data, {
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
