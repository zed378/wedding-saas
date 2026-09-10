import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";

import { logger } from "./logger.js";

/**
 * Leader election for the cron pool.
 *
 * `docs/BACKEND/08` § Worker Configuration: `worker-cron` is "usually 1 instance with
 * leader-election if multi-instance to avoid duplicate execution of cron jobs".
 *
 * The failure this prevents is quiet and reaches real people. Two cron instances both
 * run `reminder_email_h7_h1` and every couple gets two identical reminders; both run
 * `invitation_expiry_check` and the expiry sweep does its work twice. Nothing errors.
 * The only symptom is a support message weeks later.
 *
 * The Helm chart already refuses to render `cron.replicaCount > 1` (`P0-26`) — this is
 * the belt to that braces. A chart guard protects one deployment path; it does nothing
 * for the compose stack, a stray process on a laptop, or a rolling update that briefly
 * overlaps two pods.
 *
 * ---
 *
 * **What this is not.** This is a lease, not a consensus algorithm. It assumes Redis is
 * a single source of truth and that a leader whose lease lapses stops acting before the
 * next one starts. Under a Redis failover with unsynchronised replicas, two instances
 * can briefly both believe they lead — the well-known limitation of Redlock-style
 * locking. The mitigation that actually matters is the one the documents already
 * require: **every job is idempotent**, so a duplicate run is a no-op rather than a
 * second effect. This reduces duplicate work; idempotency is what makes it safe.
 */

const LEADER_KEY = "worker:cron:leader";

export interface LeaderElectionOptions {
  /** How long a lease survives without renewal. */
  readonly ttlMs?: number;
  /** How often the leader renews, and a follower retries. */
  readonly renewIntervalMs?: number;
}

export class LeaderElection {
  private readonly id = randomUUID();
  private readonly ttlMs: number;
  private readonly renewIntervalMs: number;
  private timer: NodeJS.Timeout | undefined;
  private leading = false;
  private onGain: (() => void) | undefined;
  private onLose: (() => void) | undefined;

  constructor(
    private readonly redis: Redis,
    options: LeaderElectionOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 30_000;
    // Renew at a third of the TTL, so two consecutive renewals can fail -- a GC pause,
    // a slow Redis -- before the lease is genuinely lost. Renewing at the TTL means any
    // hiccup drops leadership.
    this.renewIntervalMs =
      options.renewIntervalMs ?? Math.floor(this.ttlMs / 3);
  }

  get isLeader(): boolean {
    return this.leading;
  }

  get instanceId(): string {
    return this.id;
  }

  /**
   * Try to become leader, and keep trying.
   *
   * `onGain` fires when this instance takes leadership, `onLose` when it drops it.
   * Scheduled jobs are registered on gain and unregistered on loss, so a follower holds
   * no timers at all rather than holding timers it declines to act on.
   */
  async start(callbacks: {
    onGain: () => void;
    onLose: () => void;
  }): Promise<void> {
    this.onGain = callbacks.onGain;
    this.onLose = callbacks.onLose;
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.renewIntervalMs);
    // Do not hold the process open on this timer alone.
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;

    // Release deliberately rather than waiting for the TTL. A rolling update otherwise
    // leaves the cron pool leaderless for up to the full lease -- and if that window
    // spans 00:05 WIB, the expiry sweep simply does not run that day.
    if (this.leading) await this.release();
  }

  private async tick(): Promise<void> {
    try {
      const acquired = await this.acquireOrRenew();

      if (acquired && !this.leading) {
        this.leading = true;
        logger.info({ context: { instance: this.id } }, "became cron leader");
        this.onGain?.();
      } else if (!acquired && this.leading) {
        this.leading = false;
        logger.warn({ context: { instance: this.id } }, "lost cron leadership");
        this.onLose?.();
      }
    } catch (error) {
      // A Redis blip must not leave a former leader believing it still leads while
      // another instance has taken over -- that is exactly the double-execution case.
      // Failing closed means the sweep might be skipped once; failing open means every
      // couple gets two emails.
      if (this.leading) {
        this.leading = false;
        this.onLose?.();
      }
      logger.error(
        { context: { instance: this.id, error_message: String(error) } },
        "leader election tick failed; standing down",
      );
    }
  }

  /**
   * Take the lease if free, extend it if already ours.
   *
   * A Lua script, so check-and-extend is atomic. Two round trips would let another
   * instance take the lease between the read and the write, after which both would
   * believe they lead.
   */
  private async acquireOrRenew(): Promise<boolean> {
    const script = `
      local current = redis.call('GET', KEYS[1])
      if current == false then
        redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
        return 1
      elseif current == ARGV[1] then
        redis.call('PEXPIRE', KEYS[1], ARGV[2])
        return 1
      else
        return 0
      end
    `;
    const result = await this.redis.eval(
      script,
      1,
      LEADER_KEY,
      this.id,
      this.ttlMs,
    );
    return result === 1;
  }

  /** Delete the lease, but only if it is still ours. */
  private async release(): Promise<void> {
    const script = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
    `;
    await this.redis.eval(script, 1, LEADER_KEY, this.id);
    this.leading = false;
  }
}
