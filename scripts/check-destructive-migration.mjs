#!/usr/bin/env node
/**
 * P0-06 — the destructive-migration gate.
 *
 * docs/DEVOPS/08-ROLLBACK.md requires the expand-contract pattern: a DROP must not
 * ride along with the deploy that stops using the thing being dropped. The dangerous
 * case is not a considered drop, it is the one nobody noticed -- `drizzle-kit
 * generate` will happily emit `DROP COLUMN` because a field was renamed in the schema
 * file, and that SQL reads as routine in a diff.
 *
 * So a destructive statement is allowed, but only if the file says why. The comment
 * is the whole point: it forces the author to state which expand-contract phase this
 * is and what confirmed the column is unused, at the moment they still know.
 *
 * Required marker, anywhere in the migration file:
 *
 *   -- CONTRACT-PHASE: <why this is safe to drop now>
 *
 * Usage:
 *   node scripts/check-destructive-migration.mjs            check migrations/ as it stands
 *   node scripts/check-destructive-migration.mjs --changed  only files changed vs the base ref
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const MIGRATIONS_DIR = "backend/api/migrations";
const MARKER = /--\s*CONTRACT-PHASE:\s*\S+/i;

/**
 * Destructive statements. Deliberately narrow: these are the ones that lose data or
 * break a running deploy's queries. ALTER ... TYPE and SET NOT NULL can also break a
 * rollout, but they do not destroy data and flagging them would train people to add
 * the marker without thinking, which is the failure mode that kills a check like this.
 */
const DESTRUCTIVE = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bDROP\s+SCHEMA\b/i,
  /\bTRUNCATE\b/i,
];

/** Strip comments so a marker or a CREATE inside a comment cannot be read as SQL. */
function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function changedMigrationFiles() {
  for (const ref of ["origin/main", "main", "HEAD~1"]) {
    try {
      git(["rev-parse", "--verify", "--quiet", ref]);
      return git(["diff", "--name-only", `${ref}...HEAD`])
        .split("\n")
        .filter((f) => f.startsWith(MIGRATIONS_DIR) && f.endsWith(".sql"));
    } catch {
      /* try the next ref */
    }
  }
  return null;
}

function allMigrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => join(MIGRATIONS_DIR, f).replace(/\\/g, "/"));
}

const onlyChanged = process.argv.includes("--changed");
let files = onlyChanged ? changedMigrationFiles() : allMigrationFiles();

if (files === null) {
  console.log("check-destructive-migration: no comparable base ref, checking all files.");
  files = allMigrationFiles();
}

const offenders = [];
let checked = 0;
for (const file of files) {
  if (!existsSync(file)) continue; // deleted in this diff

  // A .down.sql is a rollback script: dropping what its .up created is its entire job,
  // and demanding an expand-contract justification there would be nonsense.
  if (file.endsWith(".down.sql")) continue;

  const raw = readFileSync(file, "utf8");
  checked += 1;
  const sql = stripComments(raw);
  const hits = DESTRUCTIVE.filter((re) => re.test(sql)).map((re) => String(re));
  if (hits.length > 0 && !MARKER.test(raw)) {
    offenders.push({ file, hits });
  }
}

if (offenders.length === 0) {
  console.log(
    `check-destructive-migration: ${checked} migration file(s) checked, none destructive without justification.`,
  );
  process.exit(0);
}

console.error("");
console.error("x Destructive migration with no justification:");
console.error("");
for (const o of offenders) {
  console.error(`    ${o.file}`);
  for (const h of o.hits) console.error(`      matches ${h}`);
}
console.error("");
console.error("  docs/DEVOPS/08-ROLLBACK.md requires expand-contract: a DROP must not run in");
console.error("  the same deploy as the code that stopped using it, or a code rollback lands");
console.error("  on a schema that no longer has the column it reads.");
console.error("");
console.error("  If this really is the contract phase, say so in the file:");
console.error("");
console.error("    -- CONTRACT-PHASE: dropped in v1.4, unused since v1.2 (deployed 3 weeks),");
console.error("    -- confirmed zero reads in the query logs for 14 days.");
console.error("");
console.error("  See backend/api/migrations/README.md for the four phases.");
console.error("");
process.exit(1);
