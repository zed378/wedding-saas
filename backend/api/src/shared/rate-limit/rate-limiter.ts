import type { Redis } from "ioredis";

import { logSecurityEvent, logger } from "../logging/logger";
import {
  blockDurationSeconds,
  STRIKE_TTL_SECONDS,
  type RateLimitPolicy,
} from "./policies";

/**
 * P1-07 — a sliding-window limiter in Redis.
 *
 * ## Why a sliding window and not a fixed one
 *
 * A fixed window resets on a clock boundary, so an attacker spends the whole allowance in
 * the last second of one window and the whole allowance in the first second of the next.
 * For `5 failed logins / 15 minutes` that is **10 attempts in two seconds**, which is not
 * what the document asked for and is exactly the burst the limit exists to stop.
 *
 * The window here is a sorted set of attempt timestamps. Every check drops the entries
 * older than the window and counts what is left, so the limit holds across every instant
 * rather than between boundaries.
 *
 * ## Why it is one Lua script
 *
 * Trim, count, and add have to happen together. Done as three round trips, two concurrent
 * requests both read a count of 4, both decide they are under a limit of 5, and both add
 * — the limit is 5 and 6 got through. Redis runs a script atomically, so the read and the
 * write cannot be interleaved.
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Unix seconds at which a slot frees up. `X-RateLimit-Reset`. */
  readonly resetAt: number;
  /** Set when refused, for `Retry-After`. */
  readonly retryAfterSeconds?: number;
  /** True when a temporary block is in force rather than the window being full. */
  readonly blocked?: boolean;
}

/**
 * Check and consume in one atomic step.
 *
 * KEYS[1] the window, ARGV[1] now (ms), ARGV[2] window (ms), ARGV[3] limit,
 * ARGV[4] a unique member, ARGV[5] whether to consume.
 *
 * Returns { allowed, count, oldestMs }. The script decides `allowed` rather than the
 * caller reconstructing it from the count, because the count alone is ambiguous: at the
 * limit it means both "this one just filled the last slot" and "this one was turned
 * away".
 */
const WINDOW_SCRIPT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local consume = ARGV[5] == '1'

-- Drop everything that has aged out. This is what makes the window slide.
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)

local count = redis.call('ZCARD', KEYS[1])

-- The DECISION is made here, not by the caller. Deriving it from the returned count was
-- the first version and it was wrong: when the add is skipped the count stays AT the
-- limit, so a caller testing \`count > limit\` never refuses anything. Six tests caught it.
local allowed = count < limit

if allowed and consume then
  redis.call('ZADD', KEYS[1], now, member)
  count = count + 1
end

-- The oldest surviving entry decides when a slot frees up.
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local oldestMs = 0
if oldest[2] then oldestMs = tonumber(oldest[2]) end

-- Expire the key itself, so an address seen once does not live in Redis forever.
redis.call('PEXPIRE', KEYS[1], window)

return { allowed and 1 or 0, count, oldestMs }
`;
/** Injection token for the limiter's own Redis connection. See `rate-limit.module.ts`. */
export const RATE_LIMIT_REDIS = Symbol("RATE_LIMIT_REDIS");

/** Raised when a fail-closed policy cannot reach Redis. Mapped to 503, never 429. */
export class RateLimiterUnavailableError extends Error {
  constructor(readonly policyName: string) {
    super("The rate limiter is unavailable.");
    this.name = "RateLimiterUnavailableError";
  }
}

let counter = 0;

export class RateLimiter {
  constructor(private readonly redis: Redis) {}

  private windowKey(policy: RateLimitPolicy, key: string): string {
    return `rl:${policy.name}:${key}`;
  }

  private blockKey(policy: RateLimitPolicy, key: string): string {
    return `rl:block:${policy.name}:${key}`;
  }

  private strikeKey(policy: RateLimitPolicy, key: string): string {
    return `rl:strikes:${policy.name}:${key}`;
  }

  /**
   * Is this request allowed, and does it count?
   *
   * `consume: false` for `onFailureOnly` policies -- the guard asks whether the caller is
   * already over budget, and the service calls `recordFailure` afterwards if the attempt
   * failed. The guard runs before the attempt and cannot know its outcome.
   */
  async check(
    policy: RateLimitPolicy,
    key: string,
    options: { consume?: boolean } = {},
  ): Promise<RateLimitDecision> {
    const consume = options.consume ?? !policy.onFailureOnly;
    const now = Date.now();

    try {
      // A block short-circuits everything. A blocked key does not get its window checked,
      // and does not accumulate further strikes for the same offence.
      const blockedUntil = await this.redis.pttl(this.blockKey(policy, key));
      if (blockedUntil > 0) {
        return {
          allowed: false,
          blocked: true,
          limit: policy.limit,
          remaining: 0,
          resetAt: Math.ceil((now + blockedUntil) / 1000),
          retryAfterSeconds: Math.ceil(blockedUntil / 1000),
        };
      }

      const [allowedFlag, count, oldestMs] = (await this.redis.eval(
        WINDOW_SCRIPT,
        1,
        this.windowKey(policy, key),
        String(now),
        String(policy.windowSeconds * 1000),
        String(policy.limit),
        `${now}-${(counter += 1)}`,
        consume ? "1" : "0",
      )) as [number, number, number];

      const windowMs = policy.windowSeconds * 1000;
      // When nothing is stored, the window is empty and a slot is available now.
      const resetMs = oldestMs > 0 ? oldestMs + windowMs : now;
      const remaining = Math.max(0, policy.limit - count);

      if (allowedFlag !== 1) {
        return {
          allowed: false,
          limit: policy.limit,
          remaining: 0,
          resetAt: Math.ceil(resetMs / 1000),
          retryAfterSeconds: Math.max(1, Math.ceil((resetMs - now) / 1000)),
        };
      }

      return {
        allowed: true,
        limit: policy.limit,
        remaining,
        resetAt: Math.ceil(resetMs / 1000),
      };
    } catch (error) {
      return this.onRedisFailure(policy, error);
    }
  }

  /**
   * Count a failed attempt against an `onFailureOnly` policy.
   *
   * Called by the service, after the attempt, because only the service knows the outcome.
   * A failure to record must never fail the request -- the caller has already been told
   * their password was wrong, and a Redis blip should not turn that into a 500.
   */
  async recordFailure(policy: RateLimitPolicy, key: string): Promise<void> {
    try {
      await this.check(policy, key, { consume: true });
    } catch (error) {
      logger.warn(
        {
          context: {
            event: "rate_limit.record_failed",
            policy: policy.name,
            reason: error instanceof Error ? error.name : "unknown",
          },
        },
        "could not record a rate-limited failure",
      );
    }
  }

  /**
   * Place an escalating temporary block. `docs/SECURITY/10` § Monitoring & Auto-block.
   *
   * Each block earns a strike; strikes expire after a day so an occasional offender is
   * not treated as a persistent one. The duration doubles per strike, capped at 24 hours
   * — past that it should be an admin looking at it, not an algorithm.
   */
  async block(policy: RateLimitPolicy, key: string): Promise<number> {
    try {
      const strike = await this.redis.incr(this.strikeKey(policy, key));
      await this.redis.expire(this.strikeKey(policy, key), STRIKE_TTL_SECONDS);

      const seconds = blockDurationSeconds(strike);
      await this.redis.set(
        this.blockKey(policy, key),
        String(strike),
        "EX",
        seconds,
      );

      // A single 429 is a fat-fingered password. A BLOCK is a pattern, and this is the
      // event `docs/DEVOPS/07`'s brute-force alert is meant to fire on.
      logSecurityEvent("auth.login_failed", {
        event_detail: "rate_limit_block",
        policy: policy.name,
        strike,
        block_seconds: seconds,
      });

      return seconds;
    } catch {
      // A block that could not be written is a block that does not exist. Saying so is
      // better than pretending -- the caller uses this only for the Retry-After hint.
      return 0;
    }
  }

  /** How many strikes a key currently carries. For tests and for an admin view later. */
  async strikes(policy: RateLimitPolicy, key: string): Promise<number> {
    const value = await this.redis.get(this.strikeKey(policy, key));
    return value === null ? 0 : Number(value);
  }

  /**
   * ADR-050. The decision the card's step 5 asks to be made and recorded.
   *
   * Fail **closed** for credential endpoints: unlimited attempts against a live user
   * table is a credential-stuffing window, and no amount of availability is worth it.
   *
   * Fail **open** for everything else: throttling protects capacity, and refusing every
   * request because the *limiter* is unreachable converts a degraded dependency into a
   * total outage. The traffic being protected against is hypothetical; the outage is real.
   */
  private onRedisFailure(
    policy: RateLimitPolicy,
    error: unknown,
  ): RateLimitDecision {
    if (policy.failClosed === true) {
      logger.error(
        {
          context: {
            event: "rate_limit.unavailable",
            policy: policy.name,
            action: "fail_closed",
            reason: error instanceof Error ? error.name : "unknown",
          },
        },
        "rate limiter unavailable; refusing a credential endpoint",
      );
      throw new RateLimiterUnavailableError(policy.name);
    }

    // Loudly, per the card: a limiter that is silently off is the same as no limiter.
    logger.error(
      {
        context: {
          event: "rate_limit.unavailable",
          policy: policy.name,
          action: "fail_open",
          reason: error instanceof Error ? error.name : "unknown",
        },
      },
      "rate limiter unavailable; allowing traffic unthrottled",
    );

    return {
      allowed: true,
      limit: policy.limit,
      remaining: policy.limit,
      resetAt: Math.ceil(Date.now() / 1000) + policy.windowSeconds,
    };
  }
}
