import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";

const { increment, warn, info } = vi.hoisted(() => ({
  increment: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));
vi.mock("../../shared/metrics/metrics", () => ({
  metrics: { emailBounces: { inc: increment } },
}));
vi.mock("../../shared/logging/logger", () => ({ logger: { warn, info } }));

import { EmailWebhookService } from "./email-webhook.service";

function harness() {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  return {
    service: new EmailWebhookService({ insert } as never),
    insert,
    values,
    onConflictDoNothing,
  };
}

describe("EmailWebhookService normalization and suppression", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([null, undefined, false, "invalid", 42])(
    "rejects non-object payload %s before metrics or persistence",
    async (payload) => {
      const { service, insert } = harness();
      await expect(service.handle("resend", payload)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(insert).not.toHaveBeenCalled();
      expect(increment).not.toHaveBeenCalled();
    },
  );

  it("normalizes hard bounce recipients and stores bounded evidence idempotently", async () => {
    const { service, values, onConflictDoNothing } = harness();
    await expect(
      service.handle(" Resend ", {
        type: "EMAIL.BOUNCED",
        data: {
          to: " COUPLE@EXAMPLE.TEST ",
          email_id: "email-1",
          message: "x".repeat(1100),
        },
      }),
    ).resolves.toEqual({
      received: true,
      provider: "resend",
      type: "hard_bounce",
      email: "couple@example.test",
      suppressed: true,
    });
    expect(values).toHaveBeenCalledWith({
      email: "couple@example.test",
      bounceType: "hard_bounce",
      message: "x".repeat(1000),
      provider: "resend",
      providerEmailId: "email-1",
    });
    expect(onConflictDoNothing).toHaveBeenCalledOnce();
    expect(increment).toHaveBeenCalledWith({
      provider: "resend",
      type: "hard_bounce",
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(info).not.toHaveBeenCalled();
  });

  it.each([
    {
      payload: {
        event: "spam_complaint",
        to: ["FIRST@EXAMPLE.TEST", "second@example.test"],
        id: "message-2",
        bounce: { message: "Spam reported" },
      },
      email: "first@example.test",
      type: "complaint",
      id: "message-2",
      message: "Spam reported",
    },
    {
      payload: {
        type: "email.complained",
        data: { email: "DATA@EXAMPLE.TEST" },
      },
      email: "data@example.test",
      type: "complaint",
      id: null,
      message: null,
    },
    {
      payload: {
        type: "hard_failure",
        data: { to: [] },
        email: "FALLBACK@EXAMPLE.TEST",
      },
      email: "fallback@example.test",
      type: "hard_bounce",
      id: null,
      message: null,
    },
    {
      payload: { type: "bounced", email: "DIRECT@EXAMPLE.TEST", message: "" },
      email: "direct@example.test",
      type: "hard_bounce",
      id: null,
      message: null,
    },
  ])(
    "extracts suppression evidence from documented shapes: $type / $email",
    async ({ payload, email, type, id, message }) => {
      const { service, values } = harness();
      await expect(service.handle("mock", payload)).resolves.toMatchObject({
        email,
        type,
        suppressed: true,
      });
      expect(values).toHaveBeenCalledWith({
        email,
        bounceType: type,
        message,
        provider: "mock",
        providerEmailId: id,
      });
    },
  );

  it.each([
    ["soft_failure", "soft_bounce"],
    ["transient", "soft_bounce"],
    ["email.delivered", "delivered"],
    ["delivered", "delivered"],
    ["email.opened", "other"],
  ])(
    "records %s metrics without suppressing a deliverable address",
    async (event, expected) => {
      const { service, insert } = harness();
      await expect(
        service.handle("mock", {
          event,
          data: { to: ["recipient@example.test"] },
        }),
      ).resolves.toEqual({
        received: true,
        provider: "mock",
        type: expected,
        email: "recipient@example.test",
        suppressed: false,
      });
      expect(insert).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledOnce();
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it("does not persist suppression without a recipient or fabricate an event type", async () => {
    const { service, insert } = harness();
    await expect(
      service.handle("mock", { type: "bounced", data: { to: [] } }),
    ).resolves.toEqual({
      received: true,
      provider: "mock",
      type: "hard_bounce",
      email: undefined,
      suppressed: true,
    });
    await expect(
      service.handle("mock", {
        data: "malformed",
        email: "known@example.test",
      }),
    ).resolves.toMatchObject({
      type: "other",
      email: "known@example.test",
      suppressed: false,
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("propagates database failures so delivery retries can persist suppression evidence", async () => {
    const { service, onConflictDoNothing } = harness();
    onConflictDoNothing.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await expect(
      service.handle("mock", { type: "bounced", email: "dead@example.test" }),
    ).rejects.toThrow("database unavailable");
    expect(warn).not.toHaveBeenCalled();
  });
});
