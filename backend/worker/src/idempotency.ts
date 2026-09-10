import type { Redis } from "ioredis";

/**
 * The idempotency guard. `docs/BACKEND/08` § Idempotency Pattern.
 *
 * The document's shape is:
 *
 *     if (await checkIdempotencyKey(key)) return;   // a safe no-op
 *     await doWork(data);
 *     await markProcessed(key);
 *
 * That is correct in spirit and racy as written: two workers can both pass the check
 * before either marks, and both do the work. For a payment webhook that means crediting
 * an order twice; for media processing it means two transforms of the same file, which
 * is merely wasteful. The first one matters.
 *
 * So the check and the claim are ONE operation -- `SET key value NX` -- which Redis
 * makes atomic. Whoever sets it runs the job; everyone else no-ops.
 *
 * That inverts the failure mode, and the inversion has to be handled rather than
 * ignored: claiming *before* the work means a crash mid-job leaves a key marking work
 * that never completed, and the retry would skip it. The claim therefore holds a short
 * lease which is only made durable once the job succeeds. A crash lets the lease lapse
 * and the retry proceeds; a success extends it to the full retention window.
 */

export interface IdempotencyResult {
  /** True when this caller claimed the key and should do the work. */
  readonly claimed: boolean;
  /** Set when a previous run already completed. */
  readonly alreadyProcessed: boolean;
}

/** How long a claim survives if the worker dies mid-job. */
const LEASE_SECONDS = 15 * 60;

/**
 * How long a completed key is remembered.
 *
 * 24 hours covers every retry window in `docs/ARCHITECTURE/07` -- the longest is five
 * exponential attempts -- with a wide margin for a provider that retries a webhook the
 * next morning. Longer would be safer and would also mean keeping a key per job forever
 * in the same Redis that serves the cache and the rate limiter.
 */
const COMPLETED_SECONDS = 24 * 60 * 60;

const CLAIMED = "claimed";
const DONE = "done";

function key(jobName: string, idempotencyKey: string): string {
  return `idem:${jobName}:${idempotencyKey}`;
}

/**
 * Claim the right to run this job, or discover someone already has.
 *
 * Returns `{claimed: true}` for exactly one caller per key, until the lease lapses.
 */
export async function claim(
  redis: Redis,
  jobName: string,
  idempotencyKey: string,
): Promise<IdempotencyResult> {
  const k = key(jobName, idempotencyKey);

  // SET ... NX EX -- atomic. The whole point: a separate GET then SET is two round
  // trips with a window between them, and a webhook provider retrying inside that
  // window is not a rare event, it is the normal one.
  const won = await redis.set(k, CLAIMED, "EX", LEASE_SECONDS, "NX");

  if (won === "OK") return { claimed: true, alreadyProcessed: false };

  const existing = await redis.get(k);
  return { claimed: false, alreadyProcessed: existing === DONE };
}

/**
 * Mark the work as genuinely finished.
 *
 * Only now is the key durable for the full window. Before this, a crash lets the lease
 * expire and a retry re-runs the job -- which is the correct behaviour, because the work
 * did not happen.
 */
export async function markProcessed(
  redis: Redis,
  jobName: string,
  idempotencyKey: string,
): Promise<void> {
  await redis.set(key(jobName, idempotencyKey), DONE, "EX", COMPLETED_SECONDS);
}

/**
 * Release a claim after a failure, so the retry is not blocked by its own predecessor.
 *
 * Without this a failed attempt would hold the lease for fifteen minutes and every retry
 * inside that window would no-op -- turning "retry 3 times" into "try once, then skip
 * twice and dead-letter", which looks exactly like the job failing three times.
 */
export async function release(
  redis: Redis,
  jobName: string,
  idempotencyKey: string,
): Promise<void> {
  const k = key(jobName, idempotencyKey);
  // Only release our own claim. If the value is DONE, a concurrent run completed the
  // work and deleting the key would let a later replay do it again.
  const current = await redis.get(k);
  if (current === CLAIMED) await redis.del(k);
}
