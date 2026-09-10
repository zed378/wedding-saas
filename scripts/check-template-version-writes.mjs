#!/usr/bin/env node
/**
 * P0-20 — the template-definition guard.
 *
 * `docs/DATABASE/03` § Schema Validation: "The `sections` column is validated against a
 * fixed JSON Schema (defined in application code, not in the DB) **before being saved**."
 * The database cannot enforce it -- `sections` and `theme` are `JSONB`, and Postgres will
 * accept any well-formed JSON at all.
 *
 * So the only thing standing between a malformed definition and every invitation that
 * uses the template is that somebody remembered to call the validator. That is a
 * discipline, and this repository has already learned twice what a discipline is worth:
 * `P0-15`'s worker logger carried a comment saying it did not redact, and the comment
 * survived four tasks.
 *
 * The rule: a file that writes `template_versions` must also mention the validator.
 *
 * It is deliberately loose -- mentioning `validateTemplateVersion` is not proof of
 * calling it on the right value. A tight version would need real dataflow analysis, and
 * the failure being prevented is not a determined author. It is the Phase 5 admin
 * endpoint being written months from now by someone who has never read `docs/DATABASE/03`
 * and for whom `INSERT INTO template_versions` looks like an ordinary insert.
 *
 * Usage: node scripts/check-template-version-writes.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOTS = ["backend", "packages", "frontend", "admin", "e2e", "scripts"];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
  "migrations",
]);

/**
 * Files exempt from the rule.
 *
 * `@wi/schema` defines the validator, so requiring it to mention itself is circular.
 */
// This file quotes `INSERT INTO template_versions` in its own error text, which would
// otherwise make it its own first offender.
const ALLOWED_PREFIXES = [
  "packages/schema/src/",
  "scripts/check-template-version-writes.mjs",
];

/**
 * Tests are exempt, and this is the hole in the guard -- stated rather than hidden.
 *
 * The reason is legitimate: the `P0-08`/`P0-09`/`P0-10` suites insert `template_versions`
 * rows with raw SQL to prove foreign keys, CHECK constraints and NOT NULL behaviour.
 * Those tests need a row, not a renderable design, and several of them need a
 * deliberately malformed one.
 *
 * The cost is that a test can create a state the application cannot -- an invitation
 * pointing at a definition no validator would have accepted -- and then assert
 * application behaviour against it. `createTestTemplateVersion` in
 * `backend/api/test/support/factories.ts` validates, so the cheap path is the correct
 * one; raw SQL in a test is now the deliberate choice it should be.
 */
const isTest = (rel) => /\.(spec|itest|e2e|test)\.(ts|mts|tsx)$/.test(rel);

const WRITE_PATTERNS = [
  {
    re: /INSERT\s+INTO\s+"?template_versions"?/i,
    what: "a raw INSERT into template_versions",
  },
  {
    re: /UPDATE\s+"?template_versions"?\s+SET/i,
    what: "a raw UPDATE of template_versions",
  },
  {
    re: /\.insert\(\s*templateVersions\s*\)/,
    what: "a Drizzle insert into templateVersions",
  },
  {
    re: /\.update\(\s*templateVersions\s*\)/,
    what: "a Drizzle update of templateVersions",
  },
];

/** Any of these in the same file counts as "the validator was considered". */
const VALIDATOR_MENTIONS = [
  "assertValidTemplateVersion",
  "validateTemplateVersion",
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP_DIRS.has(entry)) return [];
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Strip comments, so prose about template_versions is not a violation. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const files = ROOTS.flatMap(walk).filter((f) => /\.(ts|mts|tsx|mjs)$/.test(f));
const offenders = [];
let checked = 0;
let writers = 0;

for (const file of files) {
  const rel = relative(".", file).split(sep).join("/");
  if (ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
  if (isTest(rel)) continue;

  checked += 1;
  const source = stripComments(readFileSync(file, "utf8"));

  const write = WRITE_PATTERNS.find(({ re }) => re.test(source));
  if (write === undefined) continue;

  writers += 1;
  if (VALIDATOR_MENTIONS.some((name) => source.includes(name))) continue;

  offenders.push({ file: rel, what: write.what });
}

if (offenders.length === 0) {
  console.log(
    `check-template-version-writes: ${checked} file(s) checked, ${writers} writer(s), all validate first.`,
  );
  process.exit(0);
}

console.error("");
console.error("x template_versions is written without validating the definition:");
console.error("");
for (const o of offenders) {
  console.error(`    ${o.file}`);
  console.error(`      ${o.what}`);
}
console.error("");
console.error("  docs/DATABASE/03 requires sections and theme to be validated against");
console.error("  the schema in application code BEFORE the write. The columns are JSONB,");
console.error("  so Postgres accepts any well-formed JSON -- a section naming a component");
console.error("  no renderer provides, or a field path with a typo in it, stores cleanly");
console.error("  and renders as an empty section on every invitation using the template.");
console.error("");
console.error("  Use validateTemplateVersion() from @wi/schema and return its details[]");
console.error("  (docs/API/00), or assertValidTemplateVersion() where an invalid");
console.error("  definition is a programming error rather than user input.");
console.error("");
process.exit(1);
