import path from "node:path";
import fs from "node:fs";

/**
 * Where the migration files live.
 *
 * Resolved from the package directory rather than from this file's own location, so
 * the answer is the same whether the command runs from source (`node
 * src/infra/db/migrate.mts`, Node 24 strips the types) or from `dist/`. The pnpm
 * scripts set the working directory to the package root either way.
 *
 * Checked rather than assumed: a migrator pointed at a folder that does not exist
 * reports "0 migrations applied" and exits 0, which is indistinguishable from an
 * up-to-date database and is the worst possible way to fail.
 */
export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "migrations");

export function assertMigrationsFolder(): void {
  const journal = path.join(MIGRATIONS_FOLDER, "meta", "_journal.json");
  if (!fs.existsSync(journal)) {
    console.error(
      [
        `No migration journal at ${journal}`,
        "",
        "Run these commands from backend/api, e.g.",
        "  pnpm --filter @wi/api db:migrate",
        "",
        "An empty or missing folder would otherwise look exactly like an up-to-date",
        "database: nothing to apply, exit 0.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
}
