import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";

import { connect, applicationPool, tag, resetTenantData } from "./helpers.ts";

/**
 * P0-10 — the commercial constraints, proven by violating them.
 *
 * Two of these are the most load-bearing constraints in the whole schema:
 *
 *   UNIQUE (provider, provider_reference_id) is the entire idempotency story for
 *   payment webhooks. A provider retry is normal traffic, not an error.
 *
 *   REVOKE UPDATE, DELETE ON audit_logs is what makes the audit trail an audit trail.
 *   It is tested through a connection as the APPLICATION role, because the owner can
 *   always write and a test connected as the owner would pass either way.
 */

let pool: Pool;
let appPool: Pool;

async function scaffoldOrder(
  overrides: Record<string, unknown> = {},
): Promise<{ orderId: string; invitationId: string; userId: string }> {
  const { rows: u } = await pool.query<{ id: string }>(
    "INSERT INTO users (email, full_name) VALUES ($1, 'Buyer') RETURNING id",
    [`buyer-${tag()}@example.test`],
  );
  const userId = u[0]!.id;

  const { rows: t } = await pool.query<{ id: string }>(
    "INSERT INTO templates (slug, name) VALUES ($1, 'T') RETURNING id",
    [`tpl-${tag()}`],
  );
  const { rows: v } = await pool.query<{ id: string }>(
    "INSERT INTO template_versions (template_id, version, sections, theme) VALUES ($1, '1.0.0', '[]'::jsonb, '{}'::jsonb) RETURNING id",
    [t[0]!.id],
  );
  const { rows: i } = await pool.query<{ id: string }>(
    "INSERT INTO invitations (owner_id, template_id, template_version_id) VALUES ($1, $2, $3) RETURNING id",
    [userId, t[0]!.id, v[0]!.id],
  );
  const invitationId = i[0]!.id;

  const row = {
    invitation_id: invitationId,
    user_id: userId,
    package_id: "standard",
    amount_total: "139000",
    expired_at: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  };
  const cols = Object.keys(row);
  const { rows: o } = await pool.query<{ id: string }>(
    `INSERT INTO orders (${cols.join(", ")}) VALUES (${cols.map((_, n) => `$${n + 1}`).join(", ")}) RETURNING id`,
    Object.values(row),
  );

  return { orderId: o[0]!.id, invitationId, userId };
}

beforeAll(async () => {
  pool = await connect([
    "packages",
    "addons",
    "orders",
    "payments",
    "audit_logs",
  ]);
  appPool = applicationPool();

  // The seed must have run: every order references a package, and 'standard' is the
  // only active one (ADR-023).
  const { rows } = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM packages WHERE id = 'standard'",
  );
  if (rows[0]!.n === "0") {
    throw new Error("packages is empty. Run: pnpm --filter @wi/api db:seed");
  }
});

afterAll(async () => {
  await pool?.end();
  await appPool?.end();
});

beforeEach(async () => {
  await resetTenantData(pool);
});

describe("payments — webhook idempotency", () => {
  const insert =
    "INSERT INTO payments (order_id, provider, provider_reference_id, amount) VALUES ($1, $2, $3, 139000)";

  it("rejects a duplicate (provider, provider_reference_id)", async () => {
    // docs/DATABASE/08 § Critical Notes. A provider retrying a webhook is normal, so
    // this constraint is what stops a retry becoming a second payment. It lives in
    // the database because a guarantee depending on every future handler remembering
    // to check first is not a guarantee.
    const { orderId } = await scaffoldOrder();
    const ref = `ref-${tag()}`;

    await pool.query(insert, [orderId, "midtrans", ref]);
    await expect(
      pool.query(insert, [orderId, "midtrans", ref]),
    ).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("allows the same reference id under a different provider", async () => {
    // Guards the wrong fix: a unique index on provider_reference_id alone would pass
    // the test above and then collide the first time two providers issue the same
    // reference string.
    const { orderId } = await scaffoldOrder();
    const ref = `shared-${tag()}`;

    await pool.query(insert, [orderId, "midtrans", ref]);
    await expect(
      pool.query(insert, [orderId, "xendit", ref]),
    ).resolves.toBeTruthy();
  });

  it("supports the ON CONFLICT DO NOTHING upsert the service will use", async () => {
    // The documented handling: upsert, then read the existing status. Asserting the
    // shape works here means P3-05 is building on something verified.
    const { orderId } = await scaffoldOrder();
    const ref = `upsert-${tag()}`;
    const upsert = `${insert} ON CONFLICT (provider, provider_reference_id) DO NOTHING`;

    const first = await pool.query(upsert, [orderId, "midtrans", ref]);
    const second = await pool.query(upsert, [orderId, "midtrans", ref]);

    expect(first.rowCount).toBe(1);
    expect(second.rowCount).toBe(0); // silently ignored, not an error
  });

  it("records a callback with an invalid signature rather than discarding it", async () => {
    // A forged callback is evidence. A spike in signature_valid = false is an
    // alerting condition (docs/DEVOPS/07), and you cannot alert on rows you dropped.
    const { orderId } = await scaffoldOrder();
    const { rows } = await pool.query<{ signature_valid: boolean }>(
      `INSERT INTO payments (order_id, provider, provider_reference_id, amount, signature_valid, raw_callback_payload)
       VALUES ($1, 'midtrans', $2, 139000, false, '{"forged": true}'::jsonb)
       RETURNING signature_valid`,
      [orderId, `forged-${tag()}`],
    );
    expect(rows[0]!.signature_valid).toBe(false);
  });

  it("leaves signature_valid null before verification", async () => {
    const { orderId } = await scaffoldOrder();
    const { rows } = await pool.query<{ signature_valid: boolean | null }>(
      `${insert} RETURNING signature_valid`,
      [orderId, "midtrans", `new-${tag()}`],
    );
    expect(rows[0]!.signature_valid).toBeNull();
  });

  it("rejects a status outside the allowed set", async () => {
    const { orderId } = await scaffoldOrder();
    await expect(
      pool.query(
        "INSERT INTO payments (order_id, provider, provider_reference_id, amount, status) VALUES ($1, 'midtrans', $2, 1, 'refunded')",
        [orderId, `bad-${tag()}`],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("audit_logs — append-only by permission, not convention", () => {
  async function anAuditRow(): Promise<{ id: string; adminId: string }> {
    const { rows: u } = await pool.query<{ id: string }>(
      "INSERT INTO users (email, full_name, role) VALUES ($1, 'Admin', 'admin') RETURNING id",
      [`admin-${tag()}@example.test`],
    );
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO audit_logs (admin_id, action, resource_type, resource_id, reason, ip_address)
       VALUES ($1, 'user.suspend', 'user', gen_random_uuid(), 'abuse', '203.0.113.7') RETURNING id`,
      [u[0]!.id],
    );
    return { id: rows[0]!.id, adminId: u[0]!.id };
  }

  it("lets the application role INSERT", async () => {
    // The revoke must not be so broad that the application cannot write the trail at
    // all -- every admin action has to be able to record itself.
    const { rows: u } = await pool.query<{ id: string }>(
      "INSERT INTO users (email, full_name, role) VALUES ($1, 'Admin', 'admin') RETURNING id",
      [`admin-${tag()}@example.test`],
    );
    await expect(
      appPool.query(
        "INSERT INTO audit_logs (admin_id, action, resource_type, resource_id) VALUES ($1, 'order.refund', 'order', gen_random_uuid())",
        [u[0]!.id],
      ),
    ).resolves.toBeTruthy();
  });

  it("lets the application role SELECT", async () => {
    await anAuditRow();
    await expect(
      appPool.query("SELECT count(*) FROM audit_logs"),
    ).resolves.toBeTruthy();
  });

  it("refuses an UPDATE on audit_logs from the application role", async () => {
    // The whole point. An audit trail the application can rewrite is not an audit
    // trail -- the code an attacker would be running is exactly the actor it must
    // constrain.
    const { id } = await anAuditRow();
    await expect(
      appPool.query(
        "UPDATE audit_logs SET reason = 'nothing happened' WHERE id = $1",
        [id],
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("refuses a DELETE on audit_logs from the application role", async () => {
    const { id } = await anAuditRow();
    await expect(
      appPool.query("DELETE FROM audit_logs WHERE id = $1", [id]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("still allows UPDATE on a normal table, so the revoke is scoped", async () => {
    // Guards the wrong fix: revoking UPDATE globally would pass both tests above and
    // break every ordinary write in the application.
    const { orderId } = await scaffoldOrder();
    await expect(
      appPool.query("UPDATE orders SET status = 'paid' WHERE id = $1", [
        orderId,
      ]),
    ).resolves.toBeTruthy();
  });

  it("stores ip_address as inet, not text", async () => {
    const { rows } = await pool.query<{ t: string }>(
      "SELECT data_type AS t FROM information_schema.columns WHERE table_name='audit_logs' AND column_name='ip_address'",
    );
    expect(rows[0]!.t).toBe("inet");
  });
});

describe("orders", () => {
  it("refuses an order for a non-existent package", async () => {
    // docs/SECURITY/07: the packages table is the only source of an amount. An order
    // naming a package that does not exist has no price anyone can verify.
    await expect(
      scaffoldOrder({ package_id: "enterprise" }),
    ).rejects.toMatchObject({
      code: "23503",
    });
  });

  it("refuses to delete an invitation that has orders", async () => {
    const { invitationId } = await scaffoldOrder();
    await expect(
      pool.query("DELETE FROM invitations WHERE id = $1", [invitationId]),
    ).rejects.toMatchObject({ code: "23001" });
  });

  it("refuses to delete a user who has orders", async () => {
    const { userId } = await scaffoldOrder();
    await expect(
      pool.query("DELETE FROM users WHERE id = $1", [userId]),
    ).rejects.toMatchObject({
      code: "23001",
    });
  });

  it("refuses to delete an order that has payments", async () => {
    // Payment history must never be lost (docs/DATABASE/01).
    const { orderId } = await scaffoldOrder();
    await pool.query(
      "INSERT INTO payments (order_id, provider, provider_reference_id, amount) VALUES ($1, 'midtrans', $2, 1)",
      [orderId, `ref-${tag()}`],
    );
    await expect(
      pool.query("DELETE FROM orders WHERE id = $1", [orderId]),
    ).rejects.toMatchObject({
      code: "23001",
    });
  });

  it("leaves amount_total untouched when the package price changes", async () => {
    // docs/DATABASE/07 § Notes. amount_total is a snapshot, not a lookup: an order
    // history that moves with the price list is not a history.
    const { orderId } = await scaffoldOrder({ amount_total: "139000" });

    await pool.query(
      "UPDATE packages SET price = 199000 WHERE id = 'standard'",
    );
    const { rows } = await pool.query<{ amount_total: string }>(
      "SELECT amount_total::text AS amount_total FROM orders WHERE id = $1",
      [orderId],
    );
    await pool.query(
      "UPDATE packages SET price = 139000 WHERE id = 'standard'",
    );

    expect(rows[0]!.amount_total).toBe("139000");
  });

  it("stores money as bigint, never a float", async () => {
    const { rows } = await pool.query<{
      column_name: string;
      data_type: string;
    }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE (table_name, column_name) IN
              (('orders','amount_total'), ('payments','amount'), ('packages','price'), ('addons','price'))
        ORDER BY table_name, column_name`,
    );
    expect(rows.every((r) => r.data_type === "bigint")).toBe(true);
    expect(rows).toHaveLength(4);
  });

  it.each(["pending", "paid", "failed", "expired", "refunded"])(
    "accepts the documented order status %s",
    async (status) => {
      await expect(scaffoldOrder({ status })).resolves.toBeTruthy();
    },
  );

  it("rejects an order status outside the allowed set", async () => {
    await expect(scaffoldOrder({ status: "chargeback" })).rejects.toMatchObject(
      {
        code: "23514",
      },
    );
  });

  it("rejects an order_type outside the allowed set", async () => {
    await expect(
      scaffoldOrder({ order_type: "upgrade" }),
    ).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("defaults addon_ids to an empty array", async () => {
    const { orderId } = await scaffoldOrder();
    const { rows } = await pool.query<{ addon_ids: string[] }>(
      "SELECT addon_ids FROM orders WHERE id = $1",
      [orderId],
    );
    expect(rows[0]!.addon_ids).toEqual([]);
  });

  it("accepts an addon id that does not exist — there is no FK on the array", async () => {
    // Documents a real gap rather than approving of it. docs/DATABASE/07 makes
    // addon_ids a VARCHAR(30)[], which cannot carry referential integrity, so the
    // service must validate against `addons` before insert.
    await expect(
      scaffoldOrder({ addon_ids: ["nonexistent_addon"] }),
    ).resolves.toBeTruthy();
  });
});

describe("packages and addons seed (ADR-022, ADR-023)", () => {
  it("has exactly one active package, priced at 139000 for 12 months", async () => {
    const { rows } = await pool.query<{
      id: string;
      price: string;
      duration_months: number;
      max_photos: number;
      has_watermark: boolean;
    }>(
      "SELECT id, price::text AS price, duration_months, max_photos, has_watermark FROM packages WHERE is_active",
    );
    expect(rows).toEqual([
      {
        id: "standard",
        price: "139000",
        duration_months: 12,
        max_photos: 200,
        // ADR-023: the paid package carries no watermark.
        has_watermark: false,
      },
    ]);
  });

  it("seeds custom_domain as inactive", async () => {
    // ADR-022: not sellable until P7-01 ships the feature. Selling it first would be
    // taking money for something that does not exist.
    const { rows } = await pool.query<{ is_active: boolean }>(
      "SELECT is_active FROM addons WHERE id = 'custom_domain'",
    );
    expect(rows[0]!.is_active).toBe(false);
  });

  it("has no active addon at all", async () => {
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM addons WHERE is_active",
    );
    expect(rows[0]!.n).toBe("0");
  });
});
