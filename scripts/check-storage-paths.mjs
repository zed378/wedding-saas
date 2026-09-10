#!/usr/bin/env node
/**
 * P0-16 — the storage-path guard.
 *
 * `docs/ARCHITECTURE/05` says the storage path carries `invitation_id` "for isolation &
 * audit purposes", which makes path construction a tenant isolation control rather than
 * a formatting concern. `@wi/storage` enforces that with a branded `StorageKey` that
 * only its own builders can produce, so a caller with a string does not have a key.
 *
 * TypeScript enforces this already -- but a cast defeats it in one word, and
 * `"invitations/" + id as StorageKey` reads like a shortcut rather than a hole. This
 * catches that shape, and hand-assembled bucket paths generally.
 *
 * Usage: node scripts/check-storage-paths.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOTS = ["backend/api/src", "backend/worker/src", "packages"];

/** The package that defines the type is allowed to produce it. */
const ALLOWED = ["packages/storage/src/"];

const PATTERNS = [
  { re: /\bas\s+StorageKey\b/, what: "a cast to StorageKey, which bypasses the builders" },
  {
    re: /["'`](?:user-media|template-assets|staging)\/[^"'`]*\$\{/,
    what: "a hand-assembled bucket path with interpolation",
  },
  {
    re: /["'`]invitations\/\$\{|["'`]templates\/\$\{|["'`]uploads\/\$\{/,
    what: "a hand-assembled storage key",
  },
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === "dist") return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const offenders = [];
let checked = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (!/\.(ts|mts)$/.test(file)) continue;
    const rel = file.split(sep).join("/");
    if (ALLOWED.some((prefix) => rel.startsWith(prefix))) continue;
    // Tests may construct expected paths as literals to assert against.
    if (/\.(spec|itest)\.ts$/.test(rel)) continue;

    checked += 1;
    const source = stripComments(readFileSync(file, "utf8"));
    for (const { re, what } of PATTERNS) {
      if (re.test(source)) offenders.push({ file: rel, what });
    }
  }
}

if (offenders.length === 0) {
  console.log(
    `check-storage-paths: ${checked} file(s) checked, storage keys built only by @wi/storage.`,
  );
  process.exit(0);
}

console.error("");
console.error("x A storage path built outside @wi/storage:");
console.error("");
for (const o of offenders) {
  console.error(`    ${o.file}`);
  console.error(`      ${o.what}`);
}
console.error("");
console.error("  docs/ARCHITECTURE/05: the path carries invitation_id for isolation and");
console.error("  audit. A path assembled at a call site is a path where the wrong id can be");
console.error("  interpolated -- one couple's photos filed under another couple's");
console.error("  invitation, found months later or never.");
console.error("");
console.error("  Use the builders instead:");
console.error("");
console.error("    mediaKey(invitationId, mediaId, variant)");
console.error("    templateAssetKey(templateId, version, assetName)");
console.error("    stagingKey(mediaId)");
console.error("    parseStoredKey(value)   // reading media.storage_path back");
console.error("");
process.exit(1);
