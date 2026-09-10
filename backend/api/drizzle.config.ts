import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration.
 *
 * Migrations are a deliberate step, never a side effect of starting the service
 * (docs/ARCHITECTURE/04 § Migration Strategy). Nothing in src/ imports this file;
 * it is read by the CLI only, which is what keeps `pnpm start` unable to migrate
 * even by accident.
 */
export default defineConfig({
  schema: "./src/infra/db/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Read at CLI time. The same variable the API validates at startup, so a
    // migration cannot be run against a database the application could not reach.
    url: process.env.DATABASE_URL ?? "",
  },
  // Emit the SQL for review rather than applying it. `drizzle-kit push` is
  // deliberately never used: it diffs and applies in one step against a live
  // database with no file to review, which is exactly the "manual schema change
  // in production" that docs/ARCHITECTURE/04 forbids.
  strict: true,
  verbose: true,
});
