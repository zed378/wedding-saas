import { describe, expect, it, vi } from "vitest";

import type { Database } from "../../infra/db/client";
import { NotFoundError, ValidationError } from "../../http/errors";
import type { CurrentUser } from "../../shared/auth-middleware/current-user";
import type { PublicInvitationCache } from "../publishing/public-invitation-cache";
import type { JobQueue } from "../../infra/queue/queue.module";
import { AdminModerationService } from "./admin-moderation.service";
import type {
  AdminDeleteActionDto,
  AdminModerateActionDto,
  AdminModerationQueryDto,
} from "./schemas/admin-moderation.schema";

const adminId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const invitationId = "11111111-1111-4111-8111-111111111111";
const entryId = "22222222-2222-4222-8222-222222222222";
const admin = { id: adminId } as CurrentUser;

type TerminalMethod = "where" | "orderBy" | "offset" | "limit" | "for";

function makeQuery(result: unknown, terminal: TerminalMethod) {
  const complete = () => Promise.resolve(result);
  const query = {
    from: vi.fn(() => query),
    leftJoin: vi.fn(() => query),
    where: vi.fn(() => (terminal === "where" ? complete() : query)),
    orderBy: vi.fn(() => (terminal === "orderBy" ? complete() : query)),
    limit: vi.fn(() => (terminal === "limit" ? complete() : query)),
    offset: vi.fn(() => (terminal === "offset" ? complete() : query)),
    for: vi.fn(() => (terminal === "for" ? complete() : query)),
  };
  return query;
}

function makeWriteQuery(
  result: unknown = undefined,
  terminal: "where" | "values" = "where",
  failure?: () => Promise<unknown>,
) {
  const complete = () => (failure ? failure() : Promise.resolve(result));
  const query = {
    set: vi.fn(() => query),
    values: vi.fn(() => (terminal === "values" ? complete() : query)),
    where: vi.fn(() => (terminal === "where" ? complete() : query)),
  };
  return query;
}

function makeListService(
  results: unknown[],
  terminals: TerminalMethod[] = ["where", "offset", "orderBy"],
) {
  const queries = results.map((result, index) =>
    makeQuery(result, terminals[index] ?? "where"),
  );
  let index = 0;
  const select = vi.fn(() => queries[index++]!);
  const db = { select } as unknown as Database;
  return { service: new AdminModerationService(db), select, queries };
}

function makeMutationService(
  selectResults: unknown[][],
  dependencies: { cache?: unknown; queue?: unknown } = {},
  auditResult?: () => Promise<unknown>,
) {
  const selectQueries = selectResults.map((result) => makeQuery(result, "for"));
  let selectIndex = 0;
  const updateQuery = makeWriteQuery(undefined, "where");
  const deleteQuery = makeWriteQuery(undefined, "where");
  const auditQuery = makeWriteQuery(undefined, "values", auditResult);
  const tx = {
    select: vi.fn(() => selectQueries[selectIndex++]!),
    update: vi.fn(() => updateQuery),
    delete: vi.fn(() => deleteQuery),
    insert: vi.fn(() => auditQuery),
  };
  const transaction = vi.fn(
    (callback: (transaction: unknown) => Promise<unknown>) => callback(tx),
  );
  const db = { transaction } as unknown as Database;
  const cache = dependencies.cache as PublicInvitationCache | undefined;
  const queue = dependencies.queue as JobQueue | undefined;
  return {
    service: new AdminModerationService(db, cache, queue),
    tx,
    transaction,
    updateQuery,
    deleteQuery,
    auditQuery,
  };
}

function existingEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: entryId,
    invitationId,
    guestName: "Guest",
    message: "A kind wedding wish",
    status: "pending",
    invitationSlug: "ada-and-rio",
    invitationStatus: "published",
    ...overrides,
  };
}

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: entryId,
    invitationId,
    guestName: "Guest",
    message: "A kind wedding wish",
    status: "pending",
    submittedIpHash: null,
    moderatedBy: null,
    moderatedAt: null,
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
    invitationSlug: "ada-and-rio",
    invitationInternalName: "Ada & Rio",
    invitationStatus: "published",
    invitationGuestbookModeration: false,
    ownerId: "33333333-3333-4333-8333-333333333333",
    ownerEmail: "owner@example.test",
    ownerFullName: "Wedding Owner",
    ...overrides,
  };
}

describe("AdminModerationService", () => {
  it("maps report sources and invitation/owner fallbacks while clamping pagination", async () => {
    const { service, select, queries } = makeListService([
      [{ total: "5" }],
      [
        listRow(),
        listRow({
          id: "33333333-3333-4333-8333-333333333333",
          invitationSlug: "auto-flag",
          invitationInternalName: null,
          invitationGuestbookModeration: false,
        }),
        listRow({
          id: "44444444-4444-4444-8444-444444444444",
          invitationSlug: "owner-held",
          invitationGuestbookModeration: true,
        }),
        listRow({
          id: "55555555-5555-4555-8555-555555555555",
          status: "approved",
        }),
        listRow({
          id: "66666666-6666-4666-8666-666666666666",
          invitationSlug: null,
          invitationInternalName: null,
          invitationStatus: null,
          ownerId: null,
          ownerEmail: null,
          ownerFullName: null,
          status: "rejected",
        }),
      ],
      [
        {
          id: "report-2",
          entryId,
          reason: "Second report",
          createdAt: new Date("2026-01-02T03:06:00.000Z"),
        },
        {
          id: "report-1",
          entryId,
          reason: null,
          createdAt: new Date("2026-01-02T03:05:00.000Z"),
        },
      ],
    ]);

    const result = await service.listGuestbook({
      status: "all",
      invitation_id: invitationId,
      flag_source: "all",
      search: " spam ",
      page: 0,
      limit: 200,
    } as AdminModerationQueryDto);

    expect(select).toHaveBeenCalledTimes(3);
    expect(queries[1]!.limit).toHaveBeenCalledWith(100);
    expect(queries[1]!.offset).toHaveBeenCalledWith(0);
    expect(result.meta).toEqual({ page: 1, per_page: 100, total: 5 });
    expect(result.data.map((item) => item.flagSource)).toEqual([
      "reported",
      "auto_flagged",
      "owner_moderation",
      "standard",
      "standard",
    ]);
    expect(result.data[0]).toMatchObject({
      invitationTitle: "Ada & Rio",
      flagLabel: "Dilaporkan Tamu (2x)",
      reportCount: 2,
      reports: [
        { id: "report-2", reason: "Second report" },
        { id: "report-1", reason: null },
      ],
    });
    expect(result.data[1]!.invitationTitle).toBe("Undangan /auto-flag");
    expect(result.data[2]!.flagLabel).toBe("Moderasi Pemilik");
    expect(result.data[4]).toMatchObject({
      invitationTitle: "Undangan",
      invitationStatus: "draft",
      owner: { id: "", email: "", fullName: "" },
    });
  });

  it("rejects a malformed invitation filter before issuing SQL", async () => {
    const { service, select } = makeListService([]);

    await expect(
      service.listGuestbook({
        status: "all",
        invitation_id: "not-a-uuid",
        flag_source: "all",
        page: 1,
        limit: 20,
      } as AdminModerationQueryDto),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(select).not.toHaveBeenCalled();
  });

  it("filters reported entries using actual linked reports and skips report SQL for empty pages", async () => {
    const reportedEntryId = "33333333-3333-4333-8333-333333333333";
    const { service, select } = makeListService(
      [
        [{ total: "2" }],
        [
          listRow({ id: reportedEntryId }),
          listRow({ id: "44444444-4444-4444-8444-444444444444" }),
        ],
        [
          {
            id: "report-1",
            entryId: reportedEntryId,
            reason: "Spam",
            createdAt: new Date("2026-01-02T03:05:00.000Z"),
          },
        ],
        [{ total: undefined }],
        [],
      ],
      ["where", "offset", "orderBy", "where", "offset"],
    );

    const reported = await service.listGuestbook({
      status: "pending",
      flag_source: "reported",
      search: "   ",
      page: 2,
      limit: 10,
    } as AdminModerationQueryDto);
    expect(reported.data.map((item) => item.id)).toEqual([reportedEntryId]);
    expect(reported.meta).toEqual({ page: 2, per_page: 10, total: 2 });

    const empty = await service.listGuestbook({
      status: "all",
      flag_source: "all",
      page: 1,
      limit: 20,
    } as AdminModerationQueryDto);
    expect(empty).toEqual({
      data: [],
      meta: { page: 1, per_page: 20, total: 0 },
    });
    expect(select).toHaveBeenCalledTimes(5);
  });

  it("selects both automatic flags and owner-moderated pending messages", async () => {
    const { service } = makeListService([
      [{ total: "3" }],
      [
        listRow({
          id: "33333333-3333-4333-8333-333333333333",
          invitationGuestbookModeration: false,
        }),
        listRow({
          id: "44444444-4444-4444-8444-444444444444",
          invitationGuestbookModeration: true,
        }),
        listRow({ id: "55555555-5555-4555-8555-555555555555" }),
      ],
      [
        {
          id: "report-1",
          entryId: "55555555-5555-4555-8555-555555555555",
          reason: "Reported",
          createdAt: new Date("2026-01-02T03:05:00.000Z"),
        },
      ],
    ]);

    const result = await service.listGuestbook({
      status: "pending",
      flag_source: "auto_flagged",
      page: 1,
      limit: 20,
    } as AdminModerationQueryDto);

    expect(result.data.map((item) => item.flagSource)).toEqual([
      "auto_flagged",
      "owner_moderation",
    ]);
  });

  it("rejects invalid moderation input and malformed IDs before a transaction", async () => {
    const { service, transaction } = makeMutationService([[]]);

    await expect(
      service.moderateGuestbook(admin, entryId, {
        status: "pending",
        reason: "short",
      } as unknown as AdminModerateActionDto),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.moderateGuestbook(admin, entryId, {
        status: "approved",
        reason: "no",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.moderateGuestbook(admin, entryId, {
        status: "approved",
        reason: "Manual review passed",
        owner_id: adminId,
      } as unknown as AdminModerateActionDto),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.moderateGuestbook(admin, "bad-id", {
        status: "approved",
        reason: "Manual review passed",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not update or audit a missing moderation target", async () => {
    const { service, tx, transaction } = makeMutationService([[]]);

    await expect(
      service.moderateGuestbook(admin, entryId, {
        status: "approved",
        reason: "Manual review passed",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["approved", "setujui"],
    ["rejected", "tolak"],
  ] as const)(
    "records the %s transition and invalidates published invitation caches",
    async (status, expectedVerb) => {
      const cache = { invalidate: vi.fn().mockResolvedValue(undefined) };
      const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
      const { service, tx, updateQuery, auditQuery } = makeMutationService(
        [[existingEntry()]],
        { cache, queue },
      );

      const result = await service.moderateGuestbook(admin, entryId, {
        status,
        reason: "Manual review completed",
      });

      expect(result).toMatchObject({
        id: entryId,
        status,
        message: `Pesan buku tamu berhasil di-${expectedVerb}.`,
      });
      expect(tx.update).toHaveBeenCalledOnce();
      expect(updateQuery.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status,
          moderatedBy: adminId,
          moderatedAt: expect.any(Date),
        }),
      );
      expect(tx.insert).toHaveBeenCalledOnce();
      expect(auditQuery.values).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId,
          action: "guestbook.moderate",
          resourceType: "guestbook_entry",
          resourceId: entryId,
          reason: "Manual review completed",
          beforeState: {
            status: "pending",
            guest_name: "Guest",
            invitation_id: invitationId,
          },
          afterState: expect.objectContaining({
            status,
            moderated_by: adminId,
          }),
        }),
      );
      expect(cache.invalidate).toHaveBeenCalledWith({
        slug: "ada-and-rio",
        invitationId,
      });
      expect(queue.enqueue).toHaveBeenCalledWith(
        "general",
        "cache.invalidate",
        expect.objectContaining({ slug: "ada-and-rio", invitationId }),
        { relatedId: invitationId },
      );
    },
  );

  it("does not invalidate public caches for an unpublished invitation", async () => {
    const cache = { invalidate: vi.fn() };
    const queue = { enqueue: vi.fn() };
    const { service } = makeMutationService(
      [[existingEntry({ invitationStatus: "draft" })]],
      { cache, queue },
    );

    await service.moderateGuestbook(admin, entryId, {
      status: "rejected",
      reason: "Manual review completed",
    });

    expect(cache.invalidate).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("rejects invalid deletion reasons and missing targets without deleting or auditing", async () => {
    const { service, tx, transaction } = makeMutationService([[]]);

    await expect(
      service.deleteGuestbook(admin, entryId, { reason: "no" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.deleteGuestbook(admin, "bad-id", {
        reason: "Verified policy violation",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.deleteGuestbook(admin, entryId, {
        reason: "Verified policy violation",
      } as AdminDeleteActionDto),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.delete).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("deletes once with a reasoned audit snapshot and purges the published cache", async () => {
    const cache = { invalidate: vi.fn().mockResolvedValue(undefined) };
    const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const { service, tx, deleteQuery, auditQuery } = makeMutationService(
      [[existingEntry()]],
      { cache, queue },
    );

    await expect(
      service.deleteGuestbook(admin, entryId, {
        reason: "Verified policy violation",
      }),
    ).resolves.toMatchObject({ id: entryId, deleted: true });

    expect(tx.delete).toHaveBeenCalledOnce();
    expect(deleteQuery.where).toHaveBeenCalledOnce();
    expect(auditQuery.values).toHaveBeenCalledWith({
      adminId,
      action: "guestbook.delete",
      resourceType: "guestbook_entry",
      resourceId: entryId,
      reason: "Verified policy violation",
      beforeState: {
        id: entryId,
        invitation_id: invitationId,
        guest_name: "Guest",
        message: "A kind wedding wish",
        status: "pending",
      },
      afterState: null,
    });
    expect(cache.invalidate).toHaveBeenCalledWith({
      slug: "ada-and-rio",
      invitationId,
    });
    expect(queue.enqueue).toHaveBeenCalledWith(
      "general",
      "cache.invalidate",
      expect.objectContaining({
        slug: "ada-and-rio",
        invitationId,
        reason: "admin guestbook deletion",
      }),
      { relatedId: invitationId },
    );
  });

  it("does not invalidate caches when the moderation audit insert fails", async () => {
    const cache = { invalidate: vi.fn() };
    const queue = { enqueue: vi.fn() };
    const { service } = makeMutationService(
      [[existingEntry()]],
      { cache, queue },
      () => Promise.reject(new Error("audit unavailable")),
    );

    await expect(
      service.moderateGuestbook(admin, entryId, {
        status: "rejected",
        reason: "Manual review completed",
      }),
    ).rejects.toThrow("audit unavailable");
    expect(cache.invalidate).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it.each(["moderate", "delete"] as const)(
    "completes %s on a published invitation without optional cache adapters",
    async (action) => {
      const { service, tx } = makeMutationService([[existingEntry()]]);
      const result =
        action === "moderate"
          ? await service.moderateGuestbook(admin, entryId, {
              status: "approved",
              reason: "Manual review completed",
            })
          : await service.deleteGuestbook(admin, entryId, {
              reason: "Verified policy violation",
            });

      expect(result).toMatchObject({ id: entryId });
      expect(tx.insert).toHaveBeenCalledOnce();
    },
  );

  it("does not purge caches or return success when deletion auditing fails", async () => {
    const cache = { invalidate: vi.fn() };
    const queue = { enqueue: vi.fn() };
    const { service, tx } = makeMutationService(
      [[existingEntry()]],
      { cache, queue },
      () => Promise.reject(new Error("audit unavailable")),
    );

    await expect(
      service.deleteGuestbook(admin, entryId, {
        reason: "Verified policy violation",
      }),
    ).rejects.toThrow("audit unavailable");
    expect(tx.delete).toHaveBeenCalledOnce();
    expect(cache.invalidate).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
