#!/usr/bin/env node
/**
 * P2-02 — the guard that keeps the renderer generic.
 *
 * `CLAUDE.md`'s first non-negotiable:
 *
 *   "Templates are data, not code. No template-specific backend logic, no per-template
 *    React/Vue components."
 *
 * and the card's own DoD: "No template identifier appears in a conditional anywhere in
 * the package. A grep-based CI check enforces it."
 *
 * ## Why a guard rather than a review note
 *
 * The pressure this resists is real and arrives with a deadline. A template looks *almost*
 * right, one section needs a tweak, and `if (slug === "elegant-rose")` is four seconds of
 * work against an afternoon of doing it properly in the definition. It works. It ships.
 * And the second one is easier than the first, because there is already a precedent in
 * the file.
 *
 * By the tenth template the renderer is a switch statement and the claim that a template
 * is a database row has quietly stopped being true — which is the claim the admin
 * template editor, the version locking in BR-3.1, and the whole catalogue rest on.
 *
 * ## What is forbidden, inside `packages/template-renderer/src`
 *
 *   1. **A template identifier at all** — `templateId`, `template_id`, `templateSlug`,
 *      `template_slug`. The renderer receives a *definition*; which template it came
 *      from is not a fact it is entitled to know. Nothing can branch on a value it
 *      cannot name.
 *   2. **A known template slug as a literal** — read from the seeded template data, so
 *      the check stays true as templates are added.
 *   3. **`dangerouslySetInnerHTML`** — every value here is user data that `P1-16`
 *      sanitized for *storage*, not for injection into HTML. React escaping it is what
 *      makes a miss in the sanitizer visible rather than exploitable, and one such call
 *      would remove that property for the whole package.
 *   4. **A network call** — `fetch(`, `axios`, `XMLHttpRequest`. `docs/FRONTEND/04` makes
 *      this renderer shared by SSR, the editor and the demo; data arrives as props. One
 *      `fetch` ends all three at once.
 *
 * Test files are exempt from 1 and 2 only: a test has to be allowed to name a template to
 * prove the renderer does not care about it. They are NOT exempt from 3 or 4, because a
 * test that reached the network would be the thing that made it look acceptable.
 *
 * Usage:  node scripts/check-renderer-is-generic.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGE = join(ROOT, "packages", "template-renderer", "src");

/** `templateId` and friends. The renderer is not entitled to know which template it is. */
const IDENTIFIER = /\btemplate[_-]?(id|slug)\b/i;

const ALWAYS_FORBIDDEN = [
  {
    pattern: /dangerouslySetInnerHTML/,
    why: "every value here is user data; React escaping it is what makes a sanitizer miss visible rather than exploitable",
  },
  {
    pattern: /\bfetch\s*\(|XMLHttpRequest|\baxios\b/,
    why: "the renderer is shared by SSR, the editor and the demo -- data arrives as props (docs/FRONTEND/04)",
  },
];

/**
 * Template slugs, read from the seeded definitions rather than hard-coded here.
 *
 * A list written into this file would be one more thing to update when a template is
 * added, and the update nobody makes is the one that matters.
 */
function knownSlugs() {
  const slugs = new Set();
  const dir = join(ROOT, "backend", "api", "src", "infra", "db", "seed-data");

  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      continue;
    }
    if (typeof parsed?.slug === "string") slugs.add(parsed.slug);
    if (typeof parsed?.template?.slug === "string") slugs.add(parsed.template.slug);
  }

  return [...slugs];
}

function sources(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...sources(full));
    } else if (/\.(ts|tsx)$/.test(name)) {
      found.push(full);
    }
  }
  return found;
}

const slugs = knownSlugs();
const offenders = [];

for (const file of sources(PACKAGE)) {
  const isTest = /\.spec\.(ts|tsx)$/.test(file);
  const lines = readFileSync(file, "utf8").split("\n");

  lines.forEach((line, index) => {
    const at = { file: relative(ROOT, file), line: index + 1, text: line.trim() };

    for (const { pattern, why } of ALWAYS_FORBIDDEN) {
      if (pattern.test(line)) offenders.push({ ...at, why });
    }

    // A comment may discuss what is forbidden -- the long note at the top of this file
    // would otherwise fail its own check when quoted in the renderer's own docs.
    const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
    if (isTest) return;

    if (IDENTIFIER.test(code)) {
      offenders.push({
        ...at,
        why: "the renderer receives a definition; which template it came from is not a fact it may know",
      });
    }

    for (const slug of slugs) {
      if (code.includes(`"${slug}"`) || code.includes(`'${slug}'`)) {
        offenders.push({
          ...at,
          why: `"${slug}" is a template slug; a renderer that names one is not generic`,
        });
      }
    }
  });
}

if (offenders.length > 0) {
  console.error(
    "x The template renderer must not know about any particular template:\n",
  );
  for (const o of offenders) {
    console.error(`    ${o.file}:${String(o.line)}`);
    console.error(`      ${o.text}`);
    console.error(`      -> ${o.why}\n`);
  }
  console.error(
    "  CLAUDE.md: templates are data, not code. Everything a template needs belongs\n" +
      "  in template_versions.sections, rendered by one generic renderer.\n",
  );
  process.exit(1);
}

console.log(
  `check-renderer-is-generic: ${String(sources(PACKAGE).length)} file(s) checked, ` +
    `no template identifier, no innerHTML, no network call.`,
);
