import { z } from "zod";

/**
 * Database connection contract for the migration commands.
 *
 * Separate from src/config/env.schema.ts on purpose. That schema is the API's
 * startup contract and requires APP_ORIGIN, ADMIN_ORIGIN and the rest; a migration
 * run in a release pipeline has no business needing a CORS allowlist to be present
 * before it can add a column.
 *
 * Two URLs, two roles. deploy/postgres/init/01-app-role.sql exists so that the
 * application connects as a role which does not own its tables and holds neither
 * SUPERUSER nor BYPASSRLS -- the moment row-level policies are added, an owner
 * connection would bypass every one of them and no test would fail. Migrations must
 * create and alter those tables, so they need the owner. Running both as the owner
 * would throw away that separation on the very first migration.
 */
const migrationEnvSchema = z.object({
  /**
   * The owner role. Creates and alters schema objects.
   * Local default: postgres://wedding_owner:...@localhost:5432/wedding
   */
  MIGRATION_DATABASE_URL: z
    .string()
    .min(
      1,
      "required: migrations connect as the owner role, not the application role",
    ),
});

export type MigrationEnv = z.infer<typeof migrationEnvSchema>;

export function loadMigrationEnv(
  source: NodeJS.ProcessEnv = process.env,
): MigrationEnv {
  const result = migrationEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`,
    );
    console.error(
      [
        "Cannot run migrations, the environment is incomplete:",
        ...issues,
        "",
        "MIGRATION_DATABASE_URL connects as the OWNER role (wedding_owner locally).",
        "DATABASE_URL connects as the APPLICATION role (wedding_app) and is not used here.",
        "See .env.example and backend/api/migrations/README.md.",
        "",
      ].join("\n"),
    );
    // 78 = EX_CONFIG, the same code src/main.ts uses for a bad environment.
    process.exit(78);
  }
  return result.data;
}
