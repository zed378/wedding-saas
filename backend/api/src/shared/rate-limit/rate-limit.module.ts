import { Global, Module, type OnModuleDestroy, Inject } from "@nestjs/common";
import { Redis as IORedis } from "ioredis";

import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import { PolicyRegistry } from "./config";
import { RateLimiter, RATE_LIMIT_REDIS } from "./rate-limiter";
import { POLICY_REGISTRY, RATE_LIMITER } from "./rate-limit.guard";

/**
 * P1-07 — wiring.
 *
 * A Redis connection of its own rather than sharing the queue's. `docs/ARCHITECTURE/06`
 * says cache, rate limiting and jobs share one Redis *server*, which is not the same as
 * sharing one client: BullMQ requires `maxRetriesPerRequest: null` on the connection it
 * owns, which makes a command wait indefinitely instead of failing. That is right for a
 * job it will retry anyway and wrong for a limiter, where a hung command would hold a
 * request open rather than triggering the fail-open/fail-closed decision in ADR-050.
 */
@Global()
@Module({
  providers: [
    {
      provide: RATE_LIMIT_REDIS,
      inject: [ENV],
      useFactory: (env: Env) =>
        new IORedis(env.REDIS_URL, {
          // Fail fast. The whole point is to reach a decision quickly.
          maxRetriesPerRequest: 1,
          connectTimeout: 1000,
          commandTimeout: 1000,
          lazyConnect: true,
          enableOfflineQueue: false,
        }),
    },
    {
      provide: RATE_LIMITER,
      inject: [RATE_LIMIT_REDIS],
      useFactory: (redis: IORedis) => new RateLimiter(redis),
    },
    {
      provide: POLICY_REGISTRY,
      inject: [RATE_LIMIT_REDIS, ENV],
      useFactory: (redis: IORedis, env: Env) =>
        new PolicyRegistry(redis, env.RATE_LIMIT_OVERRIDES),
    },
  ],
  exports: [RATE_LIMITER, POLICY_REGISTRY, RATE_LIMIT_REDIS],
})
export class RateLimitModule implements OnModuleDestroy {
  constructor(@Inject(RATE_LIMIT_REDIS) private readonly redis: IORedis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
