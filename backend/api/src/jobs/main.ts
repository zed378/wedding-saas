import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { Worker } from "bullmq";

import { AppModule } from "../app.module";
import { ConfigValidationError, loadEnv } from "../config/env.schema";
import { SecretRuleError } from "../config/secret-rules";
import { logger } from "../shared/logging/logger";
import { DOMAIN_JOBS } from "./domain-jobs";

/**
 * `P3-06`, ADR-078 — the API's jobs process: `node dist/jobs/main.js`.
 *
 * Same image, same configuration and same modules as the API, but no HTTP server
 * (`docs/ARCHITECTURE/07`: workers run separately from the main API process). It consumes the cron
 * queues listed in `DOMAIN_JOBS`; `worker-cron` puts the jobs there on schedule.
 *
 * Concurrency 1 per job: these are sweeps, and two copies of one sweep racing each other buy nothing.
 * A failed run is logged at `error` and the next scheduled run tries again — every domain job is
 * written to be safe to repeat.
 */
async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    if (
      error instanceof ConfigValidationError ||
      error instanceof SecretRuleError
    ) {
      console.error(error.message);
      return process.exit(78);
    }
    throw error;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  const workers = Object.entries(DOMAIN_JOBS).map(
    ([name, run]) =>
      new Worker(
        name,
        async (job) => {
          const started = Date.now();
          logger.info({ context: { job_name: name } }, "job started");
          try {
            // The worker's envelope (`JobEnvelope`): the payload is under `data`.
            const envelope = job.data as {
              data?: Record<string, unknown>;
            } | null;
            const result = await run(app, envelope?.data ?? {});
            logger.info(
              {
                context: {
                  job_name: name,
                  status: "success",
                  duration_ms: Date.now() - started,
                  result: result ?? null,
                },
              },
              "job finished",
            );
          } catch (error) {
            logger.error(
              {
                context: {
                  job_name: name,
                  status: "failed",
                  duration_ms: Date.now() - started,
                  error_message:
                    error instanceof Error ? error.message : "unknown",
                },
              },
              "job failed",
            );
            throw error;
          }
        },
        { connection: { url: env.REDIS_URL }, concurrency: 1 },
      ),
  );

  logger.info(
    { context: { jobs: Object.keys(DOMAIN_JOBS) } },
    "api jobs process started",
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ context: { signal } }, "api jobs process shutting down");
    await Promise.all(workers.map((worker) => worker.close()));
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main();
