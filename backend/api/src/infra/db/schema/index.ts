/**
 * The Drizzle schema, one file per group, mirroring docs/DATABASE/.
 *
 * Nothing is defined yet: the tables arrive in P0-07 (users and auth), P0-08
 * (templates, versions, media), P0-09 (invitations and children) and P0-10
 * (orders, payments, audit logs). Each of those must match the CREATE TABLE
 * statements in docs/DATABASE/ column for column and constraint for constraint
 * (CLAUDE.md, ADR-007) -- Drizzle was chosen over Prisma precisely so that
 * partial unique indexes, CHECK constraints and varchar(40)[] survive the round
 * trip from document to migration.
 *
 * `drizzle-kit generate` diffs this barrel against the last snapshot, so a table
 * that is not re-exported here does not exist as far as migrations are
 * concerned. Adding a schema file without adding its export is a silent no-op --
 * the migration simply comes out empty.
 */

// P0-07 — users, notification preferences, refresh tokens, single-use tokens,
// MFA factors and recovery codes. docs/DATABASE/02-USERS.md.
export * from "./users.ts";

// P0-08 — the template catalog and media. docs/DATABASE/03 and 06.
export * from "./templates.ts";
