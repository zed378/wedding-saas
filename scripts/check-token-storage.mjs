#!/usr/bin/env node
/**
 * P0-22 — the access-token storage guard.
 *
 * `docs/FRONTEND/02` § Auth Token Storage: "Access token: in-memory (JS store), **NEVER
 * in localStorage** (mitigating XSS token theft — see SECURITY/03). Refresh token: an
 * HTTP-only cookie (never accessible to JS at all)."
 *
 * `@wi/api-client` has no persistent branch to configure, and its own test reads its
 * source to prove it. This is the other half: nothing anywhere else may put a token
 * into browser storage either.
 *
 * The realistic breach is not malice. It is a developer three months from now, annoyed
 * that a page reload costs a refresh round trip, adding four lines to "fix" it. Those
 * four lines turn every XSS in the product from a session-length problem into a
 * permanent one, and they look like a performance improvement in review.
 *
 * ## The rule
 *
 * A file may not name `localStorage`, `sessionStorage`, `indexedDB` or `document.cookie`
 * **on the same line as, or within a few lines of, anything token-shaped**. A blanket
 * ban on `localStorage` would be wrong: remembering a collapsed sidebar or the last
 * open editor tab is a perfectly good use of it, and a guard that forbids the obvious
 * correct thing is a guard people disable.
 *
 * Usage: node scripts/check-token-storage.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOTS = ["backend", "packages", "frontend", "admin", "e2e"];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
]);

/** Browser storage that survives the tab. */
const STORAGE = /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/;

/**
 * Token-shaped identifiers.
 *
 * `auth` is included because `localStorage.setItem("auth", ...)` is the most common
 * spelling of exactly this mistake.
 */
const TOKENISH =
  /\b(access[_-]?token|accessToken|refresh[_-]?token|refreshToken|id[_-]?token|idToken|bearer|jwt|authorization|auth)\b/i;

/** How many lines after a storage call still count as "near" it. */
const WINDOW = 3;

/**
 * Tests are exempt, and this is the hole -- stated rather than hidden.
 *
 * `packages/api-client/src/token-store.spec.ts` contains a deliberate
 * `localStorage.setItem("access_token", ...)` string as a mutation fixture, proving its
 * own comment-stripping actually catches the pattern. Flagging that would be flagging a
 * test for testing the rule.
 *
 * The cost: a test helper could persist a token and this would not say so. It cannot
 * ship -- test files are not bundled -- but a helper that later gets imported by
 * non-test code would escape. The tighter check for the package that owns the token is
 * in that spec file, which reads its own production source directly.
 */
const isTest = (rel) => /\.(spec|itest|e2e|test)\.(ts|mts|tsx)$/.test(rel);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP_DIRS.has(entry)) return [];
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Strip comments, so prose stating the rule is not a breach of it. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
}

const files = ROOTS.flatMap(walk).filter((f) => /\.(ts|mts|tsx|mjs|js|jsx)$/.test(f));
const offenders = [];
let checked = 0;

for (const file of files) {
  const rel = relative(".", file).split(sep).join("/");
  if (isTest(rel)) continue;

  checked += 1;

  const lines = stripComments(readFileSync(file, "utf8")).split("\n");

  for (const [index, line] of lines.entries()) {
    if (!STORAGE.test(line)) continue;

    // The storage call plus the next few lines: `localStorage.setItem(` and the key
    // are frequently on different lines once a formatter has been through.
    const context = lines.slice(index, index + WINDOW + 1).join("\n");
    if (!TOKENISH.test(context)) continue;

    offenders.push({
      file: rel,
      line: index + 1,
      text: line.trim().slice(0, 100),
    });
  }
}

if (offenders.length === 0) {
  console.log(
    `check-token-storage: ${checked} file(s) checked, no token reaches browser storage.`,
  );
  process.exit(0);
}

console.error("");
console.error("x an auth token is being put into browser storage:");
console.error("");
for (const o of offenders) {
  console.error(`    ${o.file}:${o.line}`);
  console.error(`      ${o.text}`);
}
console.error("");
console.error("  docs/FRONTEND/02 § Auth Token Storage: the access token lives in");
console.error("  memory and nowhere else; the refresh token is an HTTP-only cookie JS");
console.error("  cannot read at all. A token in localStorage turns every XSS in the");
console.error("  product from a session-length problem into a permanent one.");
console.error("");
console.error("  Use accessTokenStore from @wi/api-client. Losing the token on reload");
console.error("  is the intended behaviour: the refresh cookie buys a new one on the");
console.error("  first request, which costs one round trip and is the entire point.");
console.error("");
process.exit(1);
