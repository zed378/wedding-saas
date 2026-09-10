#!/usr/bin/env node
/**
 * P0-18 — the secret scanner.
 *
 * `docs/DEVOPS/00`: environment variables for staging and production are "managed via a
 * secret manager … NEVER committed to the repo". This is the machine enforcing that,
 * because the thing it catches is not carelessness — it is someone pasting a real value
 * into `.env.example` "just to test", or a debug script keeping a token, and then
 * committing everything.
 *
 * A leaked credential is not recoverable by deleting the commit. Once it is in the
 * history it is rotated or it is compromised, so the only useful moment to catch it is
 * before it lands.
 *
 * Scans the staged diff by default (what a commit hook wants), or a whole tree.
 *
 *   node scripts/check-secrets.mjs            # staged changes
 *   node scripts/check-secrets.mjs --all      # every tracked file
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

/**
 * Patterns for credentials that are recognisable by shape.
 *
 * Provider-specific prefixes first, because those have almost no false-positive rate —
 * a string starting `SB-Mid-server-` is a Midtrans key and nothing else. The generic
 * patterns are deliberately narrow: a scanner that cries wolf gets disabled, and a
 * disabled scanner catches nothing.
 */
const PATTERNS = [
  { name: "Midtrans server key", re: /\b(?:SB-)?Mid-server-[A-Za-z0-9_-]{10,}/ },
  { name: "Midtrans client key", re: /\b(?:SB-)?Mid-client-[A-Za-z0-9_-]{10,}/ },
  { name: "Resend API key", re: /\bre_[A-Za-z0-9]{20,}/ },
  { name: "AWS access key id", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: "Google API key", re: /\bAIza[A-Za-z0-9_-]{35}\b/ },
  { name: "Cloudflare Turnstile secret", re: /\b0x[A-Za-z0-9]{30,}\b/ },
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  {
    name: "database URL with a password",
    // postgres://user:something@host -- but not the documented local placeholders.
    re: /\b(?:postgres|postgresql|redis|mongodb|mysql):\/\/[^\s:@/]+:(?!wedding_(?:app|owner)_dev\b|minio_dev_password\b|x\b|pw\b|password\b)[^\s:@/]{8,}@/,
  },
];

/** Files where a realistic-looking value is the point. */
const ALLOWED_FILES = [
  "scripts/check-secrets.mjs", // this file contains the patterns themselves
  "deploy/SECRETS.md", // documents the shapes so people recognise them
];

/**
 * Placeholders that must never be flagged.
 *
 * These are the local development credentials `P0-05` deliberately committed, labelled
 * as such in `deploy/README.md`. Flagging them would make the scanner useless on day one.
 */
const PLACEHOLDER = /\b(?:example|placeholder|changeme|your[-_]?|xxx+|dummy|fake|test)\b/i;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function stagedFiles() {
  return git(["diff", "--cached", "--name-only", "--diff-filter=ACM"])
    .split("\n")
    .filter(Boolean);
}

function trackedFiles() {
  return git(["ls-files"]).split("\n").filter(Boolean);
}

const all = process.argv.includes("--all");
const files = (all ? trackedFiles() : stagedFiles()).filter(
  (f) => !ALLOWED_FILES.includes(f) && !f.startsWith("node_modules/") && existsSync(f),
);

const findings = [];

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue; // binary or unreadable
  }
  if (content.includes("\0")) continue;

  content.split("\n").forEach((line, index) => {
    if (PLACEHOLDER.test(line)) return;

    for (const { name, re } of PATTERNS) {
      const match = re.exec(line);
      if (match !== null) {
        findings.push({
          file,
          line: index + 1,
          name,
          // Never print the value. A scanner that echoes the secret into a terminal,
          // a CI log and a screenshot has moved the leak rather than stopped it.
          preview: `${match[0].slice(0, 6)}…${match[0].length} chars`,
        });
      }
    }
  });
}

if (findings.length === 0) {
  console.log(`check-secrets: ${files.length} file(s) scanned, nothing that looks like a credential.`);
  process.exit(0);
}

console.error("");
console.error("x Something that looks like a real credential is about to be committed:");
console.error("");
for (const f of findings) {
  console.error(`    ${f.file}:${f.line}  ${f.name}  (${f.preview})`);
}
console.error("");
console.error("  docs/DEVOPS/00: secrets for staging and production live in a secret");
console.error("  manager and are NEVER committed. A leaked credential is not recoverable by");
console.error("  deleting the commit -- once it is in the history it is rotated or it is");
console.error("  compromised.");
console.error("");
console.error("  If this IS a real credential:");
console.error("    1. Do not commit. Remove it from the file.");
console.error("    2. Rotate it anyway if it has ever been written to disk in a shared repo.");
console.error("    3. See deploy/SECRETS.md for where it should live instead.");
console.error("");
console.error("  If it is a placeholder, include a word like `example` or `changeme` in the");
console.error("  line so it reads as one to a human as well as to this script.");
console.error("");
process.exit(1);
