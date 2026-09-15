import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DOMAIN_JOBS } from "../src/jobs/domain-jobs";

/**
 * `P3-06`, ADR-078 — the API's jobs process consumes queues that `backend/worker` catalogues (and, for
 * cron jobs, schedules).
 *
 * Two packages, one contract, and nothing in the type system connects them: a job consumed here that the
 * worker's catalogue does not know would never be scheduled or would have no retry policy, and one the
 * worker ALSO registers a handler for would run two implementations of one rule. Both are checked against
 * the worker's source.
 */

const WORKER = join(__dirname, "..", "..", "worker", "src");
const catalogue = readFileSync(join(WORKER, "jobs.ts"), "utf8");
const handlers = readFileSync(join(WORKER, "handlers", "index.ts"), "utf8");

const escape = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("domain jobs", () => {
  it.each(Object.keys(DOMAIN_JOBS))(
    "%s is in the worker's job catalogue",
    (name) => {
      // Cron keys are bare identifiers; triggered job keys are quoted because they contain a dot.
      const key = name.includes(".") ? `"${escape(name)}"` : escape(name);
      expect(catalogue).toMatch(
        new RegExp(`${key}: \\{\\s*name: "${escape(name)}",`),
      );
    },
  );

  it.each(Object.keys(DOMAIN_JOBS))(
    "%s has no second consumer registered in the worker",
    (name) => {
      expect(handlers).not.toMatch(
        new RegExp(`runner\\.register\\(\\s*"${escape(name)}"`),
      );
    },
  );
});
