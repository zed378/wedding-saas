#!/usr/bin/env node
/**
 * P1-20 — the "source files stay text" guard.
 *
 * A source file containing a raw control character is one **git classifies as binary**. It
 * stops producing diffs for it, `git blame` stops being useful on it, and a review of a
 * change to that file shows `Bin 5110 -> 5561 bytes` instead of the change. For a file whose
 * whole content is fixtures or a security-relevant regex, that is a bad property to acquire
 * silently.
 *
 * It has happened twice in this repository, both times without anybody typing a control
 * character on purpose:
 *
 *   `backend/api/test/file-format.spec.ts` — a GIF header and a RIFF chunk length written as
 *     string literals with the real bytes in them;
 *   `frontend/web-app/src/lib/safe-next.ts` — a character class that ended up holding a real
 *     NUL, 0x1F and 0x7F where a space and a dash were meant.
 *
 * Both are easy to write and impossible to see. The fix in each case was to spell the bytes
 * as escape sequences, which reads better anyway.
 *
 * ## What counts
 *
 * Any byte below 0x20 that is not tab, newline or carriage return, plus DEL (0x7F). Tab and
 * the newline pair are ordinary formatting. This is deliberately narrower than "non-ASCII":
 * the source is full of em dashes and Indonesian text, and none of that troubles git.
 *
 * Usage: node scripts/check-text-sources.mjs
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
  "test-results",
]);

const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|css|json|md)$/;

/** Tab (9), LF (10) and CR (13) are formatting. Everything else below 0x20, plus DEL. */
function offendingBytes(buffer) {
  const found = new Map();

  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i];
    const isFormatting = byte === 9 || byte === 10 || byte === 13;
    if ((byte >= 0x20 && byte !== 0x7f) || isFormatting) continue;

    const line = buffer.subarray(0, i).toString("utf8").split("\n").length;
    const key = `0x${byte.toString(16).padStart(2, "0")}`;
    if (!found.has(key)) found.set(key, line);
  }

  return found;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP_DIRS.has(entry)) return [];
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = ROOTS.flatMap(walk).filter((f) => SOURCE.test(f));
const offenders = [];

for (const file of files) {
  const found = offendingBytes(readFileSync(file));
  if (found.size === 0) continue;

  offenders.push({
    file: relative(".", file).split(sep).join("/"),
    bytes: [...found.entries()].map(([byte, line]) => `${byte} (line ${line})`),
  });
}

if (offenders.length === 0) {
  console.log(
    `check-text-sources: ${files.length} file(s) checked, all of them plain text.`,
  );
  process.exit(0);
}

console.error("");
console.error("x A source file contains raw control characters:");
console.error("");
for (const o of offenders) {
  console.error(`    ${o.file}`);
  console.error(`      ${o.bytes.join(", ")}`);
}
console.error("");
console.error("  Git classifies such a file as BINARY. It stops producing diffs for it,");
console.error("  blame stops being useful, and a review shows a byte count instead of the");
console.error("  change -- which is a poor property for a file whose content is fixtures or");
console.error("  a security-relevant pattern.");
console.error("");
console.error("  Spell the bytes as escape sequences instead:");
console.error("");
console.error("    Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])   // not \"GIF89a…\"");
console.error("    /[\\u0000-\\u001F\\u007F]/                            // not a literal class");
console.error("");
process.exit(1);
