#!/usr/bin/env node
/**
 * P1-16 step 4 — the check that makes forgetting impossible.
 *
 * Every free-text field in this product renders on a public page seen by hundreds of
 * guests, and `docs/SECURITY/08` calls stored XSS the primary risk here. `P1-16` built one
 * sanitization step and a registry of the fields it covers; this is what stops the
 * eleventh endpoint quietly introducing a twelfth field nobody thought about.
 *
 * ## What it does
 *
 * Finds every Zod object schema in a controller, extracts the field names whose validator
 * is string-ish, and requires each to appear in either:
 *
 *   `TEXT_FIELDS`  -- it is prose, and the sanitizer handles it; or
 *   `NOT_USER_TEXT` -- it is not prose, with a written reason.
 *
 * A field in neither fails the build, naming the file and the field.
 *
 * ## What it does not do
 *
 * It is a text check over source, not a type-aware analysis. It can be evaded by building
 * a schema dynamically, and it will not notice a field that is registered but whose
 * service forgets to call `sanitizeFields`. Like every guard in `scripts/`, it is not
 * trying to stop a determined author; it is trying to stop an ordinary one from adding a
 * field without meeting the question.
 *
 * The complementary risk -- registered but not actually sanitized -- is covered by the
 * parameterised test in `test/sanitize.spec.ts`, which runs the payload set over every
 * registered field.
 *
 * Usage: node scripts/check-sanitized-fields.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOTS = ["backend/api/src"];
const REGISTRY = "backend/api/src/shared/sanitizer/registry.ts";

/** Only controllers define request schemas. A service's types are not a wire contract. */
const SCHEMA_FILE = /\.controller\.ts$/;

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/**
 * Field names in a Zod object whose validator involves a string.
 *
 * Deliberately generous about what counts: `z.string()`, `z.email()`, `z.enum([...])`,
 * `z.uuid()` and a `z.union` containing any of them all match, because the point is to
 * make somebody *decide* about each field rather than to guess which ones are dangerous.
 * An enum is exempt in the registry, not here.
 */
function stringFields(source) {
  const found = new Set();

  // `  field_name: z.<something involving string/email/uuid/enum/literal>`
  const pattern =
    /^\s{2,}([a-z][a-z0-9_]*)\s*:\s*z\s*\n?\s*\.?[\s\S]{0,200}?(?=,\n|\n\s*\}\))/gm;

  for (const match of source.matchAll(pattern)) {
    const [whole, name] = match;
    if (!/\b(string|email|uuid|enum|literal)\b/.test(whole)) continue;
    found.add(name);
  }

  return found;
}

function registeredNames() {
  const source = readFileSync(REGISTRY, "utf8");
  const names = new Set();

  // Keys of both exported records. `  name: "plain",` and `  name: "reason...",`
  for (const match of source.matchAll(/^\s{2}([a-z][a-z0-9_]*)\s*:/gm)) {
    names.add(match[1]);
  }

  if (names.size === 0) {
    console.error(
      "x check-sanitized-fields: the registry parsed as empty.\n\n" +
        `  ${REGISTRY} defines TEXT_FIELDS and NOT_USER_TEXT. If its shape changed, this\n` +
        "  script needs updating -- an empty registry would make every field look\n" +
        "  unregistered, which is loud, but the reverse mistake would be silent.\n",
    );
    process.exit(1);
  }

  return names;
}

const known = registeredNames();
const offenders = [];
let scanned = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (!SCHEMA_FILE.test(file)) continue;
    scanned += 1;

    const source = readFileSync(file, "utf8");
    const unregistered = [...stringFields(source)].filter((n) => !known.has(n));

    if (unregistered.length > 0) {
      offenders.push({
        file: relative(process.cwd(), file).split(sep).join("/"),
        fields: unregistered,
      });
    }
  }
}

if (offenders.length > 0) {
  console.error(
    "x A request schema has a string field that is neither sanitized nor exempt:\n",
  );
  for (const { file, fields } of offenders) {
    console.error(`    ${file}`);
    console.error(`      ${fields.join(", ")}\n`);
  }
  console.error(
    "  Every free-text field in this product renders on a public page seen by\n" +
      "  hundreds of guests, and docs/SECURITY/08 calls stored XSS the primary risk.\n" +
      "  P1-16 exists so that forgetting one requires deleting something.\n\n" +
      "  Add each field to backend/api/src/shared/sanitizer/registry.ts:\n\n" +
      "    TEXT_FIELDS   -- it is prose a guest will read. The sanitizer handles it,\n" +
      "                     and the service must call sanitizeFields().\n" +
      "    NOT_USER_TEXT -- it is not prose. Write the REASON; that line is what a\n" +
      "                     reviewer is supposed to disbelieve.\n\n" +
      "  Adding it to NOT_USER_TEXT is the cheapest way past this message and the\n" +
      "  easiest place to be wrong. A field that is rendered anywhere is prose.\n",
  );
  process.exit(1);
}

console.log(
  `check-sanitized-fields: ${scanned} controller(s) checked, every string field registered.`,
);
