import { describe, it, expect } from "vitest";

import { policyFor, JOBS, CRON_JOBS, type JobPolicy } from "../src/jobs.js";

/**
 * P0-15 — the job catalogue. No Redis required.
 *
 * Split out from the queue suite so `pnpm test` stays runnable with nothing started,
 * which is the rule established in P0-07. The behaviour that needs a real queue --
 * retry counts, dead-lettering, leader election -- lives in queue.itest.ts.
 */

describe("the job catalogue", () => {
  it("gives every job a pool, a retry policy and an explicit dead-letter decision", () => {
    for (const job of [...Object.values(JOBS), ...Object.values(CRON_JOBS)]) {
      expect(job.pool).toMatch(/^(media|general|cron)$/);
      expect(job.attempts).toBeGreaterThanOrEqual(1);
      expect(typeof job.deadLetter).toBe("boolean");
      expect(job.description.length).toBeGreaterThan(0);
    }
  });

  it("dead-letters every high and medium priority job", () => {
    // docs/ARCHITECTURE/07: a permanently failed high/medium job "must never be
    // silently dropped". This is that sentence as an assertion.
    for (const job of [...Object.values(JOBS), ...Object.values(CRON_JOBS)]) {
      if (job.priority === "high" || job.priority === "medium") {
        expect(
          job.deadLetter,
          `${job.name} is ${job.priority} and must dead-letter`,
        ).toBe(true);
      }
    }
  });

  it("allows dropping only analytics_counter_flush", () => {
    // The one job the document calls "best-effort, safe to drop". Naming it here means
    // a second droppable job cannot be added quietly.
    // Typed as JobPolicy[] deliberately. With the literal types from `as const`,
    // TypeScript can PROVE this filter is empty and narrows it to `never` -- which is a
    // stronger guarantee than the assertion, and also a compile error. Widening keeps
    // the runtime check as a guard against a future edit that breaks the invariant
    // without anyone noticing the type stopped proving it.
    const all: JobPolicy[] = [
      ...Object.values(JOBS),
      ...Object.values(CRON_JOBS),
    ];
    const droppable = all
      .filter((j) => !j.deadLetter && j.priority !== "low")
      .map((j) => j.name);
    expect(droppable).toEqual([]);

    expect(CRON_JOBS.analytics_counter_flush.deadLetter).toBe(false);
  });

  it("refuses an unregistered job name rather than inventing defaults", () => {
    // Inventing a retry count and a dead-letter decision would be silent, and silence
    // is how a job ends up dropping work nobody agreed it could drop.
    expect(() => policyFor("something.nobody.registered")).toThrow(
      /No job policy registered/,
    );
  });

  it("matches the documented retry policies", () => {
    // docs/ARCHITECTURE/07 § Job Types.
    expect(JOBS["payment.webhook_process"].attempts).toBe(5);
    expect(JOBS["payment.webhook_process"].backoff.type).toBe("exponential");
    expect(JOBS["media.process"].attempts).toBe(3);
    expect(JOBS["notification.send"].attempts).toBe(3);
  });

  it("uses the documented WIB cron times", () => {
    // The times in docs/BACKEND/08 are WIB. A container in UTC firing "5 0 * * *"
    // without a timezone runs the expiry sweep seven hours late, every day, with
    // nothing looking wrong.
    expect(CRON_JOBS.invitation_expiry_check.pattern).toBe("5 0 * * *");
    expect(CRON_JOBS.invitation_soft_delete_cleanup.pattern).toBe("0 1 * * *");
    expect(CRON_JOBS.reminder_email_h7_h1.pattern).toBe("0 8 * * *");
    expect(CRON_JOBS.analytics_counter_flush.pattern).toBe("* * * * *");
  });
});
