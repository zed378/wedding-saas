import type { Provider } from "@nestjs/common";

import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import { FakePaymentGateway } from "./fake-payment-gateway";
import { MidtransGateway } from "./midtrans/midtrans.gateway";
import {
  PAYMENT_GATEWAY,
  PaymentProviderError,
  type PaymentGatewayPort,
} from "./payment-gateway.port";

/**
 * `P3-03` step 4 — which gateway runs, by environment (`P0-18`).
 *
 * - A Midtrans server key configured → Midtrans. `secret-rules.ts` has already refused a live key
 *   outside production and a sandbox key inside it, and production refuses to boot without one.
 * - No key, development or test → the fake, with a random per-process signing key.
 * - No key anywhere else (staging before its sandbox key is set) → an unconfigured gateway that
 *   refuses every call. The API still boots; checkout says payment is unavailable. Never the fake:
 *   a deployed fake would "take payments" that are not payments.
 *
 * This file is the composition root, and it is the one place outside `midtrans/` allowed to name
 * the adapter (`payment-module-boundaries.spec.ts`).
 */
export function selectPaymentGateway(env: Env): PaymentGatewayPort {
  const key = env.MIDTRANS_SERVER_KEY;
  if (key !== undefined && key.length > 0) {
    return new MidtransGateway({ serverKey: key });
  }
  if (env.APP_ENV === "development" || env.APP_ENV === "test") {
    return new FakePaymentGateway();
  }
  return unconfigured;
}

const refuse = async (): Promise<never> => {
  throw new PaymentProviderError(
    "payment gateway is not configured in this environment",
    false,
  );
};

const unconfigured: PaymentGatewayPort = {
  provider: "unconfigured",
  createTransaction: refuse,
  queryStatus: refuse,
  // Nothing can be verified without a key: every notification is refused.
  verifyNotification: () => ({ valid: false, reason: "signature_mismatch" }),
};

export const paymentGatewayProvider: Provider = {
  provide: PAYMENT_GATEWAY,
  inject: [ENV],
  useFactory: selectPaymentGateway,
};
