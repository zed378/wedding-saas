import { Pool as PgPool } from "pg";
import { InMemoryStorage, S3Storage, type StoragePort } from "@wi/storage";

import type { Pool } from "../jobs.js";
import { policyFor } from "../jobs.js";
import type { JobRunner } from "../runner.js";
import { logger } from "../logger.js";
import type { WorkerEnv } from "../env.js";
import { MediaRepository } from "../media/media-repository.js";
import { makeMediaProcessHandler } from "../media/media-process.handler.js";
import { makeCleanupStagingHandler } from "../media/cleanup-staging.handler.js";
import { makeCacheInvalidateHandler } from "./cache-invalidate.handler.js";
import { makeNotificationSendHandler } from "./notification-send.handler.js";
import {
  type EmailPort,
  MemoryEmailAdapter,
  ResendEmailAdapter,
} from "../email/index.js";

/**
 * Job handlers, by pool.
 *
 * `P1-18` registered the first real ones: `media.process` in the media pool and
 * `media_cleanup_staging` in cron. `P4-06` registers `notification.send` in general.
 */

export interface HandlerDeps {
  readonly env: WorkerEnv;
  /** Closed on shutdown by the caller. */
  readonly pg?: PgPool | undefined;
  readonly storage: StoragePort;
  readonly emailPort: EmailPort;
}

/**
 * Build the shared clients a pool needs.
 *
 * Returned rather than created inside `registerHandlers` so `main.ts` can close them on
 * shutdown — a `pg.Pool` that is never ended keeps the process alive past SIGTERM, which
 * turns a rolling deploy into a stuck one.
 */
export function createHandlerDeps(env: WorkerEnv): HandlerDeps {
  const pg = env.databaseUrl ? new PgPool({ connectionString: env.databaseUrl, max: 4 }) : undefined;
  const storage = env.storage.endpoint
    ? new S3Storage({
        endpoint: env.storage.endpoint,
        accessKeyId: env.storage.accessKeyId,
        secretAccessKey: env.storage.secretAccessKey,
        buckets: env.storage.buckets,
      })
    : new InMemoryStorage();

  const emailPort = env.email.resendApiKey
    ? new ResendEmailAdapter({
        apiKey: env.email.resendApiKey,
        defaultFrom: env.email.from,
      })
    : new MemoryEmailAdapter();

  return {
    env,
    pg,
    storage,
    emailPort,
  };
}

export function registerHandlers(
  pool: Pool,
  runner: JobRunner,
  deps: HandlerDeps | undefined,
): void {
  switch (pool) {
    case "media": {
      if (deps === undefined || deps.pg === undefined) break;
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
      // `payment.webhook_process` has no producer: P3-05 processes the webhook synchronously in the
      // API (docs/BACKEND/08 allows it "if it's fast enough"; ADR-077), so the provider gets its
      // answer only after the transaction committed or rolled back.
      // P3-12: cache.invalidate
      runner.register(
        "cache.invalidate",
        makeCacheInvalidateHandler({ redis: runner.redis }),
      );

      // P4-06: notification.send
      if (deps !== undefined && deps.pg !== undefined) {
        runner.register(
          "notification.send",
          makeNotificationSendHandler({
            pg: deps.pg,
            emailPort: deps.emailPort,
            env: deps.env,
          }),
        );
      }
      break;

    case "cron": {
      // `order_expire_check`, `payment_reconciliation`, `invitation_expiry_check`, and `invitation_soft_delete_cleanup`
      // are consumed by the API's jobs process (ADR-078): they change orders, payments, and invitations
      // through the API's services. Never register them here — two consumers would run two different
      // implementations of one rule.
      if (deps === undefined || deps.pg === undefined) break;
      runner.register(
        "media_cleanup_staging",
        makeCleanupStagingHandler({
          repository: new MediaRepository(deps.pg),
          storage: deps.storage,
        }),
      );
      break;
    }
  }

  logger.debug({ context: { pool } }, "handlers registered");
}
