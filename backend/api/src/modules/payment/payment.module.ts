import { Module } from "@nestjs/common";

import { paymentGatewayProvider } from "./payment-gateway.provider";
import { PAYMENT_GATEWAY } from "./payment-gateway.port";

/**
 * `P3-03` — payment. `docs/BACKEND/01` § order & payment: this module knows orders, never the wedding domain.
 * It talks to `order`, and `order` emits `order.paid` (`P3-05`). Initiation (`P3-04`), the webhook
 * (`P3-05`) and status queries (`P3-06`) are added here.
 */
@Module({
  providers: [paymentGatewayProvider],
  exports: [PAYMENT_GATEWAY],
})
export class PaymentModule {}
