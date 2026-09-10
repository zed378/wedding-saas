import { Global, Module } from "@nestjs/common";
import { loadEnv, type Env } from "./env.schema";

/** Injection token for the validated environment. */
export const ENV = Symbol("ENV");

/**
 * Configuration is validated once, at module construction, and provided as a frozen
 * object. Nothing in the application reads `process.env` directly -- a value read
 * straight from the environment is a value nobody validated.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
