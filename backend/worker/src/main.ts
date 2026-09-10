import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";

import { CRON_JOBS, CRON_TIMEZONE, jobsForPool, type Pool } from "./jobs.js";
import { JobRunner } from "./runner.js";
import { LeaderElection } from "./leader-election.js";
import { logger } from "./logger.js";
import { registerHandlers } from "./handlers/index.js";

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

function redisUrl(): string {
  const url = process.env["REDIS_URL"];
  if (url === undefined || url.length === 0) {
    console.error("REDIS_URL is required. See .env.example.");
    process.exit(78);
  }
  return url;
}

async function main(): Promise<void> {
  const pool = parsePool();
  const url = redisUrl();

  // BullMQ requires this; without it a blocking command that fails is retried forever
  // instead of surfacing.
  const redis = new IORedis(url, { maxRetriesPerRequest: null });
  const connection = { url } as const;

  const runner = new JobRunner({ pool, connection, redis });
  registerHandlers(pool, runner);
  runner.start();

  let election: LeaderElection | undefined;
  let scheduler: Queue | undefined;

  if (pool === "cron") {
    // Scheduled jobs are registered only while this instance holds leadership, and
    // removed when it loses it. A follower therefore holds no schedules at all --
    // rather than holding them and declining to act, which is one forgotten check away
    // from every couple receiving two reminder emails.
    scheduler = new Queue("cron-scheduler", { connection });
    election = new LeaderElection(redis);

    await election.start({
      onGain: () => void registerSchedules(scheduler!),
      onLose: () => void removeSchedules(scheduler!),
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
    await scheduler?.close();
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
async function registerSchedules(scheduler: Queue): Promise<void> {
  for (const job of Object.values(CRON_JOBS)) {
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

async function removeSchedules(scheduler: Queue): Promise<void> {
  const schedulers = await scheduler.getJobSchedulers();
  await Promise.all(
    schedulers.map((s) =>
      s.key !== undefined ? scheduler.removeJobScheduler(s.key) : undefined,
    ),
  );
  logger.warn(
    { context: { count: schedulers.length } },
    "cron schedules removed",
  );
}

main().catch((error: unknown) => {
  logger.error(
    { context: { error_message: String(error) } },
    "worker failed to start",
  );
  process.exit(1);
});
