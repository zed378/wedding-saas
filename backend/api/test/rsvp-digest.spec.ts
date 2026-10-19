import { describe, expect, it, vi } from "vitest";

import type { Database } from "../src/infra/db/client";
import type { JobQueue } from "../src/infra/queue/queue.module";
import { RsvpDigestService } from "../src/modules/rsvp/rsvp-digest.service";

describe("RsvpDigestService (P4-08)", () => {
  it("enqueues rsvp_daily_digest job with aggregated stats and recent guests", async () => {
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

    const mockDb = {
      execute: vi.fn().mockImplementation(async (query: any) => {
        const sqlText = query.queryChunks
          ? query.queryChunks.map((c: any) => (typeof c === "string" ? c : c?.value ?? "")).join(" ")
          : String(query);

        if (sqlText.includes("FROM invitations i") || sqlText.includes("COUNT(g.id)")) {
          return {
            rows: [
              {
                invitation_id: "inv-digest-1",
                internal_name: "Pernikahan Maya & Dimas",
                recipient_email: "dimas@example.com",
                recipient_name: "Dimas Anggara",
                total_responses: 5,
                attending_count: 4,
                not_attending_count: 1,
                maybe_count: 0,
              },
            ],
          };
        }

        if (sqlText.includes("FROM invitation_guests")) {
          return {
            rows: [
              {
                guest_name: "Ahmad Dahlan",
                attendance_status: "attending",
                guest_count: 2,
              },
              {
                guest_name: "Citra Dewi",
                attendance_status: "not_attending",
                guest_count: 1,
              },
            ],
          };
        }

        return { rows: [] };
      }),
    } as unknown as Database;

    const service = new RsvpDigestService(mockDb, mockQueue);
    const testDate = new Date("2026-10-17T09:00:00.000Z");

    const result = await service.sendDailyDigests(testDate);

    expect(result.digestsQueued).toBe(1);
    expect(enqueued).toHaveLength(1);

    const job = enqueued[0]!;
    expect(job.pool).toBe("general");
    expect(job.name).toBe("notification.send");
    expect(job.data).toMatchObject({
      template: "rsvp_daily_digest",
      invitationId: "inv-digest-1",
      recipientEmail: "dimas@example.com",
      recipientName: "Dimas Anggara",
      invitationTitle: "Pernikahan Maya & Dimas",
      totalResponsesToday: 5,
      attendingCount: 4,
      notAttendingCount: 1,
      maybeCount: 0,
      recentGuests: [
        {
          guestName: "Ahmad Dahlan",
          attendanceStatus: "attending",
          guestCount: 2,
        },
        {
          guestName: "Citra Dewi",
          attendanceStatus: "not_attending",
          guestCount: 1,
        },
      ],
    });
    expect(job.options?.idempotencyKey).toContain("rsvp.digest:inv-digest-1:");
    expect(job.options?.relatedId).toBe("inv-digest-1");
  });

  it("is idempotent: repeated execution on the same date produces the same idempotency key", async () => {
    const enqueuedKeys: string[] = [];

    const mockQueue: JobQueue = {
      enqueue: vi.fn().mockImplementation(async (_pool, _name, _data, options) => {
        enqueuedKeys.push(options?.idempotencyKey ?? "");
      }),
      close: vi.fn(),
    };

    const mockDb = {
      execute: vi.fn().mockImplementation(async (query: any) => {
        const sqlText = query.queryChunks
          ? query.queryChunks.map((c: any) => (typeof c === "string" ? c : c?.value ?? "")).join(" ")
          : String(query);

        if (sqlText.includes("COUNT(g.id)")) {
          return {
            rows: [
              {
                invitation_id: "inv-repeat-1",
                internal_name: "Ulang Undangan",
                recipient_email: "repeat@example.com",
                recipient_name: "Repeat User",
                total_responses: 1,
                attending_count: 1,
                not_attending_count: 0,
                maybe_count: 0,
              },
            ],
          };
        }
        return {
          rows: [
            {
              guest_name: "Tamu 1",
              attendance_status: "attending",
              guest_count: 1,
            },
          ],
        };
      }),
    } as unknown as Database;

    const service = new RsvpDigestService(mockDb, mockQueue);
    const date = new Date("2026-10-17T09:00:00.000Z");

    await service.sendDailyDigests(date);
    await service.sendDailyDigests(date);

    expect(enqueuedKeys).toHaveLength(2);
    expect(enqueuedKeys[0]).toBe(enqueuedKeys[1]);
  });
});
