import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import helmet from "helmet";
import type { Server } from "node:http";

import { AppModule } from "./app.module";
import { ConfigValidationError, loadEnv } from "./config/env.schema";
import { gracefulShutdown } from "./http/graceful-shutdown";

async function bootstrap(): Promise<void> {
  // Validated before anything else is constructed: a service that cannot be configured
  // correctly should fail here, not on the first request that needed the missing value.
  const env = loadEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // --- chain positions 3 to 5 (see AppModule for the full order) ---

  // 3. CORS. docs/SECURITY/08 forbids `*` on authenticated endpoints, so the allowlist is
  //    explicit and comes from validated configuration.
  app.enableCors({
    origin: [env.APP_ORIGIN, env.PUBLIC_INVITE_ORIGIN, env.ADMIN_ORIGIN],
    credentials: true,
  });

  // 4. Security headers (docs/SECURITY/08 § Security Headers). Framing is denied outright
  //    here: nothing should embed the API, and helmet defaults to SAMEORIGIN. The public
  //    invitation page may be deliberately embeddable, which is a decision for that
  //    surface (P2-08), not this one.
  app.use(helmet({ frameguard: { action: "deny" } }));

  // 5. Body parsing with a size limit. Uploads do not travel this path -- they are
  //    multipart and size-capped at the edge before the body is read (P1-17).
  app.use(express.json({ limit: env.BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: env.BODY_LIMIT }));

  await app.listen(env.PORT);
  const server = app.getHttpServer() as Server;

  const shutdown = (signal: NodeJS.Signals) => {
    void (async () => {
      // eslint-disable-next-line no-console -- replaced by the structured logger in P0-12
      console.log(`${signal} received, draining`);
      await gracefulShutdown(server, {
        timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
        onTimeout: () => {
          // eslint-disable-next-line no-console -- replaced in P0-12
          console.warn(
            `drain exceeded ${env.SHUTDOWN_TIMEOUT_MS}ms, exiting anyway`,
          );
        },
      });
      await app.close();
      process.exit(0);
    })();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

bootstrap().catch((error: unknown) => {
  if (error instanceof ConfigValidationError) {
    // Configuration errors are for a human to read, not a stack trace to decode.
    // eslint-disable-next-line no-console -- the logger does not exist yet at this point
    console.error(error.message);
    process.exit(78); // EX_CONFIG
  }
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
