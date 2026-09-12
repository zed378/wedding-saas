import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";

import { CRON_JOBS, CRON_TIMEZONE, jobsForPool, type Pool } from "./jobs.js";
import { JobRunner } from "./runner.js";
import { LeaderElection } from "./leader-election.js";
import { logger } from "./logger.js";
import { createHandlerDeps, registerHandlers } from "./handlers/index.js";
import { loadWorkerEnv, WorkerConfigError, type WorkerEnv } from "./env.js";

/**
 * The worker entry point. One process per pool.
 *
 * `docs/ARCHITECTURE/07` § Principles: "Workers run separately from the main API process
 * (independent scaling)" — so this is its own binary, its own container and its own
 * Deployment, not a thread inside the API.
 *
 * `docs/BACKEND/08` § Worker Configuration splits three pools, and the split is not
 * cosmetic. `media` is CPU-bound on hostile input and needs hard resource caps so one
 * crafted image cannot starve anything else; `general` is IO-bound and cheap; `cron` must
 * run as a single logical instance or every scheduled job happens twice.
 *
 *   node dist/main.js --pool media
 */

function parsePool(): Pool {
  const index = process.argv.indexOf("--pool");
  const value =
    index >= 0 ? process.argv[index + 1] : process.env["WORKER_POOL"];

  if (value === "media" || value === "general" || value === "cron")
    return value;

  // No default. A worker started with no pool would silently pick one, and the wrong
  // guess is either "nothing processes media" or "three instances run cron".
  console.error(
    `Missing or invalid pool. Use --pool media|general|cron, or set WORKER_POOL.\n` +
      `Received: ${String(value)}`,
  );
  process.exit(78); // EX_CONFIG, the same code the API uses for a bad environment.
}

async function main(): Promise<void> {
  const pool = parsePool();

  // Validated before anything is constructed, and it exits 78 naming every offending
  // variable -- the same contract the API's `loadEnv` keeps. A media worker missing its
  // scanner should refuse to start, not discover it on the first hostile file.
  let env: WorkerEnv;
  try {
    env = loadWorkerEnv(pool);
  } catch (error) {
    console.error(
      error instanceof WorkerConfigError ? error.message : String(error),
    );
    return process.exit(78);
  }

  if (pool === "media" && env.clamav === undefined) {
    // Loud, at startup, every time. `loadWorkerEnv` has already refused this combination
    // in staging and production; in development it is allowed and must never be quiet.
    logger.warn(
      { context: { pool, event: "media.scan_disabled" } },
      "MALWARE SCANNING IS DISABLED. Uploads will be published without being scanned (docs/SECURITY/06 layer 10)",
    );
  }

  // BullMQ requires this; without it a blocking command that fails is retried forever
  // instead of surfacing.
  const redis = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
  const connection = { url: env.redisUrl } as const;

  // `general` needs no database or bucket today, and building them would demand credentials
  // an email worker has no use for.
  const deps = pool === "general" ? undefined : createHandlerDeps(env);

  const runner = new JobRunner({ pool, connection, redis });
  registerHandlers(pool, runner, deps);
  runner.start();

  let election: LeaderElection | undefined;
  let schedulers: Map<string, Queue> | undefined;

  if (pool === "cron") {
    // Scheduled jobs are registered only while this instance holds leadership, and
    // removed when it loses it. A follower therefore holds no schedules at all --
    // rather than holding them and declining to act, which is one forgotten check away
    // from every couple receiving two reminder emails.
    // One scheduler queue per cron job NAME, for the reason `queue.module.ts` in the API
    // now documents: `JobRunner` creates one `new Worker(jobName)` per registered job, so a
    // schedule that puts its jobs in a queue called `cron-scheduler` puts them where no
    // worker is listening. This was true from `P0-15` until `P1-18` registered the first
    // cron handler and nothing consumed it.
    schedulers = new Map(
      Object.values(CRON_JOBS).map((job) => [
        job.name,
        new Queue(job.name, { connection }),
      ]),
    );
    election = new LeaderElection(redis);

    await election.start({
      onGain: () => void registerSchedules(schedulers!),
      onLose: () => void removeSchedules(schedulers!),
    });
  }

  logger.info(
    {
      context: {
        pool,
        jobs: jobsForPool(pool).map((j) => j.name),
        cron_leader: election?.isLeader ?? null,
      },
    },
    "worker started",
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ context: { signal, pool } }, "worker shutting down");
    // Order matters: stop taking leadership first so another instance can pick up the
    // schedule, then drain in-flight jobs, then close the connection.
    await election?.stop();
    await runner.stop();
    for (const scheduler of schedulers?.values() ?? []) await scheduler.close();
    // A `pg.Pool` that is never ended keeps the process alive past SIGTERM, which turns a
    // rolling deploy into a stuck one.
    await deps?.pg.end();
    await redis.quit();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

/**
 * Install the repeatable schedules from `docs/BACKEND/08`.
 *
 * The timezone is explicit. The documented times are WIB, and a container running in UTC
 * would otherwise fire "daily at 00:05 WIB" at 07:05 WIB — seven hours late, every day,
 * with nothing about it looking wrong.
 */
async function registerSchedules(
  schedulers: Map<string, Queue>,
): Promise<void> {
  for (const job of Object.values(CRON_JOBS)) {
    const scheduler = schedulers.get(job.name)!;
    // upsertJobScheduler, not the `repeat` option: BullMQ 6 replaced repeatable jobs
    // with job schedulers. The scheduler id is stable, so re-registering after a
    // leadership change REPLACES the schedule rather than adding a second copy -- which
    // would be the double-execution this whole file exists to prevent, arriving through
    // the mechanism meant to stop it.
    await scheduler.upsertJobScheduler(
      `schedule:${job.name}`,
      { pattern: job.pattern, tz: CRON_TIMEZONE },
      {
        name: job.name,
        data: { data: {} },
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
  }
  logger.info(
    {
      context: {
        count: Object.keys(CRON_JOBS).length,
        timezone: CRON_TIMEZONE,
      },
    },
    "cron schedules registered",
  );
}

async function removeSchedules(schedulers: Map<string, Queue>): Promise<void> {
  let removed = 0;
  for (const scheduler of schedulers.values()) {
    const existing = await scheduler.getJobSchedulers();
    await Promise.all(
      existing.map((s) =>
        s.key !== undefined ? scheduler.removeJobScheduler(s.key) : undefined,
      ),
    );
    removed += existing.length;
  }
  logger.warn({ context: { count: removed } }, "cron schedules removed");
}

main().catch((error: unknown) => {
  logger.error(
    { context: { error_message: String(error) } },
    "worker failed to start",
  );
  process.exit(1);
});
