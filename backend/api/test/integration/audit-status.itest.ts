import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import { connect, tag, resetTenantData } from "./helpers.ts";
import * as schema from "../../src/infra/db/schema/index";
import { AuditLogService } from "../../src/shared/audit/audit-log.service";
import {
  InvitationStatusService,
  type Actor,
  type InvitationStatus,
} from "../../src/shared/invitation-status/invitation-status.service";
import { BusinessRuleError, NotFoundError } from "../../src/http/errors";

/**
 * P0-14 — the two writers, against a real database.
 *
 * The rollback tests are why this is an integration suite rather than a unit one. "Both
 * rows commit together or neither does" is a claim about a transaction, and a mocked
 * database would confirm the calls happened in the right order while proving nothing
 * about what survives a failure.
 */

let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let audit: AuditLogService;
let status: InvitationStatusService;

const USER = (id: string): Actor => ({ kind: "USER", userId: id });
const ADMIN = (id: string): Actor => ({ kind: "ADMIN", userId: id });
const SYSTEM: Actor = { kind: "SYSTEM", userId: null };

async function seedInvitation(
  initial: InvitationStatus = "draft",
): Promise<{ invitationId: string; userId: string }> {
  const { rows: u } = await pool.query<{ id: string }>(
    "INSERT INTO users (email, full_name) VALUES ($1, 'Owner') RETURNING id",
    [`owner-${tag()}@example.test`],
  );
  const { rows: t } = await pool.query<{ id: string }>(
    "INSERT INTO templates (slug, name) VALUES ($1, 'T') RETURNING id",
    [`tpl-${tag()}`],
  );
  const { rows: v } = await pool.query<{ id: string }>(
    "INSERT INTO template_versions (template_id, version, sections, theme) VALUES ($1, '1.0.0', '[]'::jsonb, '{}'::jsonb) RETURNING id",
    [t[0]!.id],
  );
  const { rows: i } = await pool.query<{ id: string }>(
    "INSERT INTO invitations (owner_id, template_id, template_version_id, status) VALUES ($1, $2, $3, $4) RETURNING id",
    [u[0]!.id, t[0]!.id, v[0]!.id, initial],
  );
  return { invitationId: i[0]!.id, userId: u[0]!.id };
}

const historyOf = async (invitationId: string) => {
  const { rows } = await pool.query<{
    from_status: string | null;
    to_status: string;
    changed_by: string | null;
    reason: string | null;
  }>(
    "SELECT from_status, to_status, changed_by, reason FROM invitation_status_history WHERE invitation_id = $1 ORDER BY created_at",
    [invitationId],
  );
  return rows;
};

const statusOf = async (invitationId: string) => {
  const { rows } = await pool.query<{ status: string }>(
    "SELECT status FROM invitations WHERE id = $1",
    [invitationId],
  );
  return rows[0]?.status;
};

beforeAll(async () => {
  pool = await connect([
    "invitations",
    "invitation_status_history",
    "audit_logs",
  ]);
  db = drizzle(pool, { schema });
  audit = new AuditLogService();
  status = new InvitationStatusService(db);
});

afterAll(async () => {
  await pool?.end();
});

beforeEach(async () => {
  await resetTenantData(pool);
});

describe("status transitions — the state machine (docs/PLAN/06)", () => {
  it("writes exactly one history row per transition", async () => {
    const { invitationId, userId } = await seedInvitation("draft");

    await status.transition(invitationId, "pending_payment", USER(userId));

    expect(await statusOf(invitationId)).toBe("pending_payment");
    const history = await historyOf(invitationId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      from_status: "draft",
      to_status: "pending_payment",
      changed_by: userId,
    });
    // Never empty: a history row with no reason is one nobody can interpret later.
    expect(history[0]!.reason).toBeTruthy();
  });

  it("rejects a transition the state machine does not allow", async () => {
    // draft -> published skips checkout and payment entirely. An allowlist means a
    // transition nobody designed cannot happen by accident.
    const { invitationId, userId } = await seedInvitation("draft");

    await expect(
      status.transition(invitationId, "published", USER(userId)),
    ).rejects.toThrow(BusinessRuleError);
    expect(await statusOf(invitationId)).toBe("draft");
    expect(await historyOf(invitationId)).toHaveLength(0);
  });

  it("rejects a transition to the state it is already in", async () => {
    const { invitationId, userId } = await seedInvitation("draft");
    await expect(
      status.transition(invitationId, "draft", USER(userId)),
    ).rejects.toThrow(BusinessRuleError);
  });

  it("refuses pending_payment -> paid from a user", async () => {
    // The fraud path. docs/PLAN/06 allows this edge only through validated webhook
    // processing, and docs/SECURITY/07 makes payment status server-decided. A user who
    // could set `paid` has granted themselves a free product.
    const { invitationId, userId } = await seedInvitation("pending_payment");

    await expect(
      status.transition(invitationId, "paid", USER(userId)),
    ).rejects.toThrow(BusinessRuleError);
    expect(await statusOf(invitationId)).toBe("pending_payment");
  });

  it("refuses pending_payment -> paid from an ADMIN too", async () => {
    // Deliberately not a support tool. An admin who can mark an order paid by hand can
    // grant a free product, which is a fraud path wearing a helpful hat.
    const { invitationId, userId } = await seedInvitation("pending_payment");

    await expect(
      status.transition(
        invitationId,
        "paid",
        ADMIN(userId),
        "customer says they paid",
      ),
    ).rejects.toThrow(BusinessRuleError);
  });

  it("allows pending_payment -> paid from SYSTEM, with a null changed_by", async () => {
    const { invitationId } = await seedInvitation("pending_payment");

    await status.transition(invitationId, "paid", SYSTEM);

    expect(await statusOf(invitationId)).toBe("paid");
    const history = await historyOf(invitationId);
    // Null rather than a fake actor. docs/DATABASE/04 makes the column nullable for
    // exactly this; the reason carries who it was instead.
    expect(history[0]!.changed_by).toBeNull();
    expect(history[0]!.reason).toContain("system");
  });

  it("refuses published -> expired from a user, because a job owns it", async () => {
    const { invitationId, userId } = await seedInvitation("published");
    await expect(
      status.transition(invitationId, "expired", USER(userId)),
    ).rejects.toThrow(BusinessRuleError);
  });

  it("allows unpublish as published -> paid, not published -> draft", async () => {
    // docs/PLAN/06: it was already paid for, and republishing must not cost again.
    const { invitationId, userId } = await seedInvitation("published");

    await status.transition(invitationId, "paid", USER(userId));
    expect(await statusOf(invitationId)).toBe("paid");
  });
});

describe("backward transitions require a reason (docs/PLAN/06)", () => {
  it("allows an admin refund from published straight to draft (ADR-019)", async () => {
    // ADR-019: `paid` would return the money and leave the customer the product.
    const { invitationId, userId } = await seedInvitation("published");

    await status.transition(
      invitationId,
      "draft",
      ADMIN(userId),
      "refund: ticket #91",
    );

    expect(await statusOf(invitationId)).toBe("draft");
    expect((await historyOf(invitationId))[0]!.reason).toBe(
      "refund: ticket #91",
    );
  });

  it("refuses a backward transition without a reason", async () => {
    const { invitationId, userId } = await seedInvitation("published");

    await expect(
      status.transition(invitationId, "draft", ADMIN(userId)),
    ).rejects.toThrow(BusinessRuleError);
    await expect(
      status.transition(invitationId, "draft", ADMIN(userId), "   "),
    ).rejects.toThrow(BusinessRuleError);

    expect(await statusOf(invitationId)).toBe("published");
  });

  it("refuses a refund from a user", async () => {
    const { invitationId, userId } = await seedInvitation("published");
    await expect(
      status.transition(invitationId, "draft", USER(userId), "I want a refund"),
    ).rejects.toThrow(BusinessRuleError);
  });

  it("allows a user to soft-delete their own invitation from any state", async () => {
    // docs/API/04 offers DELETE /invitations/:id at any time. docs/PLAN/06's diagram
    // does not draw this edge because it draws the automatic lifecycle.
    for (const from of [
      "draft",
      "paid",
      "published",
      "expired",
    ] as InvitationStatus[]) {
      const { invitationId, userId } = await seedInvitation(from);
      await status.transition(invitationId, "soft_deleted", USER(userId));
      expect(await statusOf(invitationId)).toBe("soft_deleted");
    }
  });

  it("has no transition out of soft_deleted", async () => {
    // Terminal here. hard_deleted is an outcome, not a status -- the row is deleted.
    const { invitationId, userId } = await seedInvitation("soft_deleted");
    await expect(
      status.transition(invitationId, "draft", USER(userId)),
    ).rejects.toThrow(BusinessRuleError);
  });
});

describe("atomicity — the whole point of the writer", () => {
  it("writes no history row when the surrounding transaction rolls back", async () => {
    // The DoD item. A status change that commits without its history row leaves an
    // invitation in a state nobody can explain; a history row that commits without the
    // change is a record of something that did not happen.
    const { invitationId, userId } = await seedInvitation("draft");

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(schema.invitationStatusHistory).values({
          invitationId,
          fromStatus: "draft",
          toStatus: "pending_payment",
          changedBy: userId,
          reason: "about to fail",
        });
        throw new Error("something went wrong after the history row");
      }),
    ).rejects.toThrow();

    expect(await historyOf(invitationId)).toHaveLength(0);
    expect(await statusOf(invitationId)).toBe("draft");
  });

  it("leaves the status unchanged when the history insert fails", async () => {
    // Forced by a foreign key: a changed_by that references no user. The status update
    // happens first inside the service, so if the two were not in one transaction the
    // status would stick and the history would be missing.
    const { invitationId } = await seedInvitation("draft");
    const ghost: Actor = {
      kind: "USER",
      userId: "00000000-0000-4000-8000-0000000000ff",
    };

    await expect(
      status.transition(invitationId, "pending_payment", ghost),
    ).rejects.toThrow();

    expect(await statusOf(invitationId)).toBe("draft");
    expect(await historyOf(invitationId)).toHaveLength(0);
  });

  it("throws NotFound for an invitation that does not exist", async () => {
    await expect(
      status.transition("00000000-0000-4000-8000-000000000000", "paid", SYSTEM),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("audit log", () => {
  async function anAdmin(): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO users (email, full_name, role) VALUES ($1, 'Support', 'admin') RETURNING id",
      [`support-${tag()}@example.test`],
    );
    return rows[0]!.id;
  }

  it("writes a row inside the caller's transaction", async () => {
    const adminId = await anAdmin();

    await db.transaction(async (tx) => {
      await audit.record(tx, {
        adminId,
        action: "user.suspend",
        resourceType: "user",
        resourceId: adminId,
        reason: "abuse report #12",
        ipAddress: "203.0.113.7",
      });
    });

    const { rows } = await pool.query(
      "SELECT action, reason, ip_address FROM audit_logs",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "user.suspend",
      reason: "abuse report #12",
    });
  });

  it("writes nothing when the transaction rolls back", async () => {
    // An audit row that commits when its action failed is a false record -- and one
    // nobody notices, because it looks exactly like a true one.
    const adminId = await anAdmin();

    await expect(
      db.transaction(async (tx) => {
        await audit.record(tx, {
          adminId,
          action: "order.refund",
          resourceType: "order",
          resourceId: adminId,
        });
        throw new Error("the refund itself failed");
      }),
    ).rejects.toThrow();

    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_logs",
    );
    expect(rows[0]!.n).toBe("0");
  });

  it("redacts sensitive fields from before/after state", async () => {
    // docs/DATABASE/10 § Policy: do not duplicate bank account data into a table with
    // TWO-YEAR retention. Reuses P0-12's redactor rather than a second list -- two
    // lists would drift within a phase.
    const adminId = await anAdmin();

    await db.transaction(async (tx) => {
      await audit.record(tx, {
        adminId,
        action: "invitation.bank_account.update",
        resourceType: "invitation",
        resourceId: adminId,
        beforeState: {
          account_number: "1234567890",
          account_holder: "A B",
          password: "hunter2",
          nested: { token: "secret-token-value" },
        },
        afterState: { account_number: "9876543210", account_holder: "A B" },
      });
    });

    const { rows } = await pool.query<{
      before_state: Record<string, unknown>;
    }>("SELECT before_state FROM audit_logs");
    const before = rows[0]!.before_state;

    expect(before["account_number"]).toBe("******7890");
    expect(before["password"]).toBe("[REDACTED]");
    expect((before["nested"] as Record<string, unknown>)["token"]).toBe(
      "[REDACTED]",
    );
    // Non-sensitive context survives, or the snapshot would be useless.
    expect(before["account_holder"]).toBe("A B");

    const raw = JSON.stringify(rows[0]);
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("1234567890");
    expect(raw).not.toContain("secret-token-value");
  });
});
