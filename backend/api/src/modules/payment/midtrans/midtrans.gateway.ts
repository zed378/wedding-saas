import { createHash, timingSafeEqual } from "node:crypto";

import { logger } from "../../../shared/logging/logger";
import {
  PaymentProviderError,
  type CreateTransactionInput,
  type CreatedTransaction,
  type NotificationVerdict,
  type PaymentGatewayPort,
  type PaymentOutcome,
  type VerifiedPaymentEvent,
} from "../payment-gateway.port";

/**
 * `P3-03` — Midtrans Snap, behind `PaymentGatewayPort`. ADR-012, ADR-075.
 *
 * **Every rule in this file comes from Midtrans's documentation as fetched on 2026-09-14**, not
 * from `docs/SECURITY/07`'s illustration and not from memory (card step 2). The pages are listed in
 * `MEMORY/specs/P3-03-payment-gateway-port.md` § 14. Quoted where it matters:
 *
 * - Signature: *"SHA512(order_id+status_code+gross_amount+ServerKey)"*, hex, with `gross_amount` as
 *   the string Midtrans sent (`"10000.00"`). The signature is a **body field**, `signature_key` —
 *   there is no signature header and no separate webhook secret.
 * - Success: *"`transaction_status` equals `settlement` OR `capture` (for cards) AND `fraud_status`
 *   is `accept` (if field exists) AND `status_code` equals "200"."* `pending` awaits payment;
 *   `deny`, `cancel`, `expire`, `failure` are unsuccessful.
 * - Snap: `POST https://app[.sandbox].midtrans.com/snap/v1/transactions`, Basic auth with the server
 *   key as username and an empty password, `201 { token, redirect_url }`.
 * - Status: `GET https://api[.sandbox].midtrans.com/v2/{order_id}/status`, same auth; the response
 *   has the notification's shape (including `signature_key`) and `status_code: "404"` when absent.
 * - `order_id`: *"Alphanumeric, dash(-), underscore(_), tilde (~), and dot (.). String, max 50."*
 *
 * The provider's name and payload shape stop at this folder
 * (`payment-module-boundaries.spec.ts`).
 */

export const MIDTRANS_PROVIDER = "midtrans";

const SANDBOX_PREFIX = "SB-";
const TIMEOUT_MS = 10_000;
const ORDER_ID = /^[A-Za-z0-9\-_~.]{1,50}$/;
/** Rupiah has no minor unit; Midtrans writes it with `.00`. Anything else is not an amount we sent. */
const GROSS_AMOUNT = /^(\d{1,15})\.00$/;

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface MidtransConfig {
  readonly serverKey: string;
  /** Injected for tests; the global `fetch` otherwise. */
  readonly fetch?: FetchLike;
}

export class MidtransGateway implements PaymentGatewayPort {
  readonly provider = MIDTRANS_PROVIDER;

  private readonly serverKey: string;
  private readonly fetch: FetchLike;
  private readonly snapBase: string;
  private readonly apiBase: string;

  constructor(config: MidtransConfig) {
    this.serverKey = config.serverKey;
    this.fetch = config.fetch ?? (globalThis.fetch as unknown as FetchLike);
    // The endpoint follows the KEY, not a separate flag: a sandbox key can then never be sent to
    // the live API or the reverse. `secret-rules.ts` already ties the key to the environment.
    const sandbox = config.serverKey.startsWith(SANDBOX_PREFIX);
    this.snapBase = sandbox
      ? "https://app.sandbox.midtrans.com"
      : "https://app.midtrans.com";
    this.apiBase = sandbox
      ? "https://api.sandbox.midtrans.com"
      : "https://api.midtrans.com";
  }

  // ------------------------------------------------------------------ create

  async createTransaction(
    input: CreateTransactionInput,
  ): Promise<CreatedTransaction> {
    assertOrderId(input.providerReferenceId);
    if (input.amount <= 0n || input.amount > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new PaymentProviderError("amount out of range", false);
    }

    const body = {
      transaction_details: {
        order_id: input.providerReferenceId,
        // Snap takes a JSON number. Checked to be a safe integer above.
        gross_amount: Number(input.amount),
      },
      // `docs/SECURITY/09`: name and email, nothing else — no phone, no address, nothing about the wedding.
      customer_details: {
        first_name: input.customer.name.trim().slice(0, 255),
        email: input.customer.email,
      },
    };

    const response = await this.call(
      "create_transaction",
      input.providerReferenceId,
      `${this.snapBase}/snap/v1/transactions`,
      "POST",
      JSON.stringify(body),
    );

    if (response.status !== 201) {
      throw failure("create_transaction", response.status);
    }

    const parsed = parseJson(response.body) as {
      token?: unknown;
      redirect_url?: unknown;
    } | null;
    if (
      typeof parsed?.token !== "string" ||
      typeof parsed.redirect_url !== "string"
    ) {
      throw new PaymentProviderError(
        "Midtrans returned 201 without a token and redirect_url",
        true,
      );
    }

    return {
      providerReferenceId: input.providerReferenceId,
      redirectUrl: parsed.redirect_url,
      token: parsed.token,
    };
  }

  // ------------------------------------------------------------------ verify

  verifyNotification(body: unknown): NotificationVerdict {
    return verifyMidtransPayload(body, this.serverKey);
  }

  // ------------------------------------------------------------------- query

  async queryStatus(
    providerReferenceId: string,
  ): Promise<VerifiedPaymentEvent | null> {
    assertOrderId(providerReferenceId);

    const response = await this.call(
      "query_status",
      providerReferenceId,
      `${this.apiBase}/v2/${encodeURIComponent(providerReferenceId)}/status`,
      "GET",
    );

    if (response.status >= 500) throw failure("query_status", response.status);

    const parsed = parseJson(response.body) as { status_code?: unknown } | null;
    // Midtrans answers an unknown order with HTTP 404 and/or `status_code: "404"` in the body.
    if (response.status === 404 || parsed?.status_code === "404") return null;
    if (response.status !== 200) throw failure("query_status", response.status);

    // `docs/BACKEND/05` § Status Polling: the query result "ALSO goes through the same verification
    // process before changing state (not trusted raw)".
    const verdict = verifyMidtransPayload(parsed, this.serverKey);
    if (!verdict.valid) {
      logger.error(
        {
          context: {
            event: "payment.provider_error",
            provider: MIDTRANS_PROVIDER,
            operation: "query_status",
            provider_reference_id: providerReferenceId,
            reason: verdict.reason,
          },
        },
        "a status response failed verification",
      );
      throw new PaymentProviderError(
        `status response failed verification (${verdict.reason})`,
        false,
      );
    }
    if (verdict.event.providerReferenceId !== providerReferenceId) {
      throw new PaymentProviderError(
        "status response is for a different order",
        false,
      );
    }
    return verdict.event;
  }

  // ------------------------------------------------------------------ transport

  private async call(
    operation: string,
    reference: string,
    url: string,
    method: "GET" | "POST",
    body?: string,
  ): Promise<{ status: number; body: string }> {
    const started = Date.now();
    let status: number;
    let text: string;
    try {
      const response = await this.fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${this.serverKey}:`).toString("base64")}`,
        },
        ...(body !== undefined ? { body } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = response.status;
      text = await response.text();
    } catch (cause) {
      logger.warn(
        {
          context: {
            event: "payment.provider_error",
            provider: MIDTRANS_PROVIDER,
            operation,
            provider_reference_id: reference,
            duration_ms: Date.now() - started,
            reason: cause instanceof Error ? cause.name : "unknown",
          },
        },
        "payment provider unreachable",
      );
      throw new PaymentProviderError("Midtrans could not be reached", true, {
        cause,
      });
    }

    // Metadata only. No body, no key, no customer: `docs/DEVOPS/06`.
    logger.info(
      {
        context: {
          event: "payment.provider_call",
          provider: MIDTRANS_PROVIDER,
          operation,
          provider_reference_id: reference,
          http_status: status,
          duration_ms: Date.now() - started,
        },
      },
      "payment provider call",
    );
    return { status, body: text };
  }
}

// ------------------------------------------------------------------------ pure functions

/**
 * Midtrans's documented signature: SHA-512 hex of `order_id + status_code + gross_amount +
 * serverKey`, each exactly as it appears in the payload.
 */
export function midtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
): string {
  return createHash("sha512")
    .update(orderId + statusCode + grossAmount + serverKey)
    .digest("hex");
}

/**
 * Midtrans's documented success rule, and the unsuccessful statuses, onto our four outcomes.
 *
 * `capture` needs `fraud_status: accept` when the field is present; `challenge` (older FDS
 * responses) waits. `settlement`/`capture` with a `status_code` other than `"200"` is not a success
 * by the documented rule and is not a failure either — `ignored`, for a human.
 */
export function normalizeMidtransStatus(payload: {
  readonly transactionStatus: string;
  readonly statusCode: string;
  readonly fraudStatus?: string | undefined;
}): PaymentOutcome {
  const { transactionStatus, statusCode, fraudStatus } = payload;
  switch (transactionStatus) {
    case "settlement":
    case "capture": {
      if (fraudStatus === "deny") return "failed";
      if (fraudStatus === "challenge") return "pending";
      if (fraudStatus !== undefined && fraudStatus !== "accept")
        return "ignored";
      return statusCode === "200" ? "success" : "ignored";
    }
    case "pending":
      return "pending";
    case "deny":
    case "cancel":
    case "expire":
    case "failure":
      return "failed";
    // A refund or chargeback after a success must not fail the payment automatically: BR-5.4 makes a
    // refund an admin action with a reason. `authorize` is a card pre-auth we never capture.
    default:
      return "ignored";
  }
}

export function verifyMidtransPayload(
  body: unknown,
  serverKey: string,
): NotificationVerdict {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { valid: false, reason: "malformed" };
  }
  const payload = body as Record<string, unknown>;
  const orderId = payload["order_id"];
  const claimedReference = typeof orderId === "string" ? orderId : undefined;
  const invalid = (
    reason: "malformed" | "signature_mismatch",
  ): NotificationVerdict =>
    claimedReference !== undefined
      ? { valid: false, reason, claimedReference }
      : { valid: false, reason };

  const statusCode = payload["status_code"];
  const grossAmount = payload["gross_amount"];
  const signature = payload["signature_key"];
  const transactionStatus = payload["transaction_status"];
  const fraudStatus = payload["fraud_status"];
  const paymentType = payload["payment_type"];

  if (
    typeof orderId !== "string" ||
    !ORDER_ID.test(orderId) ||
    typeof statusCode !== "string" ||
    typeof grossAmount !== "string" ||
    typeof signature !== "string" ||
    typeof transactionStatus !== "string" ||
    (fraudStatus !== undefined && typeof fraudStatus !== "string")
  ) {
    return invalid("malformed");
  }

  // Signature FIRST, before the amount is even parsed: nothing about an unverified payload is
  // interpreted (`docs/SECURITY/07` — "MUST be verified BEFORE any logic runs").
  const expected = midtransSignature(
    orderId,
    statusCode,
    grossAmount,
    serverKey,
  );
  if (!constantTimeEqual(signature, expected))
    return invalid("signature_mismatch");

  const amount = GROSS_AMOUNT.exec(grossAmount);
  if (amount === null) return invalid("malformed");

  return {
    valid: true,
    event: {
      providerReferenceId: orderId,
      outcome: normalizeMidtransStatus({
        transactionStatus,
        statusCode,
        fraudStatus: fraudStatus as string | undefined,
      }),
      amount: BigInt(amount[1]!),
      method: typeof paymentType === "string" ? paymentType : null,
      providerStatus: transactionStatus,
      raw: body,
    },
  };
}

/** Exact, constant-time for equal lengths. A different length is a mismatch without comparing. */
function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function assertOrderId(reference: string): void {
  if (!ORDER_ID.test(reference)) {
    throw new PaymentProviderError(
      "provider reference is not a valid Midtrans order_id",
      false,
    );
  }
}

function failure(operation: string, status: number): PaymentProviderError {
  const retryable = status >= 500 || status === 429;
  logger[retryable ? "warn" : "error"](
    {
      context: {
        event: "payment.provider_error",
        provider: MIDTRANS_PROVIDER,
        operation,
        http_status: status,
      },
    },
    retryable
      ? "payment provider failed"
      : "payment provider refused the request",
  );
  return new PaymentProviderError(
    `Midtrans ${operation} answered ${String(status)}`,
    retryable,
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
