/**
 * P2-01 — the application cache, as a port.
 *
 * `docs/ARCHITECTURE/06` § Cache Layers puts Redis between the CDN and the database and
 * names template definitions as one of the things that belongs there: read constantly,
 * changed by an administrator a few times a year.
 *
 * ## Every method fails open
 *
 * A cache miss and a cache **failure** must be indistinguishable to a caller. If Redis is
 * unreachable, `get` returns `undefined` and `set` does nothing — the caller goes to the
 * database and the page is slower, which is the correct behaviour for a layer whose only
 * job is to make a correct answer cheaper.
 *
 * The alternative is worse in a way that is easy to miss: a cache that throws turns a
 * degraded dependency into a 500 on an endpoint that does not need it at all. `ADR-050`
 * made the same call for the rate limiter in the direction that suited a security
 * control; this is the same reasoning for a performance one.
 *
 * ## Invalidation is a generation counter, not a key sweep
 *
 * See `RedisCache`. The port exposes it because the alternative — `SCAN` plus `DEL` over
 * a key pattern — is O(keyspace) on a shared Redis and blocks the very server every other
 * subsystem is using.
 */
export interface CachePort {
  /**
   * The cached value, or `undefined` for a miss, a failure, or unparseable JSON.
   *
   * `namespace` is combined with the current generation, so a bumped generation orphans
   * every key under it at once.
   */
  getJson<T>(namespace: string, key: string): Promise<T | undefined>;

  /** Store a value under a TTL. Never throws. */
  setJson(
    namespace: string,
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void>;

  /**
   * Invalidate everything in a namespace, atomically, in one round trip.
   *
   * Returns the new generation, which is useful in a test and in a log line and should
   * not be relied on as a version number by anything else.
   */
  invalidateNamespace(namespace: string): Promise<number>;
}

/** Injection token. */
export const CACHE = Symbol("CACHE");
