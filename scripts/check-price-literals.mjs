#!/usr/bin/env node
/**
 * P3-01 — no price in application code.
 *
 * `docs/SECURITY/07` § Pricing: *"`amount_total` is ALWAYS calculated server-side from the
 * `packages`/`addons` table"*. `docs/PLAN/09` § Package: *"no price constant belongs in
 * application code"*. And the card's first DoD item: *"No price literal exists anywhere in
 * application code."*
 *
 * ## Why a guard
 *
 * The first price literal is never a pricing decision. It is a checkout page that needs a
 * number before the catalogue endpoint exists, a default in a DTO, a fixture that leaked into
 * a component story. It displays correctly — until the row changes, and the page shows a price
 * the server no longer charges. The server would still charge correctly, and the customer would
 * see a different number from the one they paid.
 *
 * ## What it forbids
 *
 * Every non-zero price seeded into `packages` and `addons` — read from the seed script, so the
 * list follows the price rather than this file — in any of the ways a person writes rupiah:
 * `139000`, `139_000`, `139.000`, `139,000`, and `139000n`. Anywhere under `backend/`,
 * `frontend/`, `admin/` and `packages/` source.
 *
 * ## Exempt
 *
 *   - the seed scripts, which are the one place a price is written down;
 *   - test files and test support (`*.spec.*`, `*.itest.*`, `test/`, `e2e/`), which must be
 *     allowed to name a figure to prove the server charges it;
 *   - build output and dependencies.
 *
 * Usage:  node scripts/check-price-literals.mjs
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SEED = join(ROOT, "backend", "api", "src", "infra", "db", "seed.mts");
const SCAN = ["backend", "frontend", "admin", "packages"];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
  "test",
  "tests",
  "seed-data",
]);
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs)$/;
const TEST_FILE = /\.(spec|test|itest|e2e)\.[cm]?[jt]sx?$/;
const EXEMPT_FILES = new Set([SEED]);

/**
 * The seeded prices. The seed's `INSERT INTO packages (...) VALUES ('id', 'Name', <price>, ...)`
 * and `INSERT INTO addons (...) VALUES ('id', 'Name', <price>, ...)` rows: the third value of
 * each tuple.
 */
function seededPrices() {
  const text = readFileSync(SEED, "utf8");
  const prices = new Set();
  for (const match of text.matchAll(
    /\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*(\d+)\s*,/g,
  )) {
    const value = Number(match[1]);
    // Zero is every inactive addon's placeholder and every counter's start; it is not a price.
    // Below 1,000 rupiah nothing is sold, and a guard on small integers would flag loop bounds.
    if (value >= 1000) prices.add(match[1]);
  }
  return [...prices];
}

/** `139000` → a pattern for 139000, 139_000, 139.000, 139,000 and 139000n, as a whole number. */
function patternFor(digits) {
  const groups = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  const grouped = groups.join("[_.,]?");
  return new RegExp(`(?<![\\d_.,])${grouped}n?(?![\\d_]|[.,]\\d)`);
}

function sources(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...sources(full));
    } else if (SOURCE.test(name) && !TEST_FILE.test(name)) {
      found.push(full);
    }
  }
  return found;
}

const prices = seededPrices();
if (prices.length === 0) {
  console.error(
    "check-price-literals: found no prices in the seed; the pattern no longer matches it.",
  );
  process.exit(2);
}

const patterns = prices.map((price) => ({ price, pattern: patternFor(price) }));
const failures = [];
let checked = 0;

for (const top of SCAN) {
  const dir = join(ROOT, top);
  if (!existsSync(dir)) continue;
  for (const file of sources(dir)) {
    if (EXEMPT_FILES.has(file)) continue;
    checked += 1;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const { price, pattern } of patterns) {
        if (pattern.test(line)) {
          failures.push(
            `${relative(ROOT, file)}:${String(i + 1)}  seeded price ${price}: ${line.trim()}`,
          );
        }
      }
    });
  }
}

if (failures.length > 0) {
  console.error(
    "check-price-literals: a seeded price appears in application code.\n",
  );
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    "\nPrices come from the packages and addons rows (docs/SECURITY/07 § Pricing). Read them from the API.",
  );
  process.exit(1);
}

console.log(
  `check-price-literals: ${String(checked)} file(s) checked, no seeded price (${prices.join(", ")}) in application code.`,
);
