#!/usr/bin/env node
/**
 * P0-11 — the tenant-scope guard.
 *
 * `src/shared/tenancy/` exists so that fetching a tenant-owned row without an owner
 * filter is absent from the exported surface. That guarantee holds only as long as
 * everything goes through it: one controller importing `invitations` from the schema
 * and writing its own `db.select()` puts the hole straight back, and the diff looks
 * entirely reasonable.
 *
 * So: only the tenancy layer and the migration tooling may import the invitation tables
 * directly. Everything else asks the repository.
 *
 * This is deliberately structural rather than clever. It cannot tell a safe ad-hoc
 * query from an unsafe one — it refuses the category, because "this particular direct
 * query is fine" is a judgement that gets made once carefully and then copied.
 *
 * Usage: node scripts/check-tenant-scope.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "backend/api/src";

/** Tables that carry tenant-owned data. Reaching these needs the repository. */
const GUARDED = [
  "invitations",
  "invitationSettings",
  "invitationPeople",
  "invitationEvents",
  "invitationGallery",
  "invitationBankAccounts",
  "invitationQuote",
  "invitationGuests",
  "invitationGuestbook",
  "invitationPreviewTokens",
  "invitationStatusHistory",
  "invitationCustomDomains",
  "invitationViewCounts",
  /**
   * Added by `P1-17`. A `media` row with a non-null `invitation_id` is a user's photo and
   * is tenant-owned in exactly the way `invitation_gallery` is; the table was absent from
   * this list only because it ALSO holds template assets, where `invitation_id` is null.
   * That dual use is a reason to route access through the tenancy layer, not an exemption
   * from it -- `findOwnedMedia` refuses a template asset precisely because the join has
   * nothing to join to.
   */
  "media",
];

/**
 * Allowed to import them directly:
 *   - the tenancy layer itself, which is the thing that applies the scope
 *   - the schema barrel and schema files, which define them
 *   - the migration CLI, which runs as the owner and has no request context at all
 */
const ALLOWED = [
  "shared/tenancy/",
  "infra/db/schema/",
  "infra/db/migrate.mts",
  "infra/db/rollback.mts",
  "infra/db/seed.mts",

  /**
   * The status writer (P0-14). It is the ONLY module allowed to write
   * `invitations.status` -- `scripts/check-status-writes.mjs` enforces that -- and it
   * needs a `SELECT ... FOR UPDATE` and an `UPDATE` inside one transaction, which is not
   * something the read-oriented tenancy repository exposes.
   *
   * THIS ENTRY IS A HOLE, and it is worth being blunt about it. That service takes an
   * invitation id and does NOT check ownership; it assumes the caller already proved it
   * through P0-11. If a future caller forgets, the status service will happily transition
   * someone else's invitation and neither guard will notice.
   *
   * The P0-11 record predicted this exact pressure -- "ALLOWED is a list that will be
   * asked to grow ... adding one is the cheapest possible way to reintroduce the hole".
   * It was asked one task later. Every future addition deserves the same scrutiny and a
   * sentence here saying what it costs.
   */
  "shared/invitation-status/",
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(ROOT).filter((f) => /\.(ts|mts)$/.test(f) && !/\.spec\.ts$/.test(f));

const offenders = [];
for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (ALLOWED.some((prefix) => rel.startsWith(prefix))) continue;

  const source = readFileSync(file, "utf8");

  // Import statements only. A comment mentioning `invitations` is not a violation, and
  // flagging one would train people to phrase comments around the checker.
  const imports = source.match(/import\s+[\s\S]*?from\s+["'][^"']*schema[^"']*["']/g) ?? [];
  for (const statement of imports) {
    const named = GUARDED.filter((t) => new RegExp(`\\b${t}\\b`).test(statement));
    if (named.length > 0) {
      offenders.push({ file: `${ROOT}/${rel}`, tables: named });
    }
  }
}

if (offenders.length === 0) {
  console.log(
    `check-tenant-scope: ${files.length} file(s) checked, no direct access to tenant-owned tables.`,
  );
  process.exit(0);
}

console.error("");
console.error("x Direct import of a tenant-owned table outside the tenancy layer:");
console.error("");
for (const o of offenders) {
  console.error(`    ${o.file}`);
  console.error(`      imports: ${o.tables.join(", ")}`);
}
console.error("");
console.error("  docs/SECURITY/05 is the project's number one security priority, with zero");
console.error("  tolerance for regressions. src/shared/tenancy/ exists so that a query");
console.error("  without an owner filter is not something you can write by accident --");
console.error("  importing the table directly puts that hole straight back.");
console.error("");
console.error("  Use InvitationRepository instead:");
console.error("");
console.error("    findOwned(id, scope)                       one invitation, if it is theirs");
console.error("    findOwnedList(scope, filters)              their invitations, filtered in SQL");
console.error("    findOwnedChild(table, childId, id, scope)  a child, both conditions in one query");
console.error("    adminFindInvitationBypassingOwnership(...)  audited bypass, support only");
console.error("");
console.error("  If a genuinely new access pattern is needed, add it to the repository so it");
console.error("  is reviewed once, in the one file that is supposed to be read carefully.");
console.error("");
process.exit(1);
