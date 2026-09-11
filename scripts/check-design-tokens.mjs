#!/usr/bin/env node
/**
 * P0-22 — the design-token guard. DoD item 2:
 *
 *   "No colour, font size or spacing value is hard-coded in an app; a lint rule
 *    enforces token use."
 *
 * `docs/UI-UX/06` makes the token set "the single source of truth for application UI
 * components", and `docs/UI-UX/08` § Dark Mode depends on it outright: dark mode is
 * possible later only because every colour is a token and "not hard-coded colors per
 * component". One `#4f46e5` typed into a component is one thing that will not change
 * when the theme does — and nobody finds it until a user is looking at it.
 *
 * ## What is forbidden, and where
 *
 * In `packages/ui/src`, the three frontend surfaces, and `admin/src`:
 *
 *   - a hex colour, `rgb(...)`, `rgba(...)` or `hsl(...)` literal
 *   - a Tailwind arbitrary value carrying a colour or a length: `bg-[#fff]`,
 *     `text-[13px]`, `p-[7px]`
 *   - a raw CSS length in a `style={{ ... }}` object: `fontSize: "13px"`
 *
 * ## What is allowed, and why
 *
 * `packages/ui/src/tokens.css` — it is the definition. Excluding it is not a loophole;
 * a rule that forbade colours in the file whose job is declaring colours would be
 * incoherent.
 *
 * Test files — a test asserting a contrast ratio has to name two colours, and a fixture
 * has to be allowed to be ugly.
 *
 * A `width` computed from data, as in `Dropzone`'s progress bar: a percentage of a
 * runtime number is not a design decision and cannot come from a token. Percentages are
 * therefore not flagged.
 *
 * The template renderer (`packages/template-renderer`) is **outside this rule entirely**.
 * `docs/PLAN/07` makes an invitation's colours per-template data, and forcing them
 * through the application's chrome tokens would give every wedding the dashboard's
 * indigo.
 *
 * Usage: node scripts/check-design-tokens.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOTS = [
  "packages/ui/src",
  "packages/api-client/src",
  "frontend/web-app/src",
  "frontend/public-invite/src",
  "admin/src",
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage"]);

/** The token definition itself, plus anything whose job is to be a fixture. */
const ALLOWED = ["packages/ui/src/tokens.css"];
const isTest = (rel) => /\.(spec|itest|e2e|test)\.(ts|mts|tsx)$/.test(rel);

const PATTERNS = [
  {
    re: /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/,
    what: "a hard-coded hex colour",
  },
  {
    re: /\b(?:rgba?|hsla?)\(/,
    what: "a hard-coded colour function",
  },
  {
    // bg-[#fff], text-[13px], p-[7px], gap-[3px] -- Tailwind's escape hatch.
    re: /\b[a-z-]+-\[(?:#|\d+(?:\.\d+)?(?:px|rem|em)\b)/,
    what: "a Tailwind arbitrary colour or length",
  },
  {
    // fontSize: "13px" and friends inside a style object.
    re: /\b(?:fontSize|lineHeight|letterSpacing|borderRadius|margin|padding|gap)\s*:\s*["'`]\d/,
    what: "a raw length in a style object",
  },
];

/**
 * Exceptions inside an otherwise-flagged line.
 *
 * `var(--color-focus)` is a token reference that happens to sit inside a Tailwind
 * arbitrary value, which is the documented way to use a token Tailwind has no utility
 * for. Flagging it would push people back to a literal.
 */
const ALLOWED_ON_LINE = [/\[var\(--/, /--color-|--text-|--spacing|--radius-|--shadow-/];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP_DIRS.has(entry)) return [];
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Strip comments, so a note explaining a colour choice is not a colour. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
}

const files = ROOTS.flatMap(walk).filter((f) =>
  /\.(ts|tsx|css)$/.test(f),
);
const offenders = [];
let checked = 0;

for (const file of files) {
  const rel = relative(".", file).split(sep).join("/");
  if (ALLOWED.includes(rel)) continue;
  if (isTest(rel)) continue;

  checked += 1;
  const lines = stripComments(readFileSync(file, "utf8")).split("\n");

  for (const [index, line] of lines.entries()) {
    if (ALLOWED_ON_LINE.some((re) => re.test(line))) continue;

    for (const { re, what } of PATTERNS) {
      if (!re.test(line)) continue;
      offenders.push({
        file: rel,
        line: index + 1,
        what,
        text: line.trim().slice(0, 100),
      });
      break;
    }
  }
}

if (offenders.length === 0) {
  console.log(
    `check-design-tokens: ${checked} file(s) checked, no hard-coded colour, size or spacing.`,
  );
  process.exit(0);
}

console.error("");
console.error("x a colour, size or spacing value is hard-coded:");
console.error("");
for (const o of offenders) {
  console.error(`    ${o.file}:${o.line}`);
  console.error(`      ${o.what}: ${o.text}`);
}
console.error("");
console.error("  docs/UI-UX/06 makes the token set the single source of truth for");
console.error("  application UI, and docs/UI-UX/08 § Dark Mode depends on it: a dark");
console.error("  theme is possible later only because every colour is a token rather");
console.error("  than 'hard-coded colors per component'. One literal is one thing that");
console.error("  will not change when the theme does.");
console.error("");
console.error("  Use a token from packages/ui/src/tokens.css -- the Tailwind utility");
console.error("  (bg-primary-600, text-body, gap-4) or var(--color-primary-600) where");
console.error("  no utility exists.");
console.error("");
process.exit(1);
