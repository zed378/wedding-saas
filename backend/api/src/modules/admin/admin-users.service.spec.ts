import { describe, expect, it, vi } from "vitest";

import type { Database } from "../../infra/db/client";
import { NotFoundError } from "../../http/errors";
import { AdminUsersService } from "./admin-users.service";
import type { AdminUserQueryDto } from "./schemas/admin-user.schema";

type TerminalMethod = "where" | "offset" | "groupBy" | "limit" | "orderBy";

function makeQuery(result: unknown, terminal: TerminalMethod) {
  const complete = () => Promise.resolve(result);
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => (terminal === "where" ? complete() : query)),
    orderBy: vi.fn(() => (terminal === "orderBy" ? complete() : query)),
    limit: vi.fn(() => (terminal === "limit" ? complete() : query)),
    offset: vi.fn(() => (terminal === "offset" ? complete() : query)),
    groupBy: vi.fn(() => (terminal === "groupBy" ? complete() : query)),
  };
  return query;
}

function createService(results: unknown[], terminals: TerminalMethod[]) {
  const select = vi.fn(() =>
    makeQuery(results.shift(), terminals.shift() ?? "where"),
  );
  const db = { select } as unknown as Database;
  return { service: new AdminUsersService(db, {} as never), select };
}

function makeWriteQuery(result: unknown, terminal: "where" | "returning") {
  const complete = () => Promise.resolve(result);
  const query = {
    set: vi.fn(() => query),
    where: vi.fn(() => (terminal === "where" ? complete() : query)),
    returning: vi.fn(() => (terminal === "returning" ? complete() : query)),
  };
  return query;
}

function createMutationService(
  existingRows: unknown[],
  returnedRows: unknown[],
) {
  let updateCount = 0;
  const tx = {
    select: vi.fn(() => makeQuery(existingRows.shift(), "limit")),
    update: vi.fn(() => {
      updateCount += 1;
      return makeWriteQuery(
        returnedRows.shift(),
        updateCount === 1 ? "returning" : "where",
      );
    }),
  };
  const transaction = vi.fn(
    (callback: (transaction: unknown) => Promise<unknown>) => callback(tx),
  );
  const db = { transaction } as unknown as Database;
  const auditLogs = { record: vi.fn() };
  return {
    service: new AdminUsersService(db, auditLogs as never),
    tx,
    transaction,
    auditLogs,
  };
}

describe("AdminUsersService", () => {
  it("filters and paginates users, enriching rows with invitation and order counts", async () => {
    const firstUser = "11111111-1111-4111-8111-111111111111";
    const secondUser = "22222222-2222-4222-8222-222222222222";
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const { service, select } = createService(
      [
        [{ count: "2" }],
        [
          {
            id: firstUser,
            email: "ada@example.com",
            fullName: "Ada Lovelace",
            phone: null,
            role: "user",
            status: "active",
            emailVerified: true,
            createdAt,
            updatedAt: createdAt,
          },
          {
            id: secondUser,
            email: "grace@example.com",
            fullName: "Grace Hopper",
            phone: null,
            role: "user",
            status: "active",
            emailVerified: false,
            createdAt,
            updatedAt: createdAt,
          },
        ],
        [
          { ownerId: firstUser, total: "3" },
          { ownerId: null, total: "8" },
        ],
        [
          { userId: secondUser, total: "1" },
          { userId: null, total: "8" },
        ],
      ],
      ["where", "offset", "groupBy", "groupBy"],
    );

    const result = await service.listUsers({
      page: 2,
      limit: 10,
      status: "active",
      search: "  ada  ",
    });

    expect(select).toHaveBeenCalledTimes(4);
    expect(result.meta).toEqual({ page: 2, per_page: 10, total: 2 });
    expect(
      result.data.map(({ id, invitationCount, orderCount }) => ({
        id,
        invitationCount,
        orderCount,
      })),
    ).toEqual([
      { id: firstUser, invitationCount: 3, orderCount: 0 },
      { id: secondUser, invitationCount: 0, orderCount: 1 },
    ]);
  });

  it("handles default pagination, an all-status whitespace search, and empty results", async () => {
    const { service, select } = createService(
      [[undefined], []],
      ["where", "offset"],
    );

    await expect(
      service.listUsers({ page: 1, limit: 20, status: "all", search: "   " }),
    ).resolves.toEqual({
      data: [],
      meta: { page: 1, per_page: 20, total: 0 },
    });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("uses default filters when status and search are omitted", async () => {
    const { service, select } = createService(
      [[{ count: "0" }], []],
      ["where", "offset"],
    );

    await expect(service.listUsers({} as AdminUserQueryDto)).resolves.toEqual({
      data: [],
      meta: { page: 1, per_page: 20, total: 0 },
    });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("returns a user with related invitation and normalized order amounts", async () => {
    const userId = "33333333-3333-4333-8333-333333333333";
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const user = {
      id: userId,
      email: "user@example.com",
      fullName: "Sample User",
      phone: null,
      role: "user",
      status: "active",
      emailVerified: true,
      createdAt,
      updatedAt: createdAt,
    };
    const { service } = createService(
      [
        [user],
        [{ id: "invitation-1", slug: "sample-wedding" }],
        [{ id: "order-1", amountTotal: { toString: () => "139000" } }],
      ],
      ["limit", "orderBy", "orderBy"],
    );

    await expect(service.getUser(userId)).resolves.toMatchObject({
      id: userId,
      invitations: [{ id: "invitation-1", slug: "sample-wedding" }],
      orders: [{ id: "order-1", amountTotal: "139000" }],
    });
  });

  it("hides missing or soft-deleted user details behind the same not-found error", async () => {
    const { service } = createService([[]], ["limit"]);

    await expect(service.getUser("missing-user")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("returns empty related collections for an existing user with no activity", async () => {
    const userId = "44444444-4444-4444-8444-444444444444";
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const { service, select } = createService(
      [
        [
          {
            id: userId,
            email: "new@example.com",
            fullName: "New User",
            phone: null,
            role: "user",
            status: "active",
            emailVerified: false,
            createdAt,
            updatedAt: createdAt,
          },
        ],
        [],
        [],
      ],
      ["limit", "orderBy", "orderBy"],
    );

    await expect(service.getUser(userId)).resolves.toMatchObject({
      id: userId,
      invitations: [],
      orders: [],
    });
    expect(select).toHaveBeenCalledTimes(3);
  });

  it("suspends an active user, revokes refresh sessions, and audits the change", async () => {
    const userId = "55555555-5555-4555-8555-555555555555";
    const updatedAt = new Date("2026-02-03T04:05:06.000Z");
    const existing = {
      id: userId,
      email: "user@example.com",
      fullName: "Sample User",
      status: "active",
      role: "user",
    };
    const updated = { ...existing, status: "suspended", updatedAt };
    const { service, tx, transaction, auditLogs } = createMutationService(
      [[existing]],
      [[updated], undefined],
    );

    await expect(
      service.suspendUser({ id: "admin-1" }, userId, "Repeated abuse reports"),
    ).resolves.toEqual(updated);

    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(auditLogs.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        adminId: "admin-1",
        action: "user.suspend",
        resourceType: "user",
        resourceId: userId,
        reason: "Repeated abuse reports",
        beforeState: existing,
        afterState: updated,
      }),
    );
  });

  it("unsuspends a user without revoking sessions and audits the change", async () => {
    const userId = "66666666-6666-4666-8666-666666666666";
    const updatedAt = new Date("2026-02-03T04:05:06.000Z");
    const existing = {
      id: userId,
      email: "user@example.com",
      fullName: "Sample User",
      status: "suspended",
      role: "user",
    };
    const updated = { ...existing, status: "active", updatedAt };
    const { service, tx, auditLogs } = createMutationService(
      [[existing]],
      [[updated]],
    );

    await expect(
      service.unsuspendUser({ id: "admin-1" }, userId, "Appeal reviewed"),
    ).resolves.toEqual(updated);

    expect(tx.update).toHaveBeenCalledOnce();
    expect(auditLogs.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        adminId: "admin-1",
        action: "user.unsuspend",
        resourceType: "user",
        resourceId: userId,
        reason: "Appeal reviewed",
        beforeState: existing,
        afterState: updated,
      }),
    );
  });

  it("does not mutate or audit when the target user is missing", async () => {
    const userId = "77777777-7777-4777-8777-777777777777";
    const suspend = createMutationService([[]], []);
    const unsuspend = createMutationService([[]], []);

    await expect(
      suspend.service.suspendUser(
        { id: "admin-1" },
        userId,
        "Verified incident",
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      unsuspend.service.unsuspendUser(
        { id: "admin-1" },
        userId,
        "Verified incident",
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(suspend.tx.update).not.toHaveBeenCalled();
    expect(suspend.auditLogs.record).not.toHaveBeenCalled();
    expect(unsuspend.tx.update).not.toHaveBeenCalled();
    expect(unsuspend.auditLogs.record).not.toHaveBeenCalled();
  });

  it.each(["suspendUser", "unsuspendUser"] as const)(
    "%s rejects instead of acknowledging a change whose audit failed",
    async (action) => {
      const userId = "88888888-8888-4888-8888-888888888888";
      const existing = {
        id: userId,
        email: "user@example.com",
        fullName: "Sample User",
        status: action === "suspendUser" ? "active" : "suspended",
        role: "user",
      };
      const updated = {
        ...existing,
        status: action === "suspendUser" ? "suspended" : "active",
      };
      const { service, tx, auditLogs } = createMutationService(
        [[existing]],
        [[updated]],
      );
      auditLogs.record.mockRejectedValueOnce(new Error("audit unavailable"));

      await expect(
        service[action]({ id: "admin-1" }, userId, "Verified incident"),
      ).rejects.toThrow("audit unavailable");
      expect(auditLogs.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ resourceId: userId, afterState: updated }),
      );
    },
  );
});
