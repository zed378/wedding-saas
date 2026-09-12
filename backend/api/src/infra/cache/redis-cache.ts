import type { Redis as IORedis } from "ioredis";

import { logger } from "../../shared/logging/logger";
import type { CachePort } from "./cache.port";

/**
 * P2-01 — the Redis-backed application cache.
 *
 * ## Why invalidation is a generation counter
 *
 * `docs/ARCHITECTURE/06` says template definitions are "invalidated when an admin
 * publishes a new version". The obvious implementation is `SCAN` for `tpl:*` and `DEL`
 * what comes back. Three reasons not to:
 *
 *   1. `SCAN` walks the whole keyspace, and this Redis is shared with rate limiting and
 *      the job queue (ADR-009). A catalog publish should not make every login slower.
 *   2. It is not atomic. A key written between the scan and the delete survives, which is
 *      exactly the key most likely to be written — the one being read constantly.
 *   3. `KEYS` is worse on both counts and is the thing people reach for first.
 *
 * Instead every key carries a generation number read from `cache:gen:{namespace}`:
 *
 *     cache:tpl:7:detail:elegant-rose
 *
 * Invalidating is `INCR cache:gen:tpl` — one round trip, atomic, and every key written
 * under generation 7 becomes unreachable the instant the counter reads 8. The orphans are
 * not deleted; they expire on their own TTL. That costs some memory for an hour and buys
 * an invalidation that cannot partially apply.
 *
 * ## The generation read is itself cached, briefly
 *
 * Reading the counter on every request would double the round trips and put the cache's
 * own bookkeeping on the hot path. It is held for `GENERATION_TTL_MS`, which is the
 * maximum time a reader can keep serving the previous generation after a publish. Ten
 * seconds of staleness on a catalog that changes a few times a year is a trade worth
 * making explicitly rather than by accident — and `invalidateNamespace` clears the local
 * value immediately, so the process that performed the publish never serves stale data
 * to the request that caused it.
 */

/** How long a process may reuse a generation number it has already read. */
const GENERATION_TTL_MS = 10_000;

export class RedisCache implements CachePort {
  readonly #generations = new Map<string, { value: number; readAt: number }>();

  constructor(
    private readonly redis: IORedis,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async getJson<T>(namespace: string, key: string): Promise<T | undefined> {
    try {
      const raw = await this.redis.get(await this.#key(namespace, key));
      if (raw === null) return undefined;
      return JSON.parse(raw) as T;
    } catch (error) {
      // Includes a JSON parse failure, which means something wrote a value this code
      // cannot read. Treating it as a miss is right: the database is authoritative and
      // the bad entry will expire.
      this.#report("cache.read_failed", namespace, error);
      return undefined;
    }
  }

  async setJson(
    namespace: string,
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.set(
        await this.#key(namespace, key),
        JSON.stringify(value),
        "EX",
        ttlSeconds,
      );
    } catch (error) {
      this.#report("cache.write_failed", namespace, error);
    }
  }

  async invalidateNamespace(namespace: string): Promise<number> {
    try {
      const next = await this.redis.incr(generationKey(namespace));
      // Locally too, and immediately: the process that published must not spend the next
      // ten seconds serving the version it just replaced.
      this.#generations.set(namespace, { value: next, readAt: this.now() });
      logger.info(
        {
          context: { event: "cache.invalidated", namespace, generation: next },
        },
        "cache namespace invalidated",
      );
      return next;
    } catch (error) {
      // A failed invalidation is the one failure that is NOT safe to swallow silently:
      // it leaves stale data served until the TTL expires. It still must not throw --
      // the publish itself succeeded -- so it is logged at error and the local value is
      // dropped so at least this process re-reads.
      this.#generations.delete(namespace);
      this.#report("cache.invalidate_failed", namespace, error, "error");
      return -1;
    }
  }

  async #key(namespace: string, key: string): Promise<string> {
    const generation = await this.#generation(namespace);
    return `cache:${namespace}:${String(generation)}:${key}`;
  }

  async #generation(namespace: string): Promise<number> {
    const held = this.#generations.get(namespace);
    if (held !== undefined && this.now() - held.readAt < GENERATION_TTL_MS) {
      return held.value;
    }

    try {
      const raw = await this.redis.get(generationKey(namespace));
      const value = raw === null ? 0 : Number.parseInt(raw, 10);
      const generation = Number.isFinite(value) ? value : 0;
      this.#generations.set(namespace, {
        value: generation,
        readAt: this.now(),
      });
      return generation;
    } catch (error) {
      this.#report("cache.generation_read_failed", namespace, error);
      // Generation 0 with an unreachable Redis means every subsequent operation fails
      // anyway and the caller goes to the database. Returning a made-up number is fine
      // precisely because nothing will be written or read under it.
      return 0;
    }
  }

  #report(
    event: string,
    namespace: string,
    error: unknown,
    level: "warn" | "error" = "warn",
  ): void {
    logger[level](
      {
        context: {
          event,
          namespace,
          // The name, not the message: a Redis error message can carry a host and port,
          // and this goes to a log that is not treated as privileged.
          reason: error instanceof Error ? error.name : "Unknown",
        },
      },
      "application cache operation failed; falling through to the source of truth",
    );
  }
}

const generationKey = (namespace: string): string => `cache:gen:${namespace}`;
