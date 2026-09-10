import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { HealthController } from "./http/health.controller";
import { RequestIdMiddleware } from "./http/request-id.middleware";
import { ReferenceModule } from "./modules/_reference/reference.module";
import { DatabaseModule } from "./infra/db/client";
import { TenancyModule } from "./shared/tenancy/tenancy.module";

/**
 * The middleware chain, in order. Positions later tasks fill are reserved here rather
 * than left to be worked out, because the order is a security property: rate limiting
 * before authentication means an unauthenticated flood is cheap to absorb, and the error
 * mapper last means nothing escapes it.
 *
 *   1. request id                 RequestIdMiddleware          (here)
 *   2. structured logging         Pino, with redaction          P0-12
 *   3. CORS                       explicit origin allowlist     (main.ts)
 *   4. security headers           helmet                        (main.ts)
 *   5. body parsing + size limit  express.json({ limit })       (main.ts)
 *   6. rate limiting              Redis sliding window          P1-07
 *   7. authentication             requireAuth, injects user     P1-06
 *   -- route handler --
 *   8. error mapper               envelope per docs/API/00      P0-13
 *
 * 3 to 5 are applied in `main.ts` because they are global to the Express instance rather
 * than route-scoped. Everything route-scoped is applied below.
 */
@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule,
    DatabaseModule,
    TenancyModule,
    // Scaffolding, not a feature. Removed once a real module exists on each surface.
    ...(process.env["NODE_ENV"] === "production" ? [] : [ReferenceModule]),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
