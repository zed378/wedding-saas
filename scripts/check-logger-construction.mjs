#!/usr/bin/env node
/**
 * P0-19.1 — the logger-construction guard.
 *
 * `docs/DEVOPS/06` § Mandatory Redaction: redaction happens "at the logger middleware
 * level, not relying on manual developer discipline each time". Redaction in this
 * repository lives in one place -- the `log` formatter that `@wi/logging`'s
 * `createLogger()` installs. A logger built any other way does not redact, and nothing
 * about it looks wrong: it produces the same field names, at the same level, on the same
 * stream.
 *
 * That is not hypothetical. `P0-15` gave the worker its own `pino({...})` with a comment
 * saying it did not redact, and it stayed that way for four tasks. The comment was
 * honest and it changed nothing, because a comment is not a mechanism.
 *
 * So: `pino()` may only be called inside `packages/logging/src/`. Everywhere else, use
 * `createLogger({ service })`.
 *
 * Tests are exempt -- a test that builds its own pino instance to capture output is
 * doing the opposite of hiding a leak, and `packages/logging/src/logging.spec.ts` does
 * exactly that on purpose.
 *
 * It is a text check and it can be evaded. It is not trying to stop a determined author;
 * it is trying to stop an ordinary one from doing the natural thing without noticing
 * there was a rule.
 *
 * Usage: node scripts/check-logger-construction.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOTS = ["backend", "packages", "frontend", "admin", "e2e"];

/** The one module allowed to construct a logger. */
const ALLOWED_PREFIX = "packages/logging/src/";

/** A test capturing output builds its own sink deliberately -- that is not the risk. */
const isTest = (rel) => /\.(spec|itest|e2e|test)\.(ts|mts|tsx)$/.test(rel);

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage"]);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP_DIRS.has(entry)) return [];
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Strip comments, so prose explaining the rule is not a violation of it. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const PATTERNS = [
  {
    // `pino({...})` / `pino(opts, sink)` -- the call, not the import.
    re: /(?<![.\w])pino\s*\(/,
    what: "a direct pino() call",
  },
  {
    // pino.destination / pino.transport used to assemble a bespoke logger.
    re: /(?<![.\w])pino\.(?:transport|destination)\s*\(/,
    what: "a bespoke pino transport or destination",
  },
];

const files = ROOTS.flatMap(walk).filter((f) => /\.(ts|mts|tsx)$/.test(f));
const offenders = [];
let checked = 0;

for (const file of files) {
  const rel = relative(".", file).split(sep).join("/");
  if (rel.startsWith(ALLOWED_PREFIX)) continue;
  if (isTest(rel)) continue;

  checked += 1;
  const source = stripComments(readFileSync(file, "utf8"));

  for (const { re, what } of PATTERNS) {
    if (re.test(source)) offenders.push({ file: rel, what });
  }
}

if (offenders.length === 0) {
  console.log(
    `check-logger-construction: ${checked} file(s) checked, loggers built only by @wi/logging.`,
  );
  process.exit(0);
}

console.error("");
console.error("x a logger is being constructed outside @wi/logging:");
console.error("");
for (const o of offenders) {
  console.error(`    ${o.file}`);
  console.error(`      ${o.what}`);
}
console.error("");
console.error("  docs/DEVOPS/06 requires redaction at the logger, not at the call site.");
console.error("  Redaction lives in the `log` formatter that createLogger() installs, so");
console.error("  a logger built directly from pino() writes secrets in clear text while");
console.error("  looking identical in every other respect -- same fields, same level,");
console.error("  same stream. The worker shipped exactly that for four tasks (P0-15).");
console.error("");
console.error("  Use createLogger({ service }) from @wi/logging instead. If you need to");
console.error("  capture output, pass a destination as its second argument.");
console.error("");
process.exit(1);
