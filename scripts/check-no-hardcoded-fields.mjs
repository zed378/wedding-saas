#!/usr/bin/env node
/**
 * P1-23 step 6 — the template-system guard.
 *
 * `CLAUDE.md`'s "what not to do" list opens with it: "Don't hard-code section/field logic per
 * template in frontend components — that defeats the entire template system." The sentence is
 * true and a sentence does not enforce anything. Under deadline pressure the shortest path to
 * a working screen is always `if (sectionKey === "hero")`, and it always works — for the one
 * template somebody was looking at.
 *
 * So: **no component file may contain a section key or a canonical field path as a literal.**
 * The registry may, the tests may, the fixtures may. A component may not.
 *
 * ## What is checked
 *
 * The two vocabularies, read from `@wi/schema` rather than restated — a copy here would drift
 * from the thing it is guarding:
 *
 *   `SECTION_KEYS`  — `hero`, `couple`, `quote`, `event`, `gallery`, `maps`, `gift`, `rsvp`,
 *                     `guestbook`, `closing`;
 *   `INVITATION_FIELD_PATHS` — every path a template may reference.
 *
 * A section key is only flagged inside a **string literal**, because `gift` and `quote` are
 * ordinary words that appear in comments, prop names and Indonesian prose. A field path is
 * flagged anywhere: `couple.groom.nickname` is not a phrase anybody writes by accident.
 *
 * ## Where it does not apply
 *
 * `src/editor/fields/registry.ts` is the map from paths to controls — its entire content is
 * the thing being banned elsewhere, which is what makes banning it elsewhere meaningful.
 * `packages/schema` defines the vocabularies. Tests and fixtures must name paths to assert
 * anything at all.
 *
 * Usage: node scripts/check-no-hardcoded-fields.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOTS = ["frontend", "admin"];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
  "test-results",
]);

/**
 * Allowed to name a path or a section key.
 *
 * Each entry is a place whose job IS the mapping. Adding one is adding a place where a
 * template can be special-cased, so each needs a sentence saying why it cannot be.
 */
const ALLOWED = [
  // The registry. Its whole content is the map this guard protects.
  "frontend/web-app/src/editor/fields/registry.ts",
  /*
   * The autosave transport: `defaultGroupFor` and `endpointFor` together ARE the
   * path-to-endpoint mapping, and `docs/API/04`'s sub-resource tree is fixed and independent
   * of any template. This is the only file allowed to know it — `defaultGroupFor` lived in
   * `autosave.ts` until this guard found it there, and moving it was the right answer rather
   * than exempting a second file.
   */
  "frontend/web-app/src/editor/transport.ts",
  // The renderer package's own registry, when P2-02 adds one.
  "packages/template-renderer/src/",
  /*
   * P2-08. The public invitation's response TYPE. `docs/API/08` serves the invitation in
   * `docs/PLAN/08`'s canonical shape (ADR-063), so declaring that type means naming those
   * paths — the alternative is `Record<string, unknown>`, which would let the page read
   * anything and would describe nothing. It is a statement about the data model, fixed
   * across every template, and there is not a branch in the file.
   */
  "frontend/public-invite/src/lib/public-invitation.ts",
  /*
   * P2-08. `generateMetadata` reads the cover photo and the first event, because
   * `docs/FRONTEND/07` § SEO Meta Generation says exactly which fields a link preview is
   * built from: "og:image is taken from the photo with is_cover=true in the gallery".
   * That is one rule for every template — a template cannot change what a WhatsApp card
   * shows — and the page itself renders through the generic renderer like every other
   * consumer, with no knowledge of which template it is showing.
   */
  "frontend/public-invite/src/app/[slug]/page.tsx",
  /*
   * P2-09. The same rule, moved into its own module so it can be unit tested: this is
   * where `og:image`, the description and the schema.org `Event` are built. The fields it
   * names are fixed by `docs/PLAN/15` and `docs/FRONTEND/07` for every invitation on the
   * platform — a link preview is not a template's to design — and the file is a pure
   * function with no branch on a template or a section key. Its own test asserts over the
   * whole serialized result that nothing ELSE reaches a scraper, which is the property
   * that actually matters here.
   */
  "frontend/public-invite/src/lib/metadata.ts",
];

const isTest = (rel) =>
  /\.(spec|test|itest|e2e|ssr)\.(ts|tsx)$/.test(rel) ||
  rel.includes("/test/") ||
  // P2-08: the public invitation's server-rendering suite. It lives in its own directory
  // because it needs a production build to run against, not because it is less of a test.
  rel.includes("/test-ssr/") ||
  rel.includes("/tests/") ||
  rel.includes("/fixtures/");

const SOURCE = /\.(ts|tsx)$/;

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP_DIRS.has(entry)) return [];
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/**
 * Read the vocabularies from `@wi/schema`'s SOURCE, not from a copy and not from its build.
 *
 * The TypeScript files are imported directly — Node 24 strips types natively — because this
 * guard runs in `verify.sh` **before** the build step, so `dist/` may be stale or absent. A
 * copy of either list in this file would drift from the thing it is guarding, which is the
 * one failure that would make the guard worse than useless: green while wrong.
 */
async function vocabularies() {
  const components =
    await import("../packages/schema/src/template/component-registry.ts");
  const fields =
    await import("../packages/schema/src/invitation/field-registry.ts");

  return {
    sectionKeys: components.SECTION_KEYS,
    fieldPaths: fields.INVITATION_FIELD_PATHS,
  };
}

/** Strip comments: prose about `couple.groom.nickname` is not hard-coding. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** Every single- double- or back-quoted string in the source. */
function stringLiterals(source) {
  return [
    ...source.matchAll(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`/g),
  ].map((m) => m[0]);
}

const { sectionKeys, fieldPaths } = await vocabularies();

const files = ROOTS.flatMap(walk).filter((f) => SOURCE.test(f));
const offenders = [];
let checked = 0;

for (const file of files) {
  const rel = relative(".", file).split(sep).join("/");
  if (ALLOWED.some((prefix) => rel.startsWith(prefix))) continue;
  if (isTest(rel)) continue;

  checked += 1;
  const source = stripComments(readFileSync(file, "utf8"));
  const found = [];

  // A field path, anywhere. Nobody writes `couple.groom.nickname` by accident.
  for (const path of fieldPaths) {
    if (path.includes("*")) {
      // `events.*.title` -> match `events.<anything>.title`, which is how a component
      // would actually spell it.
      const pattern = new RegExp(
        path
          .split(".")
          .map((s) => (s === "*" ? "[^.\"'`]+" : escape(s)))
          .join("\\."),
      );
      if (pattern.test(source)) found.push(path);
    } else if (source.includes(path)) {
      found.push(path);
    }
  }

  // A section key, but only inside a string literal: `gift` and `quote` are ordinary words.
  const literals = stringLiterals(source);
  for (const key of sectionKeys) {
    if (literals.some((literal) => literal.slice(1, -1) === key)) {
      found.push(`section key "${key}"`);
    }
  }

  if (found.length > 0)
    offenders.push({ file: rel, found: [...new Set(found)] });
}

function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (offenders.length === 0) {
  console.log(
    `check-no-hardcoded-fields: ${checked} file(s) checked, no section key or field path hard-coded.`,
  );
  process.exit(0);
}

console.error("");
console.error("x A component names a section key or a canonical field path:");
console.error("");
for (const o of offenders) {
  console.error(`    ${o.file}`);
  console.error(`      ${o.found.join(", ")}`);
}
console.error("");
console.error(
  "  CLAUDE.md: hard-coding section or field logic per template defeats the",
);
console.error(
  "  ENTIRE template system. A template is data (docs/PLAN/07) -- one generic",
);
console.error(
  "  renderer and one schema-driven form, not a component per section.",
);
console.error("");
console.error(
  "  The form is generated by iterating the active section's required_fields",
);
console.error(
  "  and optional_fields and resolving each through FIELD_REGISTRY. If a field",
);
console.error(
  "  needs different treatment, that belongs in the registry as metadata, not",
);
console.error("  in a component as a condition.");
console.error("");
process.exit(1);
