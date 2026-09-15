import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import { NotFoundError, UnauthenticatedError } from "../src/http/errors";
import { PaymentWebhookController } from "../src/modules/payment/payment-webhook.controller";
import { PaymentWebhookService } from "../src/modules/payment/payment-webhook.service";

/**
 * `P3-05` at the HTTP layer: the route is the one `docs/API/07` names, needs no user token, and maps
 * the service's outcomes to what a provider acts on — 200 (stop retrying), 401 (refused), 404 (wrong
 * provider), 500 (try again).
 */

let behaviour: "ok" | "invalid" | "wrong-provider" | "crash" = "ok";
const received: { provider: string; body: unknown }[] = [];

const stub = {
  handle: async (provider: string, body: unknown) => {
    received.push({ provider, body });
    if (behaviour === "invalid") {
      throw new UnauthenticatedError("Notification signature is not valid.");
    }
    if (behaviour === "wrong-provider") throw new NotFoundError();
    if (behaviour === "crash") throw new Error("database gone");
    return "applied";
  },
};

describe("POST /api/webhooks/payment/:provider", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentWebhookController],
      providers: [
        { provide: APP_FILTER, useClass: AppExceptionFilter },
        { provide: PaymentWebhookService, useValue: stub },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    behaviour = "ok";
    received.length = 0;
  });

  const send = () =>
    request(app.getHttpServer())
      .post("/api/webhooks/payment/midtrans")
      .send({ order_id: "x", signature_key: "y" });

  it("reaches the service with no Authorization header and answers 200", async () => {
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { received: true } });
    expect(received).toEqual([
      { provider: "midtrans", body: { order_id: "x", signature_key: "y" } },
    ]);
  });

  it.each([
    ["invalid", 401],
    ["wrong-provider", 404],
    ["crash", 500],
  ] as const)(
    "maps %s to %i without leaking internals",
    async (mode, status) => {
      behaviour = mode;
      const res = await send();
      expect(res.status).toBe(status);
      expect(JSON.stringify(res.body)).not.toContain("database gone");
    },
  );
});
