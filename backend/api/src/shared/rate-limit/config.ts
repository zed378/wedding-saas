import type { Redis } from "ioredis";

import { logger } from "../logging/logger";
import { DEFAULT_POLICIES, type RateLimitPolicy } from "./policies";

/**
 * P1-07 — where the numbers come from.
 *
 * `docs/SECURITY/10`: "The limits above are an initial baseline — to be adjusted based on
 * real traffic data post-launch, and are configurable (not hard-coded) for easy tuning."
 * The card's DoD sharpens that to "configurable **without a deploy**".
 *
 * Three layers, cheapest to change last:
 *
 *   1. `DEFAULT_POLICIES` — the document's table, transcribed. A deploy to change.
 *   2. `RATE_LIMIT_OVERRIDES` — a JSON environment variable. A restart to change.
 *   3. **`rl:config`, a Redis hash, re-read every 30 seconds.** No restart, no deploy:
 *      `HSET rl:config login '{"limit":20}'` and it is in force within half a minute.
 *
 * Layer 3 is the one that satisfies the DoD. Layers 1 and 2 exist because a limiter whose
 * only source of truth is a mutable runtime key is a limiter that silently stops existing
 * when somebody flushes Redis.
 *
 * ## A bad override is ignored, never applied
 *
 * An override that does not parse, or that asks for a negative limit, is dropped with a
 * log line and the layer below stands. The alternative — treating a malformed value as
 * "no limit" — means a typo during a tuning change removes a security control, at exactly
 * the moment somebody is distracted by traffic.
 */

export const CONFIG_HASH_KEY = "rl:config";
const REFRESH_MS = 30_000;

interface PolicyOverride {
  readonly limit?: number;
  readonly windowSeconds?: number;
}

function parseOverride(name: string, raw: string): PolicyOverride | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn(
      { context: { event: "rate_limit.bad_override", policy: name } },
      "rate limit override is not valid JSON; ignoring it",
    );
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null) return undefined;

  const { limit, windowSeconds } = parsed as PolicyOverride;
  const valid = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && n > 0;

  const override: PolicyOverride = {
    ...(valid(limit) ? { limit } : {}),
    ...(valid(windowSeconds) ? { windowSeconds } : {}),
  };

  if (Object.keys(override).length === 0) {
    logger.warn(
      { context: { event: "rate_limit.bad_override", policy: name } },
      "rate limit override had no usable fields; ignoring it",
    );
    return undefined;
  }

  return override;
}

/** Parse `RATE_LIMIT_OVERRIDES`. Shaped `{"login":{"limit":20}}`. */
export function parseEnvOverrides(
  raw: string | undefined,
): Map<string, PolicyOverride> {
  const result = new Map<string, PolicyOverride>();
  if (raw === undefined || raw.trim().length === 0) return result;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.error(
      { context: { event: "rate_limit.bad_override", source: "env" } },
      "RATE_LIMIT_OVERRIDES is not valid JSON; using defaults",
    );
    return result;
  }

  if (typeof parsed !== "object" || parsed === null) return result;

  for (const [name, value] of Object.entries(parsed)) {
    const override = parseOverride(name, JSON.stringify(value));
    if (override !== undefined) result.set(name, override);
  }
  return result;
}

function apply(
  policy: RateLimitPolicy,
  override: PolicyOverride | undefined,
): RateLimitPolicy {
  if (override === undefined) return policy;
  return {
    ...policy,
    ...(override.limit !== undefined ? { limit: override.limit } : {}),
    ...(override.windowSeconds !== undefined
      ? { windowSeconds: override.windowSeconds }
      : {}),
  };
}

export class PolicyRegistry {
  private effective = new Map<string, RateLimitPolicy>();
  private lastRefresh = 0;
  private refreshing: Promise<void> | undefined;

  constructor(
    private readonly redis: Redis | undefined,
    envOverridesRaw: string | undefined,
    private readonly base: readonly RateLimitPolicy[] = DEFAULT_POLICIES,
  ) {
    const envOverrides = parseEnvOverrides(envOverridesRaw);
    for (const policy of this.base) {
      this.effective.set(
        policy.name,
        apply(policy, envOverrides.get(policy.name)),
      );
    }
    this.envOverrides = envOverrides;
  }

  private readonly envOverrides: Map<string, PolicyOverride>;

  /**
   * The policy in force right now.
   *
   * Synchronous on purpose: this is called on every request, and an `await` here would
   * put a Redis round trip in front of all of them. The refresh happens in the background
   * and a stale-by-30-seconds limit is not a problem worth a per-request round trip.
   */
  get(name: string): RateLimitPolicy {
    void this.maybeRefresh();

    const policy = this.effective.get(name);
    if (policy === undefined) {
      // A named policy that does not exist is a programming error, and defaulting to
      // "unlimited" would make it an invisible one.
      throw new Error(`Unknown rate limit policy: ${name}`);
    }
    return policy;
  }

  /** Every policy, for tests and for an admin view. */
  all(): RateLimitPolicy[] {
    return [...this.effective.values()];
  }

  /** Force a re-read. Used by tests, which cannot wait 30 seconds. */
  async refresh(): Promise<void> {
    if (this.redis === undefined) return;

    try {
      const raw = await this.redis.hgetall(CONFIG_HASH_KEY);
      const next = new Map<string, RateLimitPolicy>();

      for (const policy of this.base) {
        // Redis wins over env, env wins over the default. A runtime override is the most
        // deliberate of the three -- somebody typed it while watching traffic.
        const fromEnv = apply(policy, this.envOverrides.get(policy.name));
        const rawOverride = raw[policy.name];
        const fromRedis =
          rawOverride === undefined
            ? undefined
            : parseOverride(policy.name, rawOverride);

        next.set(policy.name, apply(fromEnv, fromRedis));
      }

      this.effective = next;
      this.lastRefresh = Date.now();
    } catch (error) {
      // Keep whatever was last known good. Losing Redis must not silently reset the
      // limits to defaults that somebody deliberately changed.
      logger.warn(
        {
          context: {
            event: "rate_limit.config_refresh_failed",
            reason: error instanceof Error ? error.name : "unknown",
          },
        },
        "could not refresh rate limit overrides; keeping the current values",
      );
      this.lastRefresh = Date.now();
    }
  }

  private maybeRefresh(): Promise<void> {
    if (this.redis === undefined) return Promise.resolve();
    if (Date.now() - this.lastRefresh < REFRESH_MS) return Promise.resolve();
    if (this.refreshing !== undefined) return this.refreshing;

    // One refresh at a time, shared. Without this, a burst of requests after the TTL
    // expires each starts its own HGETALL.
    this.refreshing = this.refresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
}
