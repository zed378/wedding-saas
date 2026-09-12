import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Redis } from "ioredis";
import { Queue } from "bullmq";

import {
  JobRunner,
  DLQ_NAME,
  deadLetterDepth,
  type JobPayload,
} from "../src/runner.js";
import { LeaderElection } from "../src/leader-election.js";
import { claim, markProcessed, release } from "../src/idempotency.js";
import { policyFor } from "../src/jobs.js";
import { makeExampleHandler } from "../src/handlers/example.js";

/**
 * P0-15 — the queue, against a real Redis.
 *
 * Everything the DoD asks for is a claim about behaviour under concurrency or failure:
 * "a job replayed with the same key does its work once", "a permanently failing job
 * reaches the DLQ", "two cron instances execute a scheduled job once". A mocked queue
 * would confirm the calls happen in the right order and prove none of it.
 *
 * Fails rather than skips when Redis is missing, for the same reason the API's schema
 * suites do.
 */

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
/** A dedicated database, so a test run cannot disturb the developer's cache. */
const TEST_DB = 9;

let redis: Redis;
let connection: { url: string };

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Poll until `check` is true, or fail with a message worth reading. */
async function until(
  check: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for: ${what}`);
}

beforeAll(async () => {
  const url = new URL(REDIS_URL);
  url.pathname = `/${TEST_DB}`;
  connection = { url: url.toString() };

  redis = new Redis(connection.url, { maxRetriesPerRequest: null });
  try {
    await redis.ping();
  } catch (cause) {
    throw new Error(
      [
        `Cannot reach Redis at ${REDIS_URL}`,
        "",
        "These tests do not skip when Redis is missing, on purpose: a queue suite that",
        "skips reports green for retry, dead-lettering and leader election that nobody",
        "verified.",
        "",
        "  docker compose -f deploy/docker-compose.yml up -d redis",
        "",
      ].join("\n"),
      { cause },
    );
  }
});

afterAll(async () => {
  await redis?.flushdb();
  await redis?.quit();
});

beforeEach(async () => {
  await redis.flushdb();
});

describe("idempotency", () => {
  it("lets exactly one caller claim a key", async () => {
    const key = uniq();

    // Concurrent, not sequential. The document's check-then-mark shape passes a
    // sequential test and fails this one: both callers pass the check before either
    // marks. SET NX is what makes it one operation.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => claim(redis, "test.job", key)),
    );

    expect(results.filter((r) => r.claimed)).toHaveLength(1);
  });

  it("reports a completed key as already processed", async () => {
    const key = uniq();
    await claim(redis, "test.job", key);
    await markProcessed(redis, "test.job", key);

    const second = await claim(redis, "test.job", key);
    expect(second).toEqual({ claimed: false, alreadyProcessed: true });
  });

  it("distinguishes in-progress from completed", async () => {
    // Different answers matter for the log: "skipped, already done" is normal, while a
    // rise in "skipped, in progress" means something is enqueuing duplicates fast.
    const key = uniq();
    await claim(redis, "test.job", key);

    const second = await claim(redis, "test.job", key);
    expect(second).toEqual({ claimed: false, alreadyProcessed: false });
  });

  it("releases a failed claim so the retry is not blocked by its predecessor", async () => {
    // Without release, "retry 3 times" becomes "try once, then skip twice" -- which
    // looks identical to three genuine failures and dead-letters just as fast.
    const key = uniq();
    await claim(redis, "test.job", key);
    await release(redis, "test.job", key);

    expect((await claim(redis, "test.job", key)).claimed).toBe(true);
  });

  it("does not release a claim that has already completed", async () => {
    // Deleting a DONE key would let a later replay do the work a second time.
    const key = uniq();
    await claim(redis, "test.job", key);
    await markProcessed(redis, "test.job", key);
    await release(redis, "test.job", key);

    expect(await claim(redis, "test.job", key)).toEqual({
      claimed: false,
      alreadyProcessed: true,
    });
  });

  it("scopes keys by job name", async () => {
    const key = uniq();
    await claim(redis, "job.a", key);
    expect((await claim(redis, "job.b", key)).claimed).toBe(true);
  });
});

describe("the runner, end to end", () => {
  let runner: JobRunner;
  let queue: Queue;

  afterAll(async () => {
    await runner?.stop();
    await queue?.close();
  });

  it("does the work once when a job is replayed with the same key", async () => {
    // The DoD item. Two enqueues, one idempotency key, one execution.
    const example = makeExampleHandler();
    runner = new JobRunner({ pool: "general", connection, redis });
    runner.register("cache.invalidate", example.handler);
    runner.start();

    queue = new Queue("cache.invalidate", { connection });
    const key = uniq();
    const payload: JobPayload<{ message: string }> = {
      idempotencyKey: key,
      data: { message: "invalidate" },
    };

    await queue.add("cache.invalidate", payload);
    await until(() => example.runs() === 1, "the first run to complete");

    await queue.add("cache.invalidate", payload);
    // Wait long enough that a second execution would have happened.
    await new Promise((r) => setTimeout(r, 1_500));

    expect(example.runs()).toBe(1);
  });
});

describe("retry and dead-lettering", () => {
  it("retries the configured number of times, then dead-letters", async () => {
    // The other DoD item, and the reason this suite needs a real queue: the retry count
    // is BullMQ's behaviour, not ours, and asserting it against a mock would only test
    // the mock.
    const example = makeExampleHandler();
    const runner = new JobRunner({ pool: "general", connection, redis });
    runner.register("notification.send", example.handler);
    runner.start();

    const queue = new Queue("notification.send", { connection });
    const policy = policyFor("notification.send");

    await queue.add(
      "notification.send",
      { data: { message: "will fail", failTimes: 99 } },
      { attempts: policy.attempts, backoff: { type: "fixed", delay: 50 } },
    );

    await until(
      async () => (await deadLetterDepth(connection)) > 0,
      "the job to dead-letter",
      20_000,
    );

    // Exactly the configured attempts -- not one more, not one fewer.
    expect(example.runs()).toBe(policy.attempts);

    const dlq = new Queue(DLQ_NAME, { connection });
    const [entry] = await dlq.getJobs([
      "waiting",
      "delayed",
      "completed",
      "active",
    ]);
    expect(entry?.data).toMatchObject({
      job_name: "notification.send",
      priority: "medium",
    });
    // The payload is preserved: a DLQ entry you cannot replay is a tombstone.
    expect(entry?.data.payload).toMatchObject({
      data: { message: "will fail" },
    });
    expect(entry?.data.error_message).toContain("deliberate failure");

    await dlq.close();
    await queue.close();
    await runner.stop();
  });

  it("dead-letters once, not once per attempt", async () => {
    // `failed` fires on every attempt. Dead-lettering on each would produce three
    // entries for one job and fire the on-call alert twice before the job gave up.
    const example = makeExampleHandler();
    const runner = new JobRunner({ pool: "general", connection, redis });
    runner.register("cache.invalidate", example.handler);
    runner.start();

    const queue = new Queue("cache.invalidate", { connection });
    const policy = policyFor("cache.invalidate");

    await queue.add(
      "cache.invalidate",
      { data: { message: "fails", failTimes: 99 } },
      { attempts: policy.attempts, backoff: { type: "fixed", delay: 50 } },
    );

    await until(
      async () => (await deadLetterDepth(connection)) > 0,
      "a dead-letter entry",
      20_000,
    );
    await new Promise((r) => setTimeout(r, 1_000));

    expect(await deadLetterDepth(connection)).toBe(1);

    await queue.close();
    await runner.stop();
  });

  it("succeeds on a retry without dead-lettering", async () => {
    // A job that fails once and then works must NOT reach the DLQ. Otherwise every
    // transient blip pages someone.
    const example = makeExampleHandler();
    const runner = new JobRunner({ pool: "general", connection, redis });
    runner.register("cache.invalidate", example.handler);
    runner.start();

    const queue = new Queue("cache.invalidate", { connection });
    await queue.add(
      "cache.invalidate",
      { data: { message: "transient", failTimes: 1 } },
      { attempts: 3, backoff: { type: "fixed", delay: 50 } },
    );

    await until(() => example.runs() >= 2, "the retry to succeed");
    await new Promise((r) => setTimeout(r, 500));

    expect(await deadLetterDepth(connection)).toBe(0);

    await queue.close();
    await runner.stop();
  });

  it("still retries the full number of times when the job HAS an idempotency key", async () => {
    // The case that matters for payment webhooks, and the one the other retry test
    // does not cover: with a key, a failed attempt holds a claim. If the claim is not
    // released on failure, every retry no-ops and the job dead-letters after ONE real
    // execution -- which looks identical to three genuine failures in every log line.
    const example = makeExampleHandler();
    const runner = new JobRunner({ pool: "general", connection, redis });
    runner.register("payment.webhook_process", example.handler);
    runner.start();

    const queue = new Queue("payment.webhook_process", { connection });
    await queue.add(
      "payment.webhook_process",
      { idempotencyKey: uniq(), data: { message: "flaky", failTimes: 2 } },
      { attempts: 5, backoff: { type: "fixed", delay: 50 } },
    );

    // Fails twice, succeeds on the third. If release() were missing this would stall
    // at 1 and the assertion would time out.
    await until(
      () => example.runs() >= 3,
      "the third attempt to run and succeed",
      20_000,
    );
    await new Promise((r) => setTimeout(r, 500));

    expect(example.runs()).toBe(3);
    expect(await deadLetterDepth(connection)).toBe(0);

    await queue.close();
    await runner.stop();
  });

  it("refuses to register a job belonging to another pool", () => {
    // media.process on the general pool would put CPU-heavy work on the pool that has
    // no resource caps -- one crafted image starving email delivery.
    const runner = new JobRunner({ pool: "general", connection, redis });
    expect(() => runner.register("media.process", async () => {})).toThrow(
      /media pool/,
    );
  });
});

describe("cron leader election", () => {
  it("elects exactly one leader among several instances", async () => {
    // The DoD item. Two instances, one execution.
    const instances = [
      new LeaderElection(redis, { ttlMs: 3_000 }),
      new LeaderElection(redis, { ttlMs: 3_000 }),
      new LeaderElection(redis, { ttlMs: 3_000 }),
    ];

    const gained: string[] = [];
    await Promise.all(
      instances.map((e) =>
        e.start({ onGain: () => gained.push(e.instanceId), onLose: () => {} }),
      ),
    );

    expect(instances.filter((e) => e.isLeader)).toHaveLength(1);
    expect(gained).toHaveLength(1);

    await Promise.all(instances.map((e) => e.stop()));
  });

  it("hands leadership to another instance when the leader stops", async () => {
    // A rolling update. Without an explicit release on shutdown the cron pool is
    // leaderless for a full lease -- and if that window spans 00:05 WIB, the expiry
    // sweep simply does not run that night.
    const first = new LeaderElection(redis, {
      ttlMs: 2_000,
      renewIntervalMs: 200,
    });
    const second = new LeaderElection(redis, {
      ttlMs: 2_000,
      renewIntervalMs: 200,
    });

    await first.start({ onGain: () => {}, onLose: () => {} });
    await second.start({ onGain: () => {}, onLose: () => {} });

    expect(first.isLeader).toBe(true);
    expect(second.isLeader).toBe(false);

    await first.stop();
    await until(
      () => second.isLeader,
      "the second instance to take over",
      5_000,
    );

    await second.stop();
  });

  it("registers each schedule once even when leadership changes", async () => {
    // A stable scheduler id, so re-registering replaces rather than duplicates. A
    // second copy of the schedule would be the double execution this file exists to
    // prevent, arriving through the mechanism meant to stop it.
    const scheduler = new Queue("cron-scheduler-test", { connection });

    for (let round = 0; round < 3; round += 1) {
      await scheduler.upsertJobScheduler(
        "schedule:invitation_expiry_check",
        { pattern: "5 0 * * *", tz: "Asia/Jakarta" },
        { name: "invitation_expiry_check", data: { data: {} } },
      );
    }

    expect(await scheduler.getJobSchedulersCount()).toBe(1);
    await scheduler.close();
  });
});

describe("the producer/consumer contract (P1-18)", () => {
  /**
   * The seam this suite exists to pin.
   *
   * Until `P1-18` the API added jobs to a queue named after the **pool** while `JobRunner`
   * created one `new Worker(jobName)` per job — so every job the API ever enqueued landed
   * in a queue nobody consumed, and nothing noticed because no handler had been registered.
   * `P1-02`'s eight `notification.send` calls had been going nowhere for six tasks.
   *
   * Two facts hold the two halves together, and each half has a test:
   *
   *   **the queue name is the job name** — asserted here and in `queue.spec.ts` on the API;
   *   **the payload is the `JobPayload` envelope** — likewise.
   *
   * This is the consumer's half. It enqueues the way `QueueModule.enqueue` does, by hand,
   * because the worker cannot import the API. That is the weakness of the arrangement and
   * the reason the shape wants to live in a package (`P4-06`).
   */
  it("a job enqueued the way the API enqueues it reaches the handler", async () => {
    const seen: unknown[] = [];
    const runner = new JobRunner({ pool: "media", connection, redis });

    runner.register("media.process", async (data: unknown) => {
      seen.push(data);
    });
    runner.start();

    // Exactly what `QueueModule.enqueue("media", "media.process", { mediaId })` produces:
    // a queue named after the JOB, and the data wrapped in the envelope.
    const queue = new Queue("media.process", { connection });
    await queue.add("media.process", {
      data: { mediaId: "abc" },
      idempotencyKey: `media.process:abc-${uniq()}`,
      relatedId: "invitation-1",
      trace: { enqueued_at: new Date().toISOString() },
    } satisfies JobPayload);

    await until(() => seen.length === 1, "the handler to receive the job");

    // The handler gets `data`, unwrapped. A handler reading `job.data` directly would see
    // the envelope and quietly do nothing useful with it.
    expect(seen[0]).toEqual({ mediaId: "abc" });

    await queue.close();
    await runner.stop();
  });

  it("a job addressed to the POOL is never delivered", async () => {
    // The old bug, asserted as a bug. If this ever starts passing, the two halves have
    // drifted back apart and the symptom will be jobs that vanish rather than fail.
    const seen: unknown[] = [];
    const runner = new JobRunner({ pool: "media", connection, redis });
    runner.register("media.process", async (data: unknown) => {
      seen.push(data);
    });
    runner.start();

    const wrong = new Queue("media", { connection });
    await wrong.add("media.process", { data: { mediaId: "abc" } });

    await new Promise((r) => setTimeout(r, 1_000));
    expect(seen).toEqual([]);

    await wrong.close();
    await runner.stop();
  });
});
