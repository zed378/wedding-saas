#!/usr/bin/env node
/**
 * P0-14 — the status-write guard.
 *
 * `docs/DATABASE/04` § Notes requires every `invitations.status` change to write an
 * `invitation_status_history` row, at the service layer so `changed_by` and `reason`
 * carry application context. `InvitationStatusService` is that layer.
 *
 * The guarantee is only worth as much as its exclusivity. One `db.update(invitations)
 * .set({ status: 'published' })` in a hotfix and there is an invitation whose journey
 * nobody can reconstruct -- and the diff will look like two lines of obvious code.
 *
 * So: only the status service may write that column. This checks for the shapes that
 * actually occur -- a Drizzle `.set({ status })` on `invitations`, and raw SQL
 * `UPDATE invitations SET status`.
 *
 * It is a text check and it can be evaded. It is not trying to stop a determined
 * author; it is trying to stop an ordinary one from doing the natural thing without
 * noticing there was a rule.
 *
 * Usage: node scripts/check-status-writes.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = "backend/api/src";

/** The one module allowed to write it, plus the schema that defines the column. */
const ALLOWED = ["shared/invitation-status/", "infra/db/schema/"];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Strip comments, so prose about status writes is not a violation. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const PATTERNS = [
  // Drizzle: .update(invitations) ... .set({ ... status ... })
  {
    re: /\.update\(\s*invitations\s*\)[\s\S]{0,400}?\.set\(\s*\{[^}]*\bstatus\b/,
    what: "a Drizzle update setting invitations.status",
  },
  // Raw SQL, in a string or a sql`` template.
  {
    re: /UPDATE\s+"?invitations"?\s+SET[\s\S]{0,200}?\bstatus\b/i,
    what: "raw SQL setting invitations.status",
  },
];

const files = walk(ROOT).filter((f) => /\.(ts|mts)$/.test(f));
const offenders = [];
let checked = 0;

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join("/");
  if (ALLOWED.some((prefix) => rel.startsWith(prefix))) continue;

  checked += 1;
  const source = stripComments(readFileSync(file, "utf8"));

  for (const { re, what } of PATTERNS) {
    if (re.test(source)) offenders.push({ file: `${ROOT}/${rel}`, what });
  }
}

if (offenders.length === 0) {
  console.log(
    `check-status-writes: ${checked} file(s) checked, invitations.status written only by the status service.`,
  );
  process.exit(0);
}

console.error("");
console.error("x invitations.status written outside InvitationStatusService:");
console.error("");
for (const o of offenders) {
  console.error(`    ${o.file}`);
  console.error(`      ${o.what}`);
}
console.error("");
console.error("  docs/DATABASE/04 requires every status transition to write an");
console.error("  invitation_status_history row, at the service layer so changed_by and");
console.error("  reason carry application context. A status change without that row");
console.error("  leaves an invitation in a state nobody can explain.");
console.error("");
console.error("  Use InvitationStatusService.transition(id, to, actor, reason) instead.");
console.error("  It validates the transition against docs/PLAN/06, writes both rows in");
console.error("  one transaction, and locks the row so two concurrent requests cannot");
console.error("  record incompatible journeys.");
console.error("");
process.exit(1);
