import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import { ForbiddenError, UnauthenticatedError } from "../src/http/errors";
import { SessionService } from "../src/modules/auth/session.service";
import { OrderController } from "../src/modules/order/order.controller";
import {
  OrderService,
  type CheckoutUser,
  type CreateOrderInput,
} from "../src/modules/order/order.service";
import { InvoiceService } from "../src/modules/order/invoice/invoice.service";
import { PolicyRegistry } from "../src/shared/rate-limit/config";
import {
  POLICY_REGISTRY,
  RATE_LIMITER,
} from "../src/shared/rate-limit/rate-limit.guard";

/**
 * `P3-02` at the HTTP layer. `docs/API/06`.
 *
 * What only this layer can show: that the body is refused **before** the service is called when
 * it carries anything but `package_id` and `addon_ids` — an `amount_total` above all — and that
 * the `Idempotency-Key` header reaches the service as it was sent. The service's own rules are
 * `order-create.itest.ts`.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const INVITATION_ID = "33333333-3333-4333-8333-333333333333";

const calls: {
  user: CheckoutUser;
  invitationId: string;
  input: CreateOrderInput;
}[] = [];
let verified = true;

const orderStub = {
  list: async () => ({ items: [{ id: "o1" }, { id: "o2" }], total: 7 }),
  detail: async (_scope: unknown, orderId: string) => ({ id: orderId }),
  create: async (
    user: CheckoutUser,
    invitationId: string,
    input: CreateOrderInput,
  ) => {
    if (!user.emailVerified) throw new ForbiddenError("EMAIL_NOT_VERIFIED");
    calls.push({ user, invitationId, input });
    return {
      id: "44444444-4444-4444-8444-444444444444",
      invitation_id: invitationId,
      package_id: input.packageId,
      addons: input.addonIds,
      amount_total: 12345,
      order_type: "new_publish",
      status: "pending",
      expired_at: "2027-01-02T00:00:00.000Z",
    };
  },
};

const PDF = Buffer.from("%PDF-1.4 fake %%EOF", "latin1");

const invoiceStub = {
  ownedInvoice: async () => ({ number: "INV-20270515-44444444", pdf: PDF }),
};

const sessionStub = {
  authenticate: async (header: string | undefined) => {
    if (header !== "Bearer good") throw new UnauthenticatedError();
    return {
      id: USER_ID,
      email: "budi@example.test",
      fullName: "Budi",
      role: "user",
      emailVerified: verified,
    };
  },
};

const limiterStub = {
  check: async () => ({
    allowed: true,
    limit: 300,
    remaining: 299,
    resetAt: 1789200000,
  }),
  recordFailure: async () => {},
  block: async () => 900,
};

describe("POST /api/v1/invitations/:id/orders over HTTP", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OrderController],
      providers: [
        { provide: APP_FILTER, useClass: AppExceptionFilter },
        { provide: OrderService, useValue: orderStub },
        { provide: InvoiceService, useValue: invoiceStub },
        { provide: SessionService, useValue: sessionStub },
        { provide: RATE_LIMITER, useValue: limiterStub },
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
    verified = true;
  });

  const post = (body: unknown, headers: Record<string, string> = {}) => {
    let req = request(app.getHttpServer())
      .post(`/api/v1/invitations/${INVITATION_ID}/orders`)
      .set("Authorization", "Bearer good");
    for (const [name, value] of Object.entries(headers)) {
      req = req.set(name, value);
    }
    return req.send(body as object);
  };

  it("creates an order: 201, the envelope, a numeric amount", async () => {
    const res = await post({ package_id: "standard" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      data: expect.objectContaining({
        invitation_id: INVITATION_ID,
        package_id: "standard",
        addons: [],
        amount_total: 12345,
        status: "pending",
      }),
    });
    expect(calls).toEqual([
      {
        user: expect.objectContaining({ id: USER_ID, emailVerified: true }),
        invitationId: INVITATION_ID,
        input: {
          packageId: "standard",
          addonIds: [],
          idempotencyKey: undefined,
        },
      },
    ]);
  });

  it.each([
    ["amount_total", { package_id: "standard", amount_total: 1 }],
    ["amount", { package_id: "standard", amount: 1 }],
    ["price", { package_id: "standard", price: 1 }],
    ["order_type", { package_id: "standard", order_type: "renewal" }],
    ["status", { package_id: "standard", status: "paid" }],
    ["user_id", { package_id: "standard", user_id: USER_ID }],
  ])(
    "refuses an amount in the body without calling the service (%s)",
    async (_field, body) => {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(calls).toEqual([]);
    },
  );

  it.each([
    ["no package", {}],
    ["an empty package id", { package_id: "" }],
    ["a non-string package id", { package_id: 7 }],
    ["addons that are not a list", { package_id: "standard", addon_ids: "x" }],
    [
      "eleven addons",
      {
        package_id: "standard",
        addon_ids: Array.from({ length: 11 }, (_, i) => `a${String(i)}`),
      },
    ],
  ])("refuses %s with 400", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("passes the Idempotency-Key through as sent", async () => {
    const res = await post(
      { package_id: "standard", addon_ids: ["x"] },
      { "Idempotency-Key": "checkout-7f3a" },
    );
    expect(res.status).toBe(201);
    expect(calls[0]!.input).toEqual({
      packageId: "standard",
      addonIds: ["x"],
      idempotencyKey: "checkout-7f3a",
    });
  });

  it.each([
    ["a space", "has space"],
    ["too long", "k".repeat(256)],
  ])("refuses an Idempotency-Key with %s", async (_label, key) => {
    const res = await post(
      { package_id: "standard" },
      { "Idempotency-Key": key },
    );
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("answers an unverified user 403 EMAIL_NOT_VERIFIED", async () => {
    verified = false;
    const res = await post({ package_id: "standard" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("GET /orders paginates with the standard meta (P3-08)", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/orders?page=2&per_page=2")
      .set("Authorization", "Bearer good");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: "o1" }, { id: "o2" }]);
    expect(res.body.meta).toMatchObject({ page: 2, per_page: 2, total: 7 });
  });

  it("GET /orders refuses unknown query parameters", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/orders?status=paid")
      .set("Authorization", "Bearer good");
    expect(res.status).toBe(400);
  });

  it("GET /orders/:order_id/invoice sends the PDF as a private, uncached attachment", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/orders/${INVITATION_ID}/invoice`)
      .set("Authorization", "Bearer good")
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="INV-20270515-44444444.pdf"',
    );
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect((res.body as Buffer).equals(PDF)).toBe(true);
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/invitations/${INVITATION_ID}/orders`)
      .send({ package_id: "standard" });
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });
});
