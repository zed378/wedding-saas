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
import { PolicyRegistry } from "./config";
import { RateLimiter, RATE_LIMIT_REDIS } from "./rate-limiter";
import { POLICY_REGISTRY, RATE_LIMITER } from "./rate-limit.guard";
import { logger } from "../logging/logger";

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
export class RateLimitModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(RATE_LIMIT_REDIS) private readonly redis: IORedis) {}

  /**
   * Connect before the application accepts a request.
   *
   * `lazyConnect` with `enableOfflineQueue: false` is a combination that rejects the
   * FIRST command outright: lazy means no connection is opened until a command asks for
   * one, and an empty offline queue means that command is not held while the handshake
   * happens -- it fails immediately with "Stream isn't writeable".
   *
   * Both options are right on their own. Lazy keeps a unit test from opening a socket
   * nothing will use, and refusing to queue is what makes ADR-050's decision reachable at
   * all: a queued command would wait instead of failing, and the limiter would hold the
   * request open rather than deciding.
   *
   * Together, without this, every restart makes the first credential request fail closed
   * with 503 while Redis is perfectly healthy. Found on the first Phase 1 staging deploy,
   * where `POST /auth/register` answered 503 and the retry a minute later answered 201.
   *
   * A failure here does NOT stop the application. Redis being unreachable is a state the
   * limiter is designed to survive -- fail closed on credential endpoints, open elsewhere
   * -- and refusing to boot would turn a degraded service into an outage.
   */
  async onModuleInit(): Promise<void> {
    // `wait` is ioredis's word for "lazy, never asked to connect". Any other status
    // means a connection is already open or in progress, and calling connect() again
    // throws.
    if (this.redis.status !== "wait") return;

    try {
      await this.redis.connect();
    } catch (error) {
      logger.error(
        {
          context: {
            event: "rate_limit.initial_connect_failed",
            reason: error instanceof Error ? error.name : "Unknown",
          },
        },
        "rate limiter could not reach Redis at startup; credential endpoints will " +
          "fail closed until it can",
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
