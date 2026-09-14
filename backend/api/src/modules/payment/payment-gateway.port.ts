/**
 * `P3-03` — the payment gateway port. `docs/BACKEND/05`, `docs/PLAN/18` R9,
 * `MEMORY/specs/P3-03-payment-gateway-port.md`.
 *
 * Everything outside an adapter speaks only these types. No provider name, status vocabulary
 * or payload field crosses this line, which is what keeps switching provider an adapter plus a
 * webhook route rather than a redesign (ADR-012).
 *
 * ## There is no unverified notification type
 *
 * `docs/SECURITY/07`'s golden rule is that payment status comes only from a verified webhook or a
 * server-initiated query. So the port has no way to parse a notification without verifying it:
 * `verifyNotification` returns either a verdict of invalid, or an event whose signature has
 * already been checked. A handler cannot read `outcome` from something it forgot to verify,
 * because nothing unverified has an `outcome`.
 */

/**
 * What a provider event means for us.
 *
 * `pending | success | failed` are `payments.status`. `ignored` is everything that must NOT move
 * payment state automatically — a refund or chargeback notification (BR-5.4 makes refunds an
 * admin action), a card pre-authorisation, a status the adapter does not recognise. `P3-05` records
 * those and flags them; it never writes `ignored` anywhere.
 */
export type PaymentOutcome = "pending" | "success" | "failed" | "ignored";

export interface CreateTransactionInput {
  /**
   * Our reference for this payment attempt, sent to the provider and echoed in every
   * notification. Becomes `payments.provider_reference_id`.
   */
  readonly providerReferenceId: string;
  /** Rupiah, from the order row (`docs/BACKEND/05`). Never from a request. */
  readonly amount: bigint;
  /** The minimum the provider needs (`docs/SECURITY/09` § Third-Party Data Sharing). */
  readonly customer: { readonly name: string; readonly email: string };
}

export interface CreatedTransaction {
  readonly providerReferenceId: string;
  /** Where the browser goes to pay. */
  readonly redirectUrl: string;
  /** For an embedded widget, if the client uses one. */
  readonly token: string;
}

/** A provider event whose authenticity has been verified. */
export interface VerifiedPaymentEvent {
  readonly providerReferenceId: string;
  readonly outcome: PaymentOutcome;
  /** Rupiah, as the provider states it. `P3-05` compares it with `payments.amount`. */
  readonly amount: bigint;
  /** Payment method as the provider names it (`payments.method`), or `null`. */
  readonly method: string | null;
  /** The provider's own status word — for records and investigation, never for decisions. */
  readonly providerStatus: string;
  /** The verified payload, for `payments.raw_callback_payload` only. Never log it. */
  readonly raw: unknown;
}

export type NotificationVerdict =
  | { readonly valid: true; readonly event: VerifiedPaymentEvent }
  | {
      readonly valid: false;
      readonly reason: "malformed" | "signature_mismatch";
      /**
       * The reference the payload CLAIMS, when it has one — for logging an attempt against a
       * real payment. Unverified: never look anything up by it and act.
       */
      readonly claimedReference?: string;
    };

export interface PaymentGatewayPort {
  /** Opaque provider id, stored in `payments.provider` and matched against the webhook route. */
  readonly provider: string;

  createTransaction(input: CreateTransactionInput): Promise<CreatedTransaction>;

  /** Verify a parsed notification body. Synchronous and total: never throws on bad input. */
  verifyNotification(body: unknown): NotificationVerdict;

  /**
   * Ask the provider directly (`docs/BACKEND/05` § Status Polling). The response is verified like
   * a notification before it is returned. `null` when the provider has no such transaction.
   */
  queryStatus(
    providerReferenceId: string,
  ): Promise<VerifiedPaymentEvent | null>;
}

/** A provider call that did not produce an answer. */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    /** Whether trying again later may succeed: timeouts, network, 5xx. */
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PaymentProviderError";
  }
}

/** Injection token for the configured gateway. */
export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");
