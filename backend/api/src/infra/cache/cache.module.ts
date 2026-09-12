import {
  Global,
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Redis as IORedis } from "ioredis";

import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import { logger } from "../../shared/logging/logger";
import { CACHE } from "./cache.port";
import { RedisCache } from "./redis-cache";

/**
 * P2-01 — wiring for the application cache.
 *
 * ## Its own connection, again
 *
 * Three clients now reach one Redis server (ADR-009): the rate limiter's, BullMQ's, and
 * this one. That is deliberate rather than accumulated. Each needs different options —
 * BullMQ requires `maxRetriesPerRequest: null`, which makes a command wait indefinitely
 * and is exactly wrong for a cache — and sharing one client means a slow cache read sits
 * in the same command pipeline as a rate-limit decision.
 *
 * ## Connected at startup, because `P1-07` was not
 *
 * `lazyConnect` with `enableOfflineQueue: false` rejects the FIRST command outright
 * rather than holding it for the handshake. For the limiter that produced a 503 on the
 * first credential request after every restart. Here it would be milder — one cache miss
 * — which is precisely why it would never have been noticed. Same options, same explicit
 * connect, and a failure is logged rather than fatal.
 */
export const CACHE_REDIS = Symbol("CACHE_REDIS");

@Global()
@Module({
  providers: [
    {
      provide: CACHE_REDIS,
      inject: [ENV],
      useFactory: (env: Env) =>
        new IORedis(env.REDIS_URL, {
          // Fail fast and fall through to the database. A cache that retries is a cache
          // that makes a slow page slower.
          maxRetriesPerRequest: 1,
          connectTimeout: 1000,
          commandTimeout: 1000,
          lazyConnect: true,
          enableOfflineQueue: false,
        }),
    },
    {
      provide: CACHE,
      inject: [CACHE_REDIS],
      useFactory: (redis: IORedis) => new RedisCache(redis),
    },
  ],
  exports: [CACHE, CACHE_REDIS],
})
export class CacheModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(CACHE_REDIS) private readonly redis: IORedis) {}

  async onModuleInit(): Promise<void> {
    if (this.redis.status !== "wait") return;

    try {
      await this.redis.connect();
    } catch (error) {
      logger.warn(
        {
          context: {
            event: "cache.initial_connect_failed",
            reason: error instanceof Error ? error.name : "Unknown",
          },
        },
        "application cache could not reach Redis at startup; reads will fall through " +
          "to the database until it can",
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
