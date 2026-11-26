import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AdminDashboardService } from "../../src/modules/admin/admin-dashboard.service";
import type { CachePort } from "../../src/infra/cache/cache.port";
import {
  createTestInvitation,
  createTestOrder,
  createTestUser,
} from "../support/factories";
import { startHarness, type Harness } from "../support/harness";
import { resetTenantData } from "./helpers";

describe("admin dashboard seeded SQL (P5-11)", () => {
  let harness: Harness;
  let service: AdminDashboardService;
  beforeAll(async () => {
    harness = await startHarness();
    service = new AdminDashboardService(harness.db, {
      getJson: vi.fn().mockResolvedValue(undefined),
      setJson: vi.fn().mockResolvedValue(undefined),
    } as unknown as CachePort);
  }, 120_000);
  beforeEach(async () => {
    await resetTenantData(harness.pool);
  });
  afterAll(async () => {
    await harness?.stop();
  });
  it("matches direct SQL totals, excludes refunds, deduplicates renewals and zero-fills UTC periods", async () => {
    const user = await createTestUser(harness.pool);
    const second = await createTestUser(harness.pool);
    const published = await createTestInvitation(harness.pool, {
      owner: user,
      status: "published",
    });
    const trial = await createTestInvitation(harness.pool, {
      owner: second,
      status: "published",
    });
    const draft = await createTestInvitation(harness.pool, { owner: user });
    const refunded = await createTestInvitation(harness.pool, {
      owner: second,
    });
    const deleted = await createTestInvitation(harness.pool, { owner: second });
    await harness.pool.query(
      "UPDATE invitations SET published_at = now() WHERE id = ANY($1)",
      [[published.id, trial.id]],
    );
    await harness.pool.query(
      "UPDATE invitations SET deleted_at = now() WHERE id = $1",
      [deleted.id],
    );
    await createTestOrder(harness.pool, {
      invitation: published,
      user,
      status: "paid",
      amount: 139000n,
    });
    await createTestOrder(harness.pool, {
      invitation: published,
      user,
      status: "paid",
      amount: 139000n,
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    await createTestOrder(harness.pool, {
      invitation: refunded,
      user: second,
      status: "refunded",
      amount: 999999n,
    });
    await createTestOrder(harness.pool, {
      invitation: draft,
      user,
      status: "failed",
      amount: 333333n,
    });
    const result = await service.getDashboardMetrics({});
    const direct = await harness.pool.query(
      "SELECT count(*)::int AS count, coalesce(sum(amount_total),0)::text AS amount FROM orders WHERE status='paid'",
    );
    expect(result.total_users).toBe(2);
    expect(result.total_invitations).toBe(4);
    expect(result.paid_orders).toBe(direct.rows[0].count);
    expect(result.total_revenue).toBe(direct.rows[0].amount);
    expect(result.total_revenue).toBe("278000");
    expect(result.daily_revenue).toBe("139000");
    expect(result.monthly_revenue).toBe("139000");
    expect(result.invitations_by_status).toEqual([
      { status: "draft", count: 2 },
      { status: "published", count: 2 },
    ]);
    expect(result.funnel).toEqual({
      created: 4,
      ever_paid: 2,
      paid_and_published: 1,
    });
    expect(result.orders_by_day).toHaveLength(30);
    expect(result.orders_by_day.at(-1)).toMatchObject({
      count: 3,
      revenue: "139000",
    });
    expect(result.orders_by_day[0]!.count).toBe(0);
    expect(result.revenue_by_month).toHaveLength(6);
    expect(result.revenue_by_month.at(-1)!.revenue).toBe("139000");
    expect(JSON.stringify(result)).not.toContain(user.email);
  });
  it("keeps a 10,000-order operational dataset below a two-second warm query budget", async () => {
    const user = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, {
      owner: user,
    });
    await harness.pool.query(
      `INSERT INTO orders (invitation_id,user_id,package_id,amount_total,status,expired_at,created_at)
      SELECT $1,$2,'standard',139000,'paid',now()+interval '1 day',now()-(n % 180)*interval '1 day'
      FROM generate_series(1,10000) n`,
      [invitation.id, user.id],
    );
    await service.getDashboardMetrics({});
    const start = performance.now();
    const result = await service.getDashboardMetrics({});
    expect(performance.now() - start).toBeLessThan(2000);
    expect(result.paid_orders).toBe(10000);
    expect(result.total_revenue).toBe("1390000000");
  });
});
