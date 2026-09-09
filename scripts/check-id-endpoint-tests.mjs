#!/usr/bin/env node
/**
 * P0-03 — the :id-endpoint guard.
 *
 * docs/SECURITY/05-MULTI-TENANCY-SECURITY.md is the project's first priority and states
 * zero tolerance for cross-tenant leaks. Global DoD item 2 in TASKS/00-TASK-CONVENTIONS.md
 * requires an IDOR test for every endpoint that accepts a resource id.
 *
 * A checklist people are asked to remember is a checklist that gets skipped under deadline
 * pressure, and the skip is invisible. This converts it into a build failure: a diff that
 * adds a route taking an :id parameter must also touch a test file.
 *
 * It is deliberately crude. It cannot tell whether the test is a *good* IDOR test — only
 * that the author wrote one. That is worth having anyway: the failure mode it catches is
 * "nobody thought about it", not "somebody thought about it badly".
 *
 * Usage:
 *   node scripts/check-id-endpoint-tests.mjs [baseRef]
 * Defaults to comparing against origin/main, falling back to HEAD~1 locally.
 */

import { execFileSync } from 'node:child_process';

const ROUTE_PATTERNS = [
  // NestJS / Express decorators and route registrations carrying a path parameter
  /@(Get|Post|Patch|Put|Delete)\(\s*['"`][^'"`]*:[A-Za-z_]/,
  /\.(get|post|patch|put|delete)\(\s*['"`][^'"`]*:[A-Za-z_]/,
];

const TEST_FILE = /(\.spec\.|\.test\.|\/tests?\/|\/e2e\/)/;
const SOURCE_FILE = /\.(ts|tsx|js|mjs)$/;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function resolveBase(explicit) {
  if (explicit) return explicit;
  for (const ref of ['origin/main', 'origin/develop', 'main']) {
    try {
      git(['rev-parse', '--verify', '--quiet', ref]);
      return ref;
    } catch {
      /* try the next one */
    }
  }
  return 'HEAD~1';
}

const base = resolveBase(process.argv[2]);

let changed;
try {
  changed = git(['diff', '--name-only', `${base}...HEAD`]).split('\n').filter(Boolean);
} catch {
  // A repository with a single commit has nothing to compare against yet.
  console.log('check-id-endpoint-tests: no comparable base ref, skipping.');
  process.exit(0);
}

const sourceFiles = changed.filter((f) => SOURCE_FILE.test(f) && !TEST_FILE.test(f));
const touchedTests = changed.some((f) => TEST_FILE.test(f));

const offenders = [];
for (const file of sourceFiles) {
  let added;
  try {
    added = git(['diff', '-U0', `${base}...HEAD`, '--', file]);
  } catch {
    continue;
  }
  const addedLines = added
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1));

  for (const line of addedLines) {
    if (ROUTE_PATTERNS.some((re) => re.test(line))) {
      offenders.push({ file, line: line.trim() });
      break;
    }
  }
}

if (offenders.length === 0) {
  console.log('check-id-endpoint-tests: no new :id routes in this diff.');
  process.exit(0);
}

if (touchedTests) {
  console.log(
    `check-id-endpoint-tests: ${offenders.length} new :id route(s), and this diff also touches tests. OK.`,
  );
  process.exit(0);
}

console.error('');
console.error('x This change adds an endpoint that accepts a resource id, and touches no test file.');
console.error('');
for (const o of offenders) {
  console.error(`    ${o.file}`);
  console.error(`      ${o.line}`);
}
console.error('');
console.error('  Every :id endpoint needs a test proving that a different user receives 404');
console.error('  with none of the resource data in the body — not 403, which would confirm the');
console.error('  resource exists and turn the endpoint into an enumeration oracle.');
console.error('');
console.error('  See docs/SECURITY/05-MULTI-TENANCY-SECURITY.md (zero tolerance),');
console.error('      docs/API/00-API-STANDARDS.md - 403 vs 404,');
console.error('      TASKS/00-TASK-CONVENTIONS.md - global Definition of Done item 2.');
console.error('');
console.error('  The helper built in P0-19/P1-06 makes this a one-liner: createTwoTenants().');
console.error('');
process.exit(1);
