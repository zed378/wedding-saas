import { describe, expect, it, vi } from "vitest";

import type { JobQueue } from "../src/infra/queue/queue.module";
import { InvitationReminderService } from "../src/modules/publishing/invitation-reminder.service";
import type { InvitationRepository } from "../src/shared/tenancy/invitation-repository";

describe("InvitationReminderService (P4-07)", () => {
  it("queries expiring invitations and enqueues H-7 and H-1 reminders with idempotent keys", async () => {
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
      invitationsExpiringInDays: vi.fn().mockResolvedValue([
        {
          id: "inv-h7-001",
          slug: "andi-citra",
          ownerId: "user-101",
          expiryDate: "2026-10-24",
          daysRemaining: 7,
        },
        {
          id: "inv-h1-002",
          slug: "budi-dewi",
          ownerId: "user-102",
          expiryDate: "2026-10-18",
          daysRemaining: 1,
        },
      ]),
    } as unknown as InvitationRepository;

    const service = new InvitationReminderService(mockRepo, mockQueue);

    const result = await service.sendExpiryReminders([7, 1]);

    expect(result.remindersSent).toBe(2);
    expect(result.h7Count).toBe(1);
    expect(result.h1Count).toBe(1);

    expect(enqueued).toHaveLength(2);

    const first = enqueued[0]!;
    expect(first.pool).toBe("general");
    expect(first.name).toBe("notification.send");
    expect(first.data).toEqual({
      template: "invitation_expiry_reminder",
      invitationId: "inv-h7-001",
      daysRemaining: 7,
    });
    expect(first.options?.idempotencyKey).toBe(
      "invitation.reminder:7:inv-h7-001:2026-10-24",
    );
    expect(first.options?.relatedId).toBe("inv-h7-001");

    const second = enqueued[1]!;
    expect(second.data).toEqual({
      template: "invitation_expiry_reminder",
      invitationId: "inv-h1-002",
      daysRemaining: 1,
    });
    expect(second.options?.idempotencyKey).toBe(
      "invitation.reminder:1:inv-h1-002:2026-10-18",
    );
  });

  it("is idempotent: a double run generates identical idempotency keys", async () => {
    const keysRun1: string[] = [];
    const keysRun2: string[] = [];

    const mockQueue1: JobQueue = {
      enqueue: vi
        .fn()
        .mockImplementation(async (_pool, _name, _data, options) => {
          if (options?.idempotencyKey) keysRun1.push(options.idempotencyKey);
        }),
      close: vi.fn(),
    };

    const mockQueue2: JobQueue = {
      enqueue: vi
        .fn()
        .mockImplementation(async (_pool, _name, _data, options) => {
          if (options?.idempotencyKey) keysRun2.push(options.idempotencyKey);
        }),
      close: vi.fn(),
    };

    const mockItems = [
      {
        id: "inv-repeat-01",
        slug: "dimas-putri",
        ownerId: "user-201",
        expiryDate: "2026-10-24",
        daysRemaining: 7,
      },
    ];

    const mockRepo = {
      invitationsExpiringInDays: vi.fn().mockResolvedValue(mockItems),
    } as unknown as InvitationRepository;

    const service1 = new InvitationReminderService(mockRepo, mockQueue1);
    await service1.sendExpiryReminders([7, 1]);

    const service2 = new InvitationReminderService(mockRepo, mockQueue2);
    await service2.sendExpiryReminders([7, 1]);

    expect(keysRun1).toEqual(keysRun2);
    expect(keysRun1[0]).toBe("invitation.reminder:7:inv-repeat-01:2026-10-24");
  });

  it("handles empty sweep without errors", async () => {
    const mockQueue: JobQueue = {
      enqueue: vi.fn(),
      close: vi.fn(),
    };

    const mockRepo = {
      invitationsExpiringInDays: vi.fn().mockResolvedValue([]),
    } as unknown as InvitationRepository;

    const service = new InvitationReminderService(mockRepo, mockQueue);
    const result = await service.sendExpiryReminders([7, 1]);

    expect(result.remindersSent).toBe(0);
    expect(result.h7Count).toBe(0);
    expect(result.h1Count).toBe(0);
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });
});
