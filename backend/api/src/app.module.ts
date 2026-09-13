import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { HealthController } from "./http/health.controller";
import { APP_FILTER } from "@nestjs/core";
import { AppExceptionFilter } from "./http/exception.filter";
import { RequestIdMiddleware } from "./http/request-id.middleware";
import { ReferenceModule } from "./modules/_reference/reference.module";
import { DatabaseModule } from "./infra/db/client";
import { TenancyModule } from "./shared/tenancy/tenancy.module";
import { LoggingModule } from "./shared/logging/logging.module";
import { AuditModule } from "./shared/audit/audit.module";
import { StorageModule } from "./infra/storage/storage.module";
import { QueueModule } from "./infra/queue/queue.module";
import { CacheModule } from "./infra/cache/cache.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UserModule } from "./modules/user/user.module";
import { InvitationModule } from "./modules/invitation/invitation.module";
import { MediaModule } from "./modules/media/media.module";
import { TemplateModule } from "./modules/template/template.module";
import { PublishingModule } from "./modules/publishing/publishing.module";
import { RateLimitModule } from "./shared/rate-limit/rate-limit.module";

/**
 * The middleware chain, in order. Positions later tasks fill are reserved here rather
 * than left to be worked out, because the order is a security property: rate limiting
 * before authentication means an unauthenticated flood is cheap to absorb, and the error
 * mapper last means nothing escapes it.
 *
 *   1. request id                 RequestIdMiddleware          (here)
 *   2. structured logging         Pino, with redaction          (here)
 *   3. CORS                       explicit origin allowlist     (main.ts)
 *   4. security headers           helmet                        (main.ts)
 *   5. body parsing + size limit  express.json({ limit })       (main.ts)
 *  5b. cookie parsing            cookie-parser, unsigned        (main.ts)
 *   6. rate limiting              Redis sliding window          shared/rate-limit (P1-07)
 *   7. authentication             requireAuth(), injects user   shared/auth-middleware (P1-06)
 *   -- route handler --
 *   8. error mapper               envelope per docs/API/00      P0-13
 *
 * 3 to 5 are applied in `main.ts` because they are global to the Express instance rather
 * than route-scoped. Everything route-scoped is applied below.
 */
@Module({
  controllers: [HealthController],
  // Chain position 8. Registered as a provider rather than with
  // `app.useGlobalFilters()` so it can take injected dependencies later, and so it is
  // visible in the module graph rather than hidden in bootstrap.
  providers: [{ provide: APP_FILTER, useClass: AppExceptionFilter }],
  imports: [
    ConfigModule,
    LoggingModule,
    DatabaseModule,
    TenancyModule,
    AuditModule,
    StorageModule,
    QueueModule,
    CacheModule,
    RateLimitModule,
    AuthModule,
    UserModule,
    InvitationModule,
    MediaModule,
    TemplateModule,
    PublishingModule,
    // Scaffolding, not a feature. Removed once a real module exists on each surface.
    ...(process.env["NODE_ENV"] === "production" ? [] : [ReferenceModule]),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
