import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminModerationService } from "../../src/modules/admin/admin-moderation.service";
import type { CurrentUser } from "../../src/shared/auth-middleware/current-user";
import { createTestInvitation, createTestUser } from "../support/factories";
import { startHarness, type Harness } from "../support/harness";
import { resetTenantData } from "./helpers";

describe("P5-09 concurrent moderation audit consistency", () => {
  let harness: Harness;
  let service: AdminModerationService;
  beforeAll(async () => {
    harness = await startHarness();
    service = new AdminModerationService(harness.db);
  }, 120000);
  beforeEach(async () => resetTenantData(harness.pool));
  afterAll(async () => harness?.stop());

  async function fixture() {
    const admin = await createTestUser(harness.pool, { role: "admin" });
    const owner = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, { owner });
    const entry = await harness.pool.query(
      "INSERT INTO invitation_guestbook (invitation_id,guest_name,message,status) VALUES ($1,'Guest','Message','pending') RETURNING id",
      [invitation.id],
    );
    return {
      admin: { ...admin, role: "admin" } as unknown as CurrentUser,
      id: entry.rows[0].id as string,
    };
  }

  // Hold the row until both operations have reached their competing database
  // statements. This catches stale pre-transaction reads without timing races.
  async function contend(
    id: string,
    operations: Array<() => Promise<unknown>>,
  ) {
    const blocker = await harness.pool.connect();
    let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await blocker.query("BEGIN");
      const { rows } = await blocker.query("SELECT pg_backend_pid() AS pid");
      await blocker.query(
        "SELECT id FROM invitation_guestbook WHERE id=$1 FOR UPDATE",
        [id],
      );
      pending = Promise.allSettled(operations.map((operation) => operation()));
      const deadline = Date.now() + 5000;
      let waiting = 0;
      while (waiting < operations.length && Date.now() < deadline) {
        const result = await harness.pool.query(
          `SELECT count(*)::int AS count FROM pg_stat_activity
           WHERE datname=current_database() AND wait_event_type='Lock'
             AND query ILIKE '%invitation_guestbook%' AND pid<>$1`,
          [rows[0].pid],
        );
        waiting = result.rows[0].count;
        if (waiting < operations.length) await delay(10);
      }
      expect(waiting).toBe(operations.length);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      // Drain callers even if synchronization fails, before the next truncate.
      if (pending) await pending;
    }
    return pending!;
  }

  it("records the actual preceding status for two concurrent moderation decisions", async () => {
    const { admin, id } = await fixture();
    const results = await contend(id, [
      () =>
        service.moderateGuestbook(admin, id, {
          status: "approved",
          reason: "Approve after review",
        }),
      () =>
        service.moderateGuestbook(admin, id, {
          status: "rejected",
          reason: "Reject after review",
        }),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const { rows } = await harness.pool.query(
      "SELECT before_state,after_state FROM audit_logs WHERE resource_id=$1 AND action='guestbook.moderate'",
      [id],
    );
    expect(rows).toHaveLength(2);
    const initial = rows.filter((row) => row.before_state.status === "pending");
    expect(initial).toHaveLength(1);
    const next = rows.find((row) => row.before_state.status !== "pending")!;
    expect(next.before_state.status).toBe(initial[0].after_state.status);
    const current = await harness.pool.query(
      "SELECT status FROM invitation_guestbook WHERE id=$1",
      [id],
    );
    expect(next.after_state.status).toBe(current.rows[0].status);
  });

  it("records only one successful deletion when two admins delete the same entry concurrently", async () => {
    const { admin, id } = await fixture();
    const results = await contend(id, [
      () =>
        service.deleteGuestbook(admin, id, {
          reason: "Delete abusive message",
        }),
      () =>
        service.deleteGuestbook(admin, id, {
          reason: "Delete duplicate review",
        }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const denied = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(denied.reason).toMatchObject({ status: 404 });
    const { rows } = await harness.pool.query(
      "SELECT before_state,after_state FROM audit_logs WHERE resource_id=$1 AND action='guestbook.delete'",
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].before_state).toMatchObject({ id, status: "pending" });
    expect(rows[0].after_state).toBeNull();
  });
});
