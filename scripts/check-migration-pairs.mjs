#!/usr/bin/env node
/**
 * P0-06 — every migration ships with a down file.
 *
 * Drizzle does not generate down migrations (ADR-030), so `drizzle-kit generate`
 * produces an up file and nothing else. The missing companion is invisible until the
 * day someone runs `db:rollback` and finds there is nothing to run — which is the day
 * they least want to discover it.
 *
 * "Reversing this is impossible" is a perfectly good answer, but it has to be written
 * down in a file that exists, saying what to restore from instead. An absent file and
 * a deliberate refusal look identical from the outside; only one of them is a decision.
 */

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "backend/api/migrations";
const JOURNAL = join(MIGRATIONS_DIR, "meta", "_journal.json");

if (!existsSync(JOURNAL)) {
  console.log("check-migration-pairs: no journal yet, nothing to check.");
  process.exit(0);
}

const entries = JSON.parse(readFileSync(JOURNAL, "utf8")).entries ?? [];
const missing = [];

for (const entry of entries) {
  const down = join(MIGRATIONS_DIR, `${entry.tag}.down.sql`);
  if (!existsSync(down)) missing.push({ tag: entry.tag, down: down.replace(/\\/g, "/") });
}

// A .down.sql with no journal entry is the other direction of the same mistake:
// usually a migration that was deleted while its reverse was left behind.
const orphans = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".down.sql"))
  .map((f) => f.replace(/\.down\.sql$/, ""))
  .filter((tag) => !entries.some((e) => e.tag === tag));

if (missing.length === 0 && orphans.length === 0) {
  console.log(`check-migration-pairs: ${entries.length} migration(s), each with a down file.`);
  process.exit(0);
}

console.error("");
if (missing.length > 0) {
  console.error("x Migration with no down file:");
  console.error("");
  for (const m of missing) {
    console.error(`    ${m.tag}  ->  expected ${m.down}`);
  }
  console.error("");
  console.error("  Write it. If the change genuinely cannot be reversed, the file must still");
  console.error("  exist and say so — a RAISE that names what to restore from instead:");
  console.error("");
  console.error("    DO $$ BEGIN");
  console.error("      RAISE EXCEPTION 'Not reversible: drops guest data. Restore from PITR.';");
  console.error("    END $$;");
  console.error("");
}
if (orphans.length > 0) {
  console.error("x Down file with no matching migration in the journal:");
  console.error("");
  for (const o of orphans) console.error(`    ${o}.down.sql`);
  console.error("");
  console.error("  Its up migration is gone. Delete the orphan, or restore the migration.");
  console.error("");
}
console.error("  See backend/api/migrations/README.md.");
console.error("");
process.exit(1);
