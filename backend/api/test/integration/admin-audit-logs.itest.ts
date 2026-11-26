import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AdminAuditLogService } from "../../src/modules/admin/audit-logs.service";
import { AuditLogService } from "../../src/shared/audit/audit-log.service";
import { auditLogQuerySchema } from "../../src/modules/admin/schemas/admin-action.schema";
import { createTestUser } from "../support/factories";
import { startHarness, type Harness } from "../support/harness";
import { resetTenantData } from "./helpers";

describe("P5-12 seeded audit trail SQL", () => {
  let harness: Harness;
  let service: AdminAuditLogService;
  beforeAll(async () => {
    harness = await startHarness();
    service = new AdminAuditLogService(harness.db, new AuditLogService());
  }, 120_000);
  beforeEach(async () => {
    await resetTenantData(harness.pool);
  });
  afterAll(async () => {
    await harness?.stop();
  });

  it("filters each documented dimension and preserves totals across pages", async () => {
    const first = await createTestUser(harness.pool, { role: "admin" });
    const second = await createTestUser(harness.pool, { role: "admin" });
    const resourceA = randomUUID();
    const resourceB = randomUUID();
    const seed = [
      [first.id, "user", resourceA, "2026-01-01T00:00:00Z"],
      [first.id, "user", resourceA, "2026-01-02T00:00:00Z"],
      [second.id, "order", resourceB, "2026-01-03T00:00:00Z"],
    ];
    for (const values of seed)
      await harness.pool.query(
        "INSERT INTO audit_logs (admin_id, action, resource_type, resource_id, created_at) VALUES ($1, 'test.read', $2, $3, $4)",
        values,
      );
    for (const [filters, expected] of [
      [{ admin_id: first.id }, 2],
      [{ resource_type: "order" }, 1],
      [{ resource_id: resourceA }, 2],
      [{ date_from: "2026-01-02T00:00:00Z" }, 2],
      [{ date_to: "2026-01-01T00:00:00Z" }, 1],
      [
        {
          admin_id: first.id,
          resource_type: "user",
          resource_id: resourceA,
          date_from: "2026-01-01T00:00:00Z",
          date_to: "2026-01-02T00:00:00Z",
        },
        2,
      ],
    ] as const) {
      const result = await service.list(auditLogQuerySchema.parse(filters));
      expect(result.total).toBe(expected);
      expect(result.items).toHaveLength(expected);
    }
    const query = { admin_id: first.id, limit: 1 };
    const page1 = await service.list(
      auditLogQuerySchema.parse({ ...query, page: 1 }),
    );
    const page2 = await service.list(
      auditLogQuerySchema.parse({ ...query, page: 2 }),
    );
    expect(page1.total).toBe(2);
    expect(page1.total_pages).toBe(2);
    expect(page1.items[0]!.created_at).toBe("2026-01-02T00:00:00.000Z");
    expect(page2.items[0]!.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(page1.items[0]!.id).not.toBe(page2.items[0]!.id);
  });

  it("commits export evidence before returning and never changes source audit rows", async () => {
    const actor = await createTestUser(harness.pool, { role: "admin" });
    const resource = randomUUID();
    const source = await harness.pool.query(
      "INSERT INTO audit_logs (admin_id, action, resource_type, resource_id, before_state, after_state) VALUES ($1, 'user.suspend', 'user', $2, $3::jsonb, $4::jsonb) RETURNING id",
      [
        actor.id,
        resource,
        JSON.stringify({
          password_hash: "historical-secret",
          status: "active",
        }),
        JSON.stringify({ status: "suspended" }),
      ],
    );
    const result = await service.export(
      actor.id,
      auditLogQuerySchema.parse({ resource_id: resource, page: 9, limit: 1 }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.before_state?.["password_hash"]).toBe("[REDACTED]");
    expect(JSON.stringify(result)).not.toContain("historical-secret");
    const exported = await harness.pool.query(
      "SELECT admin_id, action, resource_type, resource_id, after_state FROM audit_logs WHERE resource_id = $1",
      [result.export_id],
    );
    expect(exported.rows).toEqual([
      {
        admin_id: actor.id,
        action: "audit_log.export",
        resource_type: "audit_log_export",
        resource_id: result.export_id,
        after_state: { filters: { resource_id: resource }, row_count: 1 },
      },
    ]);
    const unchanged = await harness.pool.query(
      "SELECT before_state FROM audit_logs WHERE id = $1",
      [source.rows[0].id],
    );
    expect(unchanged.rows[0].before_state).toEqual({
      password_hash: "historical-secret",
      status: "active",
    });
  });
});
