import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DOMAIN_JOBS } from "../src/jobs/domain-jobs";

/**
 * `P3-06`, ADR-078 — the API's jobs process consumes cron queues that `backend/worker` schedules.
 *
 * Two packages, one contract, and nothing in the type system connects them: a job consumed here that
 * the worker never schedules would simply never run, and one the worker ALSO registers a handler for
 * would run two implementations of one rule. Both are checked against the worker's source.
 */

const WORKER = join(__dirname, "..", "..", "worker", "src");
const catalogue = readFileSync(join(WORKER, "jobs.ts"), "utf8");
const handlers = readFileSync(join(WORKER, "handlers", "index.ts"), "utf8");

describe("domain jobs", () => {
  it.each(Object.keys(DOMAIN_JOBS))(
    "%s is scheduled by worker-cron's catalogue",
    (name) => {
      expect(catalogue).toMatch(
        new RegExp(`\\b${name}: \\{\\s*name: "${name}",\\s*pool: "cron"`),
      );
    },
  );

  it.each(Object.keys(DOMAIN_JOBS))(
    "%s has no second consumer registered in the worker",
    (name) => {
      expect(handlers).not.toMatch(
        new RegExp(`runner\\.register\\(\\s*"${name}"`),
      );
    },
  );
});
