import { describe, expect, it, vi } from "vitest";

import type { JobQueue } from "../src/infra/queue/queue.module";
import { InvitationRetentionService } from "../src/modules/invitation/invitation-retention.service";
import type { InvitationRepository } from "../src/shared/tenancy/invitation-repository";
import type { InvitationStatusService } from "../src/shared/invitation-status/invitation-status.service";
import type { StoragePort } from "@wi/storage";

describe("InvitationRetentionService - Retention Warnings (P4-07, BR-9.1)", () => {
  it("enqueues retention warnings at Day 30, Day 60, and Day 83 of expiry with correct deletion countdown", async () => {
    const enqueued: Array<{
      pool: string;
      name: string;
      data: Record<string, unknown>;
      options?: { idempotencyKey?: string; relatedId?: string };
    }> = [];

    const mockQueue: JobQueue = {
      enqueue: vi.fn().mockImplementation(async (pool, name, data, options) => {
        enqueued.push({ pool, name, data, options });
      }),
      close: vi.fn(),
    };

    const mockRepo = {
      expiredInvitationsForRetentionWarning: vi.fn().mockResolvedValue([
        {
          id: "inv-exp-30",
          slug: "agus-ratna",
          ownerId: "user-1",
          expiryDate: "2026-09-17",
          daysExpired: 30,
        },
        {
          id: "inv-exp-60",
          slug: "eko-dian",
          ownerId: "user-2",
          expiryDate: "2026-08-18",
          daysExpired: 60,
        },
        {
          id: "inv-exp-83",
          slug: "fajar-gita",
          ownerId: "user-3",
          expiryDate: "2026-07-26",
          daysExpired: 83,
        },
      ]),
      expiredInvitationsForSoftDelete: vi.fn().mockResolvedValue([]),
      softDeletedInvitationsForHardDelete: vi.fn().mockResolvedValue([]),
      orphanedSoftDeletedMedia: vi.fn().mockResolvedValue([]),
    } as unknown as InvitationRepository;

    const mockStatus = {} as unknown as InvitationStatusService;
    const mockStorage = {} as unknown as StoragePort;

    const service = new InvitationRetentionService(
      mockRepo,
      mockStatus,
      mockStorage,
      mockQueue,
    );

    const warningsCount = await service.sweepRetentionWarnings();

    expect(warningsCount).toBe(3);
    expect(enqueued).toHaveLength(3);

    // Warning 1: Day 30 expired -> 60 days remaining before permanent deletion
    expect(enqueued[0]!.data).toEqual({
      template: "invitation_retention_warning",
      invitationId: "inv-exp-30",
      warningNumber: 1,
      daysRemainingUntilDeletion: 60,
    });
    expect(enqueued[0]!.options?.idempotencyKey).toBe(
      "invitation.retention_warning:1:inv-exp-30",
    );

    // Warning 2: Day 60 expired -> 30 days remaining
    expect(enqueued[1]!.data).toEqual({
      template: "invitation_retention_warning",
      invitationId: "inv-exp-60",
      warningNumber: 2,
      daysRemainingUntilDeletion: 30,
    });
    expect(enqueued[1]!.options?.idempotencyKey).toBe(
      "invitation.retention_warning:2:inv-exp-60",
    );

    // Warning 3: Day 83 expired -> 7 days remaining
    expect(enqueued[2]!.data).toEqual({
      template: "invitation_retention_warning",
      invitationId: "inv-exp-83",
      warningNumber: 3,
      daysRemainingUntilDeletion: 7,
    });
    expect(enqueued[2]!.options?.idempotencyKey).toBe(
      "invitation.retention_warning:3:inv-exp-83",
    );
  });

  it("produces identical idempotency keys on re-run, guaranteeing no duplicate emails", async () => {
    const keys1: string[] = [];
    const keys2: string[] = [];

    const mockQueue1: JobQueue = {
      enqueue: vi
        .fn()
        .mockImplementation(async (_pool, _name, _data, options) => {
          if (options?.idempotencyKey) keys1.push(options.idempotencyKey);
        }),
      close: vi.fn(),
    };
    const mockQueue2: JobQueue = {
      enqueue: vi
        .fn()
        .mockImplementation(async (_pool, _name, _data, options) => {
          if (options?.idempotencyKey) keys2.push(options.idempotencyKey);
        }),
      close: vi.fn(),
    };

    const mockRepo = {
      expiredInvitationsForRetentionWarning: vi.fn().mockResolvedValue([
        {
          id: "inv-idemp-1",
          slug: "test-slug",
          ownerId: "user-1",
          expiryDate: "2026-09-17",
          daysExpired: 30,
        },
      ]),
    } as unknown as InvitationRepository;

    const service1 = new InvitationRetentionService(
      mockRepo,
      {} as InvitationStatusService,
      {} as StoragePort,
      mockQueue1,
    );
    await service1.sweepRetentionWarnings();

    const service2 = new InvitationRetentionService(
      mockRepo,
      {} as InvitationStatusService,
      {} as StoragePort,
      mockQueue2,
    );
    await service2.sweepRetentionWarnings();

    expect(keys1).toEqual(keys2);
    expect(keys1[0]).toBe("invitation.retention_warning:1:inv-idemp-1");
  });

  it("handles missing queue gracefully and returns 0", async () => {
    const service = new InvitationRetentionService(
      {} as InvitationRepository,
      {} as InvitationStatusService,
      {} as StoragePort,
      undefined,
    );
    const count = await service.sweepRetentionWarnings();
    expect(count).toBe(0);
  });
});
