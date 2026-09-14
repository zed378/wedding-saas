import { describe, expect, it } from "vitest";

import {
  MidtransGateway,
  midtransSignature,
  normalizeMidtransStatus,
  verifyMidtransPayload,
  type FetchLike,
} from "../src/modules/payment/midtrans/midtrans.gateway";
import { PaymentProviderError } from "../src/modules/payment/payment-gateway.port";

/**
 * `P3-03` — the Midtrans adapter, against Midtrans's documentation (fetched 2026-09-14).
 *
 * The known vector uses the **inputs** from Midtrans's "Receiving Notifications" page — order
 * `1111`, status `200`, amount `100000.00`, server key `askvnoibnosifnboseofinbofinfgbiufglnbfg`.
 * The page does not print the resulting hash, so the expected value below was computed with
 * Python's `hashlib.sha512`, a different implementation from the Node `crypto` under test. A
 * formula error — a different field order, a missing field, a separator — changes it.
 */

const DOC_KEY = "askvnoibnosifnboseofinbofinfgbiufglnbfg";
const DOC_SIGNATURE =
  "edc076b21793ebe3e17926350f5b8ae67d902fe657b3d0aa31b932d5c127e2375d308a2bc94f3265ac2d80a1f181a79b997ac178a236fcff35af263fc4d4c231";

const SANDBOX_KEY = "SB-Mid-server-test-key-not-real";
const LIVE_KEY = "Mid-server-test-key-not-real";

/** A settlement notification signed with `key`, in the documented shape. */
function notification(
  overrides: Record<string, unknown> = {},
  key = SANDBOX_KEY,
): Record<string, unknown> {
  const base = {
    order_id: "pay-7c1f2b3a",
    status_code: "200",
    gross_amount: "139000.00",
    transaction_status: "settlement",
    payment_type: "bank_transfer",
    transaction_id: "c5f1f0c0-1111-4c3e-9f2a-000000000000",
    ...overrides,
  } as Record<string, string>;
  return {
    ...base,
    signature_key: midtransSignature(
      base["order_id"]!,
      base["status_code"]!,
      base["gross_amount"]!,
      key,
    ),
  };
}

describe("the signature (Midtrans: SHA512(order_id+status_code+gross_amount+ServerKey))", () => {
  it("matches the vector computed independently from the documented inputs", () => {
    expect(midtransSignature("1111", "200", "100000.00", DOC_KEY)).toBe(
      DOC_SIGNATURE,
    );
  });

  it("verifies the documented example as a whole notification", () => {
    const verdict = verifyMidtransPayload(
      {
        order_id: "1111",
        status_code: "200",
        gross_amount: "100000.00",
        transaction_status: "settlement",
        signature_key: DOC_SIGNATURE,
      },
      DOC_KEY,
    );
    expect(verdict).toMatchObject({
      valid: true,
      event: {
        providerReferenceId: "1111",
        outcome: "success",
        amount: 100000n,
        method: null,
        providerStatus: "settlement",
      },
    });
  });

  it("rejects a signature made with another key", () => {
    const verdict = verifyMidtransPayload(
      notification({}, "SB-Mid-server-attacker"),
      SANDBOX_KEY,
    );
    expect(verdict).toEqual({
      valid: false,
      reason: "signature_mismatch",
      claimedReference: "pay-7c1f2b3a",
    });
  });

  it("rejects a notification whose amount was changed after signing", () => {
    const tampered = { ...notification(), gross_amount: "1000.00" };
    expect(verifyMidtransPayload(tampered, SANDBOX_KEY)).toMatchObject({
      valid: false,
      reason: "signature_mismatch",
    });
  });

  it("rejects a notification whose status_code was changed after signing", () => {
    const tampered = {
      ...notification({ status_code: "201", transaction_status: "pending" }),
      status_code: "200",
      transaction_status: "settlement",
    };
    expect(verifyMidtransPayload(tampered, SANDBOX_KEY)).toMatchObject({
      valid: false,
      reason: "signature_mismatch",
    });
  });

  it("rejects a notification for another order carrying a real signature", () => {
    const tampered = { ...notification(), order_id: "pay-somebody-else" };
    expect(verifyMidtransPayload(tampered, SANDBOX_KEY)).toMatchObject({
      valid: false,
      reason: "signature_mismatch",
    });
  });

  it("compares signatures exactly: case, truncation and padding all fail", () => {
    const genuine = notification();
    const signature = genuine["signature_key"] as string;
    for (const altered of [
      signature.toUpperCase(),
      signature.slice(0, -1),
      `${signature}0`,
      ` ${signature}`,
      "",
    ]) {
      expect(
        verifyMidtransPayload(
          { ...genuine, signature_key: altered },
          SANDBOX_KEY,
        ).valid,
      ).toBe(false);
    }
  });

  it.each([
    ["no body", null],
    ["an array", []],
    ["a string", "order_id=1"],
    ["no signature", { ...notification(), signature_key: undefined }],
    ["a numeric amount", { ...notification(), gross_amount: 139000 }],
    ["a numeric status code", { ...notification(), status_code: 200 }],
    [
      "no transaction status",
      { ...notification(), transaction_status: undefined },
    ],
    ["an order id Midtrans could not issue", notification({ order_id: "a b" })],
    ["a non-string fraud status", { ...notification(), fraud_status: 1 }],
  ])("treats a notification with %s as malformed", (_label, body) => {
    expect(verifyMidtransPayload(body, SANDBOX_KEY)).toMatchObject({
      valid: false,
      reason: "malformed",
    });
  });

  it("refuses a correctly signed amount with a minor unit: rupiah has none", () => {
    expect(
      verifyMidtransPayload(
        notification({ gross_amount: "139000.50" }),
        SANDBOX_KEY,
      ),
    ).toMatchObject({ valid: false, reason: "malformed" });
  });

  it("never interprets an unverified payload: no outcome on a mismatch", () => {
    const verdict = verifyMidtransPayload(
      notification({}, "SB-other"),
      SANDBOX_KEY,
    );
    expect("event" in verdict).toBe(false);
  });
});

describe("status normalisation (Midtrans's documented success rule)", () => {
  it.each([
    ["settlement", "200", undefined, "success"],
    ["settlement", "200", "accept", "success"],
    ["capture", "200", "accept", "success"],
    ["capture", "200", undefined, "success"],
    ["capture", "200", "deny", "failed"],
    ["capture", "201", "challenge", "pending"],
    ["settlement", "201", undefined, "ignored"],
    ["pending", "201", undefined, "pending"],
    ["deny", "202", undefined, "failed"],
    ["cancel", "200", undefined, "failed"],
    ["expire", "407", undefined, "failed"],
    ["failure", "500", undefined, "failed"],
    // BR-5.4: a refund is an admin action; a provider refund notification must not fail a payment.
    ["refund", "200", undefined, "ignored"],
    ["partial_refund", "200", undefined, "ignored"],
    ["chargeback", "200", undefined, "ignored"],
    ["authorize", "200", "accept", "ignored"],
    ["something_new", "200", undefined, "ignored"],
  ] as const)(
    "%s / %s / fraud %s → %s",
    (transactionStatus, statusCode, fraudStatus, expected) => {
      expect(
        normalizeMidtransStatus({ transactionStatus, statusCode, fraudStatus }),
      ).toBe(expected);
    },
  );
});

// ------------------------------------------------------------------------- transport

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(
  respond: (call: Call) => { status: number; body: unknown } | Error,
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: init.method,
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    };
    calls.push(call);
    const result = respond(call);
    if (result instanceof Error) throw result;
    return {
      status: result.status,
      text: async () =>
        typeof result.body === "string"
          ? result.body
          : JSON.stringify(result.body),
    };
  };
  return { fetch, calls };
}

const transaction = {
  providerReferenceId: "pay-7c1f2b3a",
  amount: 139000n,
  customer: { name: "  Budi Santoso ", email: "budi@example.test" },
};

describe("createTransaction", () => {
  it("posts to the sandbox Snap endpoint for a sandbox key, with Basic auth and the minimum body", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      status: 201,
      body: {
        token: "tok-1",
        redirect_url:
          "https://app.sandbox.midtrans.com/snap/v3/redirection/tok-1",
      },
    }));
    const gateway = new MidtransGateway({ serverKey: SANDBOX_KEY, fetch });

    const created = await gateway.createTransaction(transaction);

    expect(created).toEqual({
      providerReferenceId: "pay-7c1f2b3a",
      token: "tok-1",
      redirectUrl: "https://app.sandbox.midtrans.com/snap/v3/redirection/tok-1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://app.sandbox.midtrans.com/snap/v1/transactions",
    );
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers["Authorization"]).toBe(
      `Basic ${Buffer.from(`${SANDBOX_KEY}:`).toString("base64")}`,
    );
    // `docs/SECURITY/09`: exactly name and email. Nothing about the invitation.
    expect(calls[0]!.body).toEqual({
      transaction_details: { order_id: "pay-7c1f2b3a", gross_amount: 139000 },
      customer_details: {
        first_name: "Budi Santoso",
        email: "budi@example.test",
      },
    });
  });

  it("uses the production endpoints for a live key", async () => {
    const { fetch, calls } = fakeFetch((call) =>
      call.method === "POST"
        ? { status: 201, body: { token: "t", redirect_url: "https://x" } }
        : { status: 404, body: { status_code: "404" } },
    );
    const gateway = new MidtransGateway({ serverKey: LIVE_KEY, fetch });
    await gateway.createTransaction(transaction);
    await gateway.queryStatus("pay-7c1f2b3a");
    expect(calls.map((c) => c.url)).toEqual([
      "https://app.midtrans.com/snap/v1/transactions",
      "https://api.midtrans.com/v2/pay-7c1f2b3a/status",
    ]);
  });

  it.each([
    ["a 500", { status: 500, body: {} }, true],
    ["a 503", { status: 503, body: "gateway down" }, true],
    ["a 429", { status: 429, body: {} }, true],
    ["a 401 (wrong key)", { status: 401, body: {} }, false],
    ["a 400", { status: 400, body: { error_messages: ["x"] } }, false],
    [
      "a 201 without a token",
      { status: 201, body: { redirect_url: "x" } },
      true,
    ],
    ["a 201 that is not JSON", { status: 201, body: "<html>" }, true],
  ] as const)(
    "turns %s into a PaymentProviderError, retryable: %s",
    async (_label, response, retryable) => {
      const { fetch } = fakeFetch(() => response);
      const gateway = new MidtransGateway({ serverKey: SANDBOX_KEY, fetch });
      const error = await gateway
        .createTransaction(transaction)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PaymentProviderError);
      expect((error as PaymentProviderError).retryable).toBe(retryable);
    },
  );

  it("turns a network failure or timeout into a retryable error", async () => {
    const { fetch } = fakeFetch(
      () => new DOMException("timed out", "TimeoutError"),
    );
    const gateway = new MidtransGateway({ serverKey: SANDBOX_KEY, fetch });
    const error = await gateway
      .createTransaction(transaction)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      name: "PaymentProviderError",
      retryable: true,
    });
  });

  it.each([
    [
      "an order id Midtrans rejects",
      { ...transaction, providerReferenceId: "has space" },
    ],
    [
      "a 51-character order id",
      { ...transaction, providerReferenceId: "a".repeat(51) },
    ],
    ["a zero amount", { ...transaction, amount: 0n }],
    [
      "an amount beyond a safe JSON number",
      { ...transaction, amount: 2n ** 60n },
    ],
  ])("refuses %s without calling Midtrans", async (_label, input) => {
    const { fetch, calls } = fakeFetch(() => ({ status: 201, body: {} }));
    const gateway = new MidtransGateway({ serverKey: SANDBOX_KEY, fetch });
    await expect(gateway.createTransaction(input)).rejects.toMatchObject({
      retryable: false,
    });
    expect(calls).toEqual([]);
  });
});

describe("queryStatus", () => {
  it("returns a verified event from a signed status response", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      status: 200,
      body: notification({ transaction_status: "pending", status_code: "201" }),
    }));
    const gateway = new MidtransGateway({ serverKey: SANDBOX_KEY, fetch });

    const event = await gateway.queryStatus("pay-7c1f2b3a");

    expect(calls[0]).toMatchObject({
      url: "https://api.sandbox.midtrans.com/v2/pay-7c1f2b3a/status",
      method: "GET",
    });
    expect(event).toMatchObject({
      providerReferenceId: "pay-7c1f2b3a",
      outcome: "pending",
      amount: 139000n,
    });
  });

  it("returns null when Midtrans has no such transaction", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 404,
      body: {
        status_code: "404",
        status_message: "Transaction doesn't exist.",
      },
    }));
    const gateway = new MidtransGateway({ serverKey: SANDBOX_KEY, fetch });
    expect(await gateway.queryStatus("pay-7c1f2b3a")).toBeNull();
  });

  it("refuses a status response whose signature does not verify", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 200,
      body: notification({}, "SB-someone-else"),
    }));
    const gateway = new MidtransGateway({ serverKey: SANDBOX_KEY, fetch });
    await expect(gateway.queryStatus("pay-7c1f2b3a")).rejects.toMatchObject({
      name: "PaymentProviderError",
      retryable: false,
    });
  });

  it("refuses a verified status response for a different order", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 200,
      body: notification({ order_id: "pay-other" }),
    }));
    const gateway = new MidtransGateway({ serverKey: SANDBOX_KEY, fetch });
    await expect(gateway.queryStatus("pay-7c1f2b3a")).rejects.toBeInstanceOf(
      PaymentProviderError,
    );
  });
});
