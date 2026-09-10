import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import helmet from "helmet";
import type { Server } from "node:http";

import { AppModule } from "./app.module";
import { ConfigValidationError, loadEnv } from "./config/env.schema";
import { SecretRuleError } from "./config/secret-rules";
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
  //    per docs/SECURITY/08 § Security Headers -- see the options below.
  app.use(
    helmet({
      // X-Frame-Options: DENY. docs/SECURITY/08 § Security Headers. Nothing should
      // embed the API, and helmet defaults to SAMEORIGIN which is weaker than the
      // document asks for. The public invitation page may be deliberately embeddable
      // -- that is a decision for that surface (P2-08), not this one.
      frameguard: { action: "deny" },

      // HSTS. Long max-age with subdomains, so app./invitation./admin. are all
      // covered by one policy. `preload` is deliberately NOT set: submitting to the
      // preload list is close to irreversible, and doing it before the domain is
      // settled would strand any future non-TLS subdomain.
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: false },

      // A baseline CSP for the API itself. This is not the public invitation page's
      // policy -- that page renders user content and needs its own, stricter, one in
      // P2-08. An API response is JSON that nothing should ever execute, so
      // everything is denied and the few directives that matter are explicit.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },

      // Referrer-Policy. An API URL can carry an invitation id; do not leak it to a
      // third party through a referrer header.
      referrerPolicy: { policy: "no-referrer" },

      // helmet sets X-Content-Type-Options: nosniff by default (docs/SECURITY/08).
      // Left on, named here so a future edit knows it is required rather than
      // incidental.
    }),
  );

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
  if (
    error instanceof ConfigValidationError ||
    error instanceof SecretRuleError
  ) {
    // Configuration errors are for a human to read, not a stack trace to decode.
    // eslint-disable-next-line no-console -- the logger does not exist yet at this point
    console.error(error.message);
    process.exit(78); // EX_CONFIG
  }
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
