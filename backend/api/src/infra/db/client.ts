import { Global, Module, Inject, type OnModuleDestroy } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import * as schema from "./schema/index";

/** Injection token for the Drizzle database handle. */
export const DB = Symbol("DB");

/** Injection token for the underlying pool, for the rare case that needs raw SQL. */
export const DB_POOL = Symbol("DB_POOL");

export type Database = NodePgDatabase<typeof schema>;

/**
 * The application's database connection.
 *
 * Connects as the APPLICATION role (`DATABASE_URL`), which cannot alter schema and, once
 * row-level policies exist, cannot bypass them -- see `deploy/postgres/init/01-app-role.sql`
 * and `P0-06`. Migrations use a different URL and a different role, and nothing here can
 * run one.
 */
@Global()
@Module({
  providers: [
    {
      provide: DB_POOL,
      inject: [ENV],
      useFactory: (env: Env): Pool =>
        new Pool({
          connectionString: env.DATABASE_URL,
          // Bounded on purpose. An unbounded pool turns a slow query into exhausted
          // database connections, which takes down every other request too.
          max: 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
        }),
    },
    {
      provide: DB,
      inject: [DB_POOL],
      useFactory: (pool: Pool): Database => drizzle(pool, { schema }),
    },
  ],
  exports: [DB, DB_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * Close the pool on shutdown so in-flight queries finish and the process can exit.
   * `src/http/graceful-shutdown.ts` stops accepting connections first; this releases
   * what those connections were using.
   */
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
