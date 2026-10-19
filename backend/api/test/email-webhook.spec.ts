import { describe, expect, it, vi, beforeEach } from "vitest";

import type { Database } from "../src/infra/db/client";
import { EmailBounceService } from "../src/modules/notification/email-bounce.service";
import { EmailWebhookController } from "../src/modules/notification/email-webhook.controller";
import { metrics } from "../src/shared/metrics/metrics";

describe("Email delivery monitoring & bounce handling (P4-08)", () => {
  let insertedBounces: Array<Record<string, unknown>> = [];

  const mockDb = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((val) => {
        insertedBounces.push(val);
        return {
          returning: vi.fn().mockResolvedValue([val]),
        };
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((cond: any) => ({
          limit: vi.fn().mockImplementation(async () => {
            function findEmail(obj: any, depth = 0): string | undefined {
              if (!obj || depth > 5) return undefined;
              if (typeof obj.value === "string" && obj.value.includes("@")) return obj.value;
              if (Array.isArray(obj.queryChunks)) {
                for (const chunk of obj.queryChunks) {
                  const found = findEmail(chunk, depth + 1);
                  if (found) return found;
                }
              }
              return undefined;
            }
            const queriedEmail = findEmail(cond);
            const hasSuppressed = insertedBounces.some(
              (b) =>
                b["email"] === queriedEmail &&
                (b["bounceType"] === "hard_bounce" || b["bounceType"] === "complaint"),
            );
            return hasSuppressed ? [{ id: "mock-id" }] : [];
          }),
        })),
      }),
    }),
  } as unknown as Database;

  let service: EmailBounceService;
  let controller: EmailWebhookController;

  beforeEach(() => {
    insertedBounces = [];
    service = new EmailBounceService(mockDb);
    controller = new EmailWebhookController(service);
  });

  it("handles Resend email.bounced hard bounce, stores record and suppresses future sends", async () => {
    const beforeMetric = metrics.emailBounces.get({
      provider: "resend",
      type: "hard_bounce",
    });

    const payload = {
      type: "email.bounced",
      data: {
        email_id: "resend-msg-123",
        to: ["dead@example.com"],
        bounce: {
          type: "hard_bounce",
          message: "550 5.1.1 User unknown",
        },
      },
    };

    const res = await controller.receive("resend", payload);
    expect(res).toEqual({ success: true, data: { received: true } });

    expect(insertedBounces).toHaveLength(1);
    expect(insertedBounces[0]).toMatchObject({
      email: "dead@example.com",
      bounceType: "hard_bounce",
      message: "550 5.1.1 User unknown",
      provider: "resend",
      providerEmailId: "resend-msg-123",
    });

    // Verify suppression
    const isSuppressed = await service.isSuppressed("dead@example.com");
    expect(isSuppressed).toBe(true);

    const isOtherSuppressed = await service.isSuppressed("live@example.com");
    expect(isOtherSuppressed).toBe(false);

    // Verify Prometheus metric incremented
    const afterMetric = metrics.emailBounces.get({
      provider: "resend",
      type: "hard_bounce",
    });
    expect(afterMetric).toBe(beforeMetric + 1);
  });

  it("handles Resend email.complained spam complaint, stores suppression record", async () => {
    const beforeMetric = metrics.emailBounces.get({
      provider: "resend",
      type: "complaint",
    });

    const payload = {
      type: "email.complained",
      data: {
        email_id: "resend-complaint-456",
        to: ["complainer@example.com"],
        complaint: {
          message: "Spam feedback loop complaint",
        },
      },
    };

    const res = await controller.receive("resend", payload);
    expect(res).toEqual({ success: true, data: { received: true } });

    expect(insertedBounces).toHaveLength(1);
    expect(insertedBounces[0]).toMatchObject({
      email: "complainer@example.com",
      bounceType: "complaint",
      provider: "resend",
      providerEmailId: "resend-complaint-456",
    });

    const afterMetric = metrics.emailBounces.get({
      provider: "resend",
      type: "complaint",
    });
    expect(afterMetric).toBe(beforeMetric + 1);
  });

  it("ignores soft / transient bounces from permanent suppression list", async () => {
    const payload = {
      type: "email.bounced",
      data: {
        email_id: "resend-soft-789",
        to: ["mailbox-full@example.com"],
        bounce: {
          type: "soft_bounce",
          message: "452 4.2.2 Mailbox is full",
        },
      },
    };

    const res = await controller.receive("resend", payload);
    expect(res).toEqual({ success: true, data: { received: true } });
    expect(insertedBounces).toHaveLength(0);
  });

  it("handles simulated bounce payload for test environments", async () => {
    const res = await controller.receive("simulated", {
      event: "bounce",
      email: "test-sim@example.com",
      type: "hard_bounce",
      message: "Simulated test bounce",
    });
    expect(res).toEqual({ success: true, data: { received: true } });

    expect(insertedBounces).toHaveLength(1);
    expect(insertedBounces[0]).toMatchObject({
      email: "test-sim@example.com",
      bounceType: "hard_bounce",
      message: "Simulated test bounce",
      provider: "simulated",
    });
  });

  it("records permanently failed invoice email and increments notificationDeadLetter metric (DoD item 3)", () => {
    const beforeInvoiceFailures = metrics.notificationDeadLetter.get({
      template: "order_paid",
    });

    service.recordDeadLetter("order_paid", {
      orderId: "ord-test-failed",
      error: "All 3 retry attempts exhausted: 500 upstream timeout",
    });

    const afterInvoiceFailures = metrics.notificationDeadLetter.get({
      template: "order_paid",
    });
    expect(afterInvoiceFailures).toBe(beforeInvoiceFailures + 1);
  });
});
