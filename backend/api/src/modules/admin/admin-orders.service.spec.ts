import { describe, expect, it, vi } from "vitest";

import type { Database } from "../../infra/db/client";
import { NotFoundError, ValidationError } from "../../http/errors";
import { AdminOrdersService } from "./admin-orders.service";
import type { AdminOrderQueryDto } from "./schemas/admin-order.schema";

function makeQuery(result: unknown) {
  const query = {
    from: vi.fn(() => query),
    leftJoin: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => query),
    offset: vi.fn(() => query),
    groupBy: vi.fn(() => query),
    for: vi.fn(() => query),
    set: vi.fn(() => query),
    values: vi.fn(() => query),
    // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are thenable and service read tests await them.
    then: (
      resolve: (value: unknown) => unknown,
      reject: (error: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

function createService(results: unknown[]) {
  const select = vi.fn(() => makeQuery(results.shift()));
  const db = { select } as unknown as Database;
  return {
    service: new AdminOrdersService(db, {} as never),
    select,
  };
}

function createRefundService(
  results: unknown[],
  dependencies: { cache?: unknown; queue?: unknown } = {},
) {
  const tx = {
    select: vi.fn(() => makeQuery(results.shift())),
    update: vi.fn(() => makeQuery(undefined)),
    insert: vi.fn(() => makeQuery(undefined)),
  };
  const transaction = vi.fn(
    (callback: (transaction: unknown) => Promise<unknown>) => callback(tx),
  );
  const db = { transaction } as unknown as Database;
  const statusService = { transitionWithin: vi.fn() };

  return {
    service: new AdminOrdersService(
      db,
      statusService as never,
      dependencies.queue as never,
      dependencies.cache as never,
    ),
    tx,
    transaction,
    statusService,
  };
}

describe("AdminOrdersService read models", () => {
  it("maps paginated order rows and uses zero when no payment attempts exist", async () => {
    const paidId = "11111111-1111-4111-8111-111111111111";
    const pendingId = "22222222-2222-4222-8222-222222222222";
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const { service, select } = createService([
      [{ total: "2" }],
      [
        {
          id: paidId,
          invitationId: "invitation-1",
          userId: "user-1",
          packageId: "standard",
          addonIds: null,
          amountTotal: { toString: () => "139000" },
          status: "paid",
          orderType: "new_publish",
          expiredAt: createdAt,
          createdAt,
          userEmail: null,
          userFullName: null,
          invitationSlug: null,
        },
        {
          id: pendingId,
          invitationId: "invitation-2",
          userId: "user-2",
          packageId: "standard",
          addonIds: ["addon-1"],
          amountTotal: { toString: () => "139000" },
          status: "pending",
          orderType: "renewal",
          expiredAt: createdAt,
          createdAt,
          userEmail: "guest@example.com",
          userFullName: "Guest Name",
          invitationSlug: "guest-event",
        },
      ],
      [
        { orderId: paidId, total: "2" },
        { orderId: null, total: "1" },
      ],
    ]);

    const result = await service.listOrders({
      page: 2,
      limit: 10,
      status: "paid",
      search: paidId,
    });

    expect(select).toHaveBeenCalledTimes(3);
    expect(result.meta).toEqual({ page: 2, per_page: 10, total: 2 });
    expect(result.data).toEqual([
      {
        id: paidId,
        invitationId: "invitation-1",
        userId: "user-1",
        packageId: "standard",
        addonIds: [],
        amountTotal: "139000",
        status: "paid",
        orderType: "new_publish",
        userEmail: "",
        userFullName: "",
        invitationSlug: "",
        createdAt: createdAt.toISOString(),
        expiredAt: createdAt.toISOString(),
        paymentCount: 2,
      },
      {
        id: pendingId,
        invitationId: "invitation-2",
        userId: "user-2",
        packageId: "standard",
        addonIds: ["addon-1"],
        amountTotal: "139000",
        status: "pending",
        orderType: "renewal",
        userEmail: "guest@example.com",
        userFullName: "Guest Name",
        invitationSlug: "guest-event",
        createdAt: createdAt.toISOString(),
        expiredAt: createdAt.toISOString(),
        paymentCount: 0,
      },
    ]);
  });

  it("handles default pagination and an empty unfiltered result", async () => {
    const { service, select } = createService([[undefined], []]);

    await expect(service.listOrders({} as AdminOrderQueryDto)).resolves.toEqual(
      {
        data: [],
        meta: { page: 1, per_page: 20, total: 0 },
      },
    );
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("returns an empty detail for a valid order with no related rows", async () => {
    const orderId = "33333333-3333-4333-8333-333333333333";
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const { service, select } = createService([
      [
        {
          id: orderId,
          invitationId: "invitation-1",
          userId: "user-1",
          packageId: "standard",
          addonIds: null,
          amountTotal: { toString: () => "139000" },
          status: "pending",
          orderType: "new_publish",
          createdAt,
          updatedAt: createdAt,
          expiredAt: createdAt,
          userIdActual: null,
          userEmail: null,
          userFullName: null,
          userPhone: null,
          invitationIdActual: null,
          invitationSlug: null,
          invitationInternalName: null,
        },
      ],
      [],
      [],
    ]);

    await expect(service.getOrder(orderId)).resolves.toMatchObject({
      id: orderId,
      user: {
        id: "user-1",
        email: "",
        fullName: "",
        phone: null,
      },
      invitation: {
        id: "invitation-1",
        slug: "",
        internalName: null,
      },
      payments: [],
      notifications: [],
      hasFraudAlert: false,
      invoice: null,
    });
    expect(select).toHaveBeenCalledTimes(3);
  });

  it("rejects malformed and missing order IDs without exposing order data", async () => {
    const { service, select } = createService([[]]);

    await expect(service.getOrder("not-a-uuid")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      service.getOrder("44444444-4444-4444-8444-444444444444"),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(select).toHaveBeenCalledOnce();
  });

  it("maps payment timeline details, redacts callbacks, and flags signature failures", async () => {
    const orderId = "55555555-5555-4555-8555-555555555555";
    const createdAt = new Date("2026-03-04T05:06:07.000Z");
    const generatedAt = new Date("2026-03-04T05:10:07.000Z");
    const verifiedAt = new Date("2026-03-04T05:07:07.000Z");
    const receivedAt = new Date("2026-03-04T05:08:07.000Z");
    const processedAt = new Date("2026-03-04T05:09:07.000Z");
    const { service, select } = createService([
      [
        {
          id: orderId,
          invitationId: "invitation-1",
          userId: "user-1",
          packageId: "standard",
          addonIds: ["addon-1"],
          amountTotal: { toString: () => "139000" },
          status: "paid",
          orderType: "new_publish",
          createdAt,
          updatedAt: verifiedAt,
          expiredAt: processedAt,
          userIdActual: "user-1",
          userEmail: "couple@example.com",
          userFullName: "Couple",
          userPhone: "+628123456789",
          invitationIdActual: "invitation-1",
          invitationSlug: "couple-day",
          invitationInternalName: "Couple's wedding",
        },
      ],
      [
        {
          id: "payment-1",
          provider: "test-provider",
          providerReferenceId: null,
          method: "bank_transfer",
          amount: { toString: () => "139000" },
          status: "settlement",
          signatureValid: false,
          verifiedAt: null,
          createdAt,
          rawCallbackPayload: { card_number: "must-not-be-returned" },
        },
        {
          id: "payment-2",
          provider: "test-provider",
          providerReferenceId: "provider-ref-2",
          method: "qris",
          amount: { toString: () => "139000" },
          status: "settlement",
          signatureValid: true,
          verifiedAt,
          createdAt: verifiedAt,
        },
      ],
      [
        {
          id: "notification-1",
          source: "webhook",
          provider: "test-provider",
          claimedReference: "provider-ref-2",
          signatureValid: true,
          rejectionReason: null,
          outcome: "processed",
          providerStatus: "settlement",
          amount: { toString: () => "139000" },
          result: "accepted",
          needsReview: false,
          receivedAt,
          processedAt,
        },
        {
          id: "notification-2",
          source: "webhook",
          provider: "test-provider",
          claimedReference: null,
          signatureValid: true,
          rejectionReason: "signature_mismatch",
          outcome: "rejected",
          providerStatus: "settlement",
          amount: null,
          result: "refused",
          needsReview: true,
          receivedAt,
          processedAt: null,
        },
      ],
      [{ number: "INV-2026-0001", generatedAt }],
    ]);

    const result = await service.getOrder(orderId);

    expect(result.payments).toEqual([
      {
        id: "payment-1",
        provider: "test-provider",
        providerReferenceId: null,
        method: "bank_transfer",
        amount: "139000",
        status: "settlement",
        signatureValid: false,
        verifiedAt: null,
        createdAt: createdAt.toISOString(),
      },
      {
        id: "payment-2",
        provider: "test-provider",
        providerReferenceId: "provider-ref-2",
        method: "qris",
        amount: "139000",
        status: "settlement",
        signatureValid: true,
        verifiedAt: verifiedAt.toISOString(),
        createdAt: verifiedAt.toISOString(),
      },
    ]);
    expect(result.notifications).toEqual([
      expect.objectContaining({
        id: "notification-1",
        amount: "139000",
        processedAt: processedAt.toISOString(),
      }),
      expect.objectContaining({
        id: "notification-2",
        amount: null,
        processedAt: null,
      }),
    ]);
    expect(result.hasFraudAlert).toBe(true);
    expect(result.invoice).toEqual({
      number: "INV-2026-0001",
      generatedAt: generatedAt.toISOString(),
    });
    expect(result).not.toHaveProperty("payments.0.rawCallbackPayload");
    expect(select).toHaveBeenCalledTimes(4);
  });

  it("does not fetch notification rows when there are no payment references", async () => {
    const orderId = "66666666-6666-4666-8666-666666666666";
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const { service, select } = createService([
      [
        {
          id: orderId,
          invitationId: "invitation-1",
          userId: "user-1",
          packageId: "standard",
          addonIds: [],
          amountTotal: { toString: () => "139000" },
          status: "pending",
          orderType: "new_publish",
          createdAt,
          updatedAt: createdAt,
          expiredAt: createdAt,
          userIdActual: "user-1",
          userEmail: "guest@example.com",
          userFullName: "Guest",
          userPhone: null,
          invitationIdActual: "invitation-1",
          invitationSlug: "guest-day",
          invitationInternalName: null,
        },
      ],
      [],
      [],
    ]);

    const result = await service.getOrder(orderId);

    expect(result.notifications).toEqual([]);
    expect(result.hasFraudAlert).toBe(false);
    expect(result.invoice).toBeNull();
    expect(select).toHaveBeenCalledTimes(3);
  });

  it("uses an all-status search without adding the UUID shortcut", async () => {
    const { service, select } = createService([[{ total: "0" }], []]);

    await expect(
      service.listOrders({
        status: "all",
        search: "  couple  ",
      } as AdminOrderQueryDto),
    ).resolves.toMatchObject({ meta: { total: 0 }, data: [] });
    expect(select).toHaveBeenCalledTimes(2);
  });
});

describe("AdminOrdersService manual refund", () => {
  const orderId = "77777777-7777-4777-8777-777777777777";
  const admin = { id: "admin-1" } as never;
  const order = {
    id: orderId,
    invitationId: "invitation-1",
    amountTotal: { toString: () => "139000" },
    status: "paid",
  };

  it("rejects malformed IDs and short reasons before starting a transaction", async () => {
    const { service, transaction } = createRefundService([]);

    await expect(
      service.refundOrder(admin, "not-a-uuid", "valid reason"),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.refundOrder(admin, orderId, "  no  "),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects missing and unpaid orders, and a missing related invitation", async () => {
    const missingOrder = createRefundService([[]]);
    await expect(
      missingOrder.service.refundOrder(admin, orderId, "approved refund"),
    ).rejects.toBeInstanceOf(NotFoundError);

    const unpaidOrder = createRefundService([
      [{ ...order, status: "pending" }],
    ]);
    await expect(
      unpaidOrder.service.refundOrder(admin, orderId, "approved refund"),
    ).rejects.toThrow("Hanya pesanan berstatus 'paid'");

    const missingInvitation = createRefundService([[order], []]);
    await expect(
      missingInvitation.service.refundOrder(admin, orderId, "approved refund"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("records one transition and invalidates both caches after a published refund", async () => {
    const cache = { invalidate: vi.fn().mockResolvedValue(undefined) };
    const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const invitation = {
      id: "invitation-1",
      status: "published",
      slug: "couple-day",
    };
    const { service, tx, statusService, transaction } = createRefundService(
      [[order], [invitation]],
      { cache, queue },
    );

    await expect(
      service.refundOrder(admin, orderId, "  customer request  "),
    ).resolves.toMatchObject({
      orderId,
      status: "refunded",
      invitationId: "invitation-1",
      invitationSlug: "couple-day",
      invitationStatus: "draft",
      previousInvitationStatus: "published",
      moneyMovement: "manual",
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.update).toHaveBeenCalledOnce();
    expect(tx.insert).toHaveBeenCalledOnce();
    expect(statusService.transitionWithin).toHaveBeenCalledWith(
      expect.anything(),
      "invitation-1",
      "draft",
      { kind: "ADMIN", userId: "admin-1" },
      "admin refund: customer request",
    );
    expect(cache.invalidate).toHaveBeenCalledWith({
      slug: "couple-day",
      invitationId: "invitation-1",
    });
    expect(queue.enqueue).toHaveBeenCalledWith(
      "general",
      "cache.invalidate",
      {
        slug: "couple-day",
        invitationId: "invitation-1",
        reason: "admin refund",
      },
      { relatedId: "invitation-1" },
    );
  });

  it("does not invalidate public caches when the invitation was not published", async () => {
    const cache = { invalidate: vi.fn() };
    const queue = { enqueue: vi.fn() };
    const { service } = createRefundService(
      [[order], [{ id: "invitation-1", status: "draft", slug: "couple-day" }]],
      { cache, queue },
    );

    await service.refundOrder(admin, orderId, "approved refund");

    expect(cache.invalidate).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("completes a published refund when optional cache adapters are absent", async () => {
    const { service, statusService, tx } = createRefundService([
      [order],
      [{ id: "invitation-1", status: "published", slug: "couple-day" }],
    ]);

    await expect(
      service.refundOrder(admin, orderId, "approved refund"),
    ).resolves.toMatchObject({ status: "refunded", moneyMovement: "manual" });
    expect(statusService.transitionWithin).toHaveBeenCalledOnce();
    expect(tx.insert).toHaveBeenCalledOnce();
  });

  it("does not publish cache side effects when the refund audit fails", async () => {
    const cache = { invalidate: vi.fn() };
    const queue = { enqueue: vi.fn() };
    const { service, tx } = createRefundService(
      [
        [order],
        [{ id: "invitation-1", status: "published", slug: "couple-day" }],
      ],
      { cache, queue },
    );
    tx.insert.mockImplementationOnce(() =>
      makeQuery(Promise.reject(new Error("audit unavailable"))),
    );

    await expect(
      service.refundOrder(admin, orderId, "approved refund"),
    ).rejects.toThrow("audit unavailable");
    expect(cache.invalidate).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
