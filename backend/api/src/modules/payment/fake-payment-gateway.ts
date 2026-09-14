import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  PaymentProviderError,
  type CreateTransactionInput,
  type CreatedTransaction,
  type NotificationVerdict,
  type PaymentGatewayPort,
  type PaymentOutcome,
  type VerifiedPaymentEvent,
} from "./payment-gateway.port";

/** The fake's own notification shape. Deliberately NOT any real provider's. */
export interface FakeNotification {
  readonly reference: string;
  readonly outcome: PaymentOutcome;
  readonly amount: string;
  readonly method: string | null;
  readonly sequence: number;
  readonly signature: string;
}

/**
 * `P3-03` step 5 — a gateway for tests and local development.
 *
 * It has its own payload shape and its own HMAC signature, so tests written against it exercise
 * the port rather than any provider's format: a webhook handler that passes with this fake and with
 * the real adapter cannot be depending on either one's fields.
 *
 * The signing key is **random per instance** unless a test supplies one. Selected only in
 * development and test with no provider key configured (`payment-gateway.provider.ts`), and even
 * then nobody outside the process can sign a notification it will accept.
 *
 * What `P3-05`'s abuse suites need from it: {@link notify} (valid), {@link forge} (a signature from
 * another key), {@link tamper} (a valid notification altered after signing), a duplicate (send the
 * same object twice), and out-of-order delivery ({@link sequenceOf} numbers every notification so a
 * test can deliver `success` before `pending`).
 */
export class FakePaymentGateway implements PaymentGatewayPort {
  readonly provider = "fake";

  /** Every transaction created, in order — for assertions. */
  readonly created: CreateTransactionInput[] = [];
  /** Set to make the next calls fail like a provider outage. */
  outage: "none" | "retryable" | "refused" = "none";

  private readonly key: Buffer;
  private readonly statuses = new Map<string, FakeNotification>();
  private sequence = 0;

  constructor(signingKey?: string) {
    this.key =
      signingKey === undefined ? randomBytes(32) : Buffer.from(signingKey);
  }

  async createTransaction(
    input: CreateTransactionInput,
  ): Promise<CreatedTransaction> {
    this.failIfOut();
    this.created.push(input);
    return {
      providerReferenceId: input.providerReferenceId,
      redirectUrl: `https://pay.fake.test/${encodeURIComponent(input.providerReferenceId)}`,
      token: `fake-token-${input.providerReferenceId}`,
    };
  }

  verifyNotification(body: unknown): NotificationVerdict {
    if (typeof body !== "object" || body === null) {
      return { valid: false, reason: "malformed" };
    }
    const n = body as Partial<FakeNotification>;
    const claimed = typeof n.reference === "string" ? n.reference : undefined;
    const invalid = (
      reason: "malformed" | "signature_mismatch",
    ): NotificationVerdict =>
      claimed === undefined
        ? { valid: false, reason }
        : { valid: false, reason, claimedReference: claimed };

    if (
      typeof n.reference !== "string" ||
      typeof n.amount !== "string" ||
      !/^\d+$/.test(n.amount) ||
      typeof n.sequence !== "number" ||
      typeof n.signature !== "string" ||
      !["pending", "success", "failed", "ignored"].includes(
        n.outcome as string,
      ) ||
      (n.method !== null && typeof n.method !== "string")
    ) {
      return invalid("malformed");
    }

    const expected = Buffer.from(this.sign(n as FakeNotification), "utf8");
    const actual = Buffer.from(n.signature, "utf8");
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return invalid("signature_mismatch");
    }

    return { valid: true, event: toEvent(n as FakeNotification) };
  }

  async queryStatus(reference: string): Promise<VerifiedPaymentEvent | null> {
    this.failIfOut();
    const latest = this.statuses.get(reference);
    return latest === undefined ? null : toEvent(latest);
  }

  // ------------------------------------------------------------ notification factories

  /** A genuine notification. Also becomes what `queryStatus` reports for the reference. */
  notify(
    reference: string,
    outcome: PaymentOutcome,
    amount: bigint,
    method: string | null = "bank_transfer",
  ): FakeNotification {
    this.sequence += 1;
    const unsigned = {
      reference,
      outcome,
      amount: amount.toString(),
      method,
      sequence: this.sequence,
    };
    const notification = { ...unsigned, signature: this.sign(unsigned) };
    this.statuses.set(reference, notification);
    return notification;
  }

  /** The same notification signed with a key the fake does not hold. */
  forge(
    reference: string,
    outcome: PaymentOutcome,
    amount: bigint,
  ): FakeNotification {
    const other = new FakePaymentGateway();
    const forged = other.notify(reference, outcome, amount);
    return forged;
  }

  /** A genuine notification with fields changed after signing — the amount-tampering attack. */
  tamper(
    notification: FakeNotification,
    changes: Partial<Omit<FakeNotification, "signature">>,
  ): FakeNotification {
    return { ...notification, ...changes };
  }

  /** The delivery order a notification was issued in, for out-of-order tests. */
  sequenceOf(notification: FakeNotification): number {
    return notification.sequence;
  }

  private sign(n: Omit<FakeNotification, "signature">): string {
    return createHmac("sha256", this.key)
      .update(
        [
          n.reference,
          n.outcome,
          n.amount,
          n.method ?? "",
          String(n.sequence),
        ].join("\n"),
      )
      .digest("hex");
  }

  private failIfOut(): void {
    if (this.outage === "retryable") {
      throw new PaymentProviderError("fake provider outage", true);
    }
    if (this.outage === "refused") {
      throw new PaymentProviderError("fake provider refused", false);
    }
  }
}

function toEvent(n: FakeNotification): VerifiedPaymentEvent {
  return {
    providerReferenceId: n.reference,
    outcome: n.outcome,
    amount: BigInt(n.amount),
    method: n.method,
    providerStatus: n.outcome,
    raw: n,
  };
}
