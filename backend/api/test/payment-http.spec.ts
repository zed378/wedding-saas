import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import {
  ServiceUnavailableError,
  UnauthenticatedError,
} from "../src/http/errors";
import { SessionService } from "../src/modules/auth/session.service";
import { PaymentController } from "../src/modules/payment/payment.controller";
import {
  PaymentService,
  type PayingUser,
} from "../src/modules/payment/payment.service";
import { PaymentStatusService } from "../src/modules/payment/payment-status.service";
import { PolicyRegistry } from "../src/shared/rate-limit/config";
import {
  POLICY_REGISTRY,
  RATE_LIMITER,
} from "../src/shared/rate-limit/rate-limit.guard";

/**
 * `P3-04` at the HTTP layer. `docs/API/07` § Initiation Flow: the response carries only what the client
 * needs to reach the payment page — nothing a client could read as "paid".
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";

const calls: { user: PayingUser; orderId: string }[] = [];
let outage = false;

const paymentStub = {
  initiate: async (user: PayingUser, orderId: string) => {
    if (outage) {
      throw new ServiceUnavailableError(
        "Pembayaran sedang tidak dapat diproses. Silakan coba lagi dalam beberapa saat.",
        "PAYMENT_UNAVAILABLE",
      );
    }
    calls.push({ user, orderId });
    return {
      redirect_url: "https://pay.fake.test/x",
      token: "tok",
      expires_at: "2027-01-02T00:00:00.000Z",
    };
  },
};

const statusCalls: { scope: string; orderId: string }[] = [];
const statusStub = {
  status: async (scope: string, orderId: string) => {
    statusCalls.push({ scope, orderId });
    return {
      order_status: "pending",
      payment_status: "pending",
      paid_at: null,
    };
  },
};

describe("POST /api/v1/orders/:order_id/payment over HTTP", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [
        { provide: APP_FILTER, useClass: AppExceptionFilter },
        { provide: PaymentService, useValue: paymentStub },
        { provide: PaymentStatusService, useValue: statusStub },
        {
          provide: SessionService,
          useValue: {
            authenticate: async (header: string | undefined) => {
              if (header !== "Bearer good") throw new UnauthenticatedError();
              return {
                id: USER_ID,
                email: "budi@example.test",
                fullName: "Budi",
                role: "user",
                emailVerified: true,
              };
            },
          },
        },
        {
          provide: RATE_LIMITER,
          useValue: {
            check: async () => ({
              allowed: true,
              limit: 300,
              remaining: 299,
              resetAt: 1789200000,
            }),
            recordFailure: async () => {},
            block: async () => 900,
          },
        },
        {
          provide: POLICY_REGISTRY,
          useValue: new PolicyRegistry(undefined, undefined),
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    calls.length = 0;
    outage = false;
  });

  const post = () =>
    request(app.getHttpServer())
      .post(`/api/v1/orders/${ORDER_ID}/payment`)
      .set("Authorization", "Bearer good");

  it("201 with the checkout and no status field anywhere", async () => {
    const res = await post();
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      data: {
        redirect_url: "https://pay.fake.test/x",
        token: "tok",
        expires_at: "2027-01-02T00:00:00.000Z",
      },
    });
    // Card DoD 3: nothing that reads as confirmation.
    expect(JSON.stringify(res.body.data)).not.toMatch(/status|paid|success/i);
    expect(calls).toEqual([
      {
        user: { scope: USER_ID, fullName: "Budi", email: "budi@example.test" },
        orderId: ORDER_ID,
      },
    ]);
  });

  it.each([
    ["an amount", { amount: 1 }],
    ["an amount_total", { amount_total: 1 }],
    ["a status", { status: "success" }],
    ["a customer", { customer: { email: "x@example.test" } }],
  ])(
    "refuses any body field (%s) without calling the service",
    async (_label, body) => {
      const res = await post().send(body);
      expect(res.status).toBe(400);
      expect(calls).toEqual([]);
    },
  );

  it("answers a provider outage with 503 PAYMENT_UNAVAILABLE and a friendly message", async () => {
    outage = true;
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({
      code: "PAYMENT_UNAVAILABLE",
      message:
        "Pembayaran sedang tidak dapat diproses. Silakan coba lagi dalam beberapa saat.",
    });
  });

  it("GET …/payment/status reads through the service, privately cacheable for two seconds (P3-06)", async () => {
    statusCalls.length = 0;
    const res = await request(app.getHttpServer())
      .get(`/api/v1/orders/${ORDER_ID}/payment/status`)
      .set("Authorization", "Bearer good");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=2");
    expect(res.body).toEqual({
      success: true,
      data: {
        order_status: "pending",
        payment_status: "pending",
        paid_at: null,
      },
    });
    expect(statusCalls).toEqual([{ scope: USER_ID, orderId: ORDER_ID }]);
  });

  it("GET …/payment/status ignores any status a client tries to supply", async () => {
    // Display only by construction: there is no parameter to carry one.
    statusCalls.length = 0;
    const res = await request(app.getHttpServer())
      .get(
        `/api/v1/orders/${ORDER_ID}/payment/status?status=paid&transaction_status=settlement`,
      )
      .set("Authorization", "Bearer good");
    expect(res.body.data.order_status).toBe("pending");
    expect(statusCalls).toEqual([{ scope: USER_ID, orderId: ORDER_ID }]);
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer()).post(
      `/api/v1/orders/${ORDER_ID}/payment`,
    );
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });
});
