/**
 * Singleflight deduplication utility.
 *
 * Ensures that for concurrent calls with the same key, only one operation executes
 * while all other concurrent callers await and receive the same result.
 *
 * `docs/ARCHITECTURE/06-CACHING-ARCHITECTURE.md` § Cache Stampede Protection:
 * "Use a lock/singleflight mechanism on cache miss for high-traffic invitations
 * (preventing many concurrent requests from hitting the DB simultaneously when the
 * cache expires at once)."
 */
export class Singleflight {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing !== undefined) {
      return existing as Promise<T>;
    }

    const promise = fn().finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  activeCount(): number {
    return this.inFlight.size;
  }
}
