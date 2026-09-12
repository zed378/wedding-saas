import { Pool as PgPool } from "pg";
import { S3Storage, type StoragePort } from "@wi/storage";

import type { Pool } from "../jobs.js";
import { policyFor } from "../jobs.js";
import type { JobRunner } from "../runner.js";
import { logger } from "../logger.js";
import type { WorkerEnv } from "../env.js";
import { MediaRepository } from "../media/media-repository.js";
import { makeMediaProcessHandler } from "../media/media-process.handler.js";
import { makeCleanupStagingHandler } from "../media/cleanup-staging.handler.js";

/**
 * Job handlers, by pool.
 *
 * `P1-18` registered the first real ones: `media.process` in the media pool and
 * `media_cleanup_staging` in cron. The rest are still absent, which is the honest state —
 * `payment.webhook_process` needs `P3-05` and `notification.send` needs `P4-06`. Registering
 * an empty stub for either would mean a job that reports success without doing its work,
 * which is worse than one that is not registered: an unregistered job stays queued and
 * visible, where a no-op stub is invisible and wrong.
 */

export interface HandlerDeps {
  readonly env: WorkerEnv;
  /** Closed on shutdown by the caller. */
  readonly pg: PgPool;
  readonly storage: StoragePort;
}

/**
 * Build the shared clients a pool needs.
 *
 * Returned rather than created inside `registerHandlers` so `main.ts` can close them on
 * shutdown — a `pg.Pool` that is never ended keeps the process alive past SIGTERM, which
 * turns a rolling deploy into a stuck one.
 */
export function createHandlerDeps(env: WorkerEnv): HandlerDeps {
  return {
    env,
    pg: new PgPool({ connectionString: env.databaseUrl, max: 4 }),
    storage: new S3Storage({
      endpoint: env.storage.endpoint,
      accessKeyId: env.storage.accessKeyId,
      secretAccessKey: env.storage.secretAccessKey,
      buckets: env.storage.buckets,
    }),
  };
}

export function registerHandlers(
  pool: Pool,
  runner: JobRunner,
  deps: HandlerDeps | undefined,
): void {
  switch (pool) {
    case "media": {
      if (deps === undefined) break;
      const repository = new MediaRepository(deps.pg);

      runner.register(
        "media.process",
        makeMediaProcessHandler({
          repository,
          storage: deps.storage,
          clamav: deps.env.clamav,
          // From the policy table rather than a literal, so the handler recognises its own
          // last attempt without a second copy of the retry count to keep in step.
          maxAttempts: policyFor("media.process").attempts,
        }),
      );
      break;
    }

    case "general":
      // P3-05: payment.webhook_process
      // P4-06: notification.send
      // P2-*:  cache.invalidate
      break;

    case "cron": {
      if (deps === undefined) break;
      runner.register(
        "media_cleanup_staging",
        makeCleanupStagingHandler({
          repository: new MediaRepository(deps.pg),
          storage: deps.storage,
        }),
      );
      // P4-*: the remaining sweeps. Registering them as no-ops now would mean the expiry
      // check "succeeds" every night while expiring nothing.
      break;
    }
  }

  logger.debug({ context: { pool } }, "handlers registered");
}
