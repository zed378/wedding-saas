import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { OrderModule } from "../order/order.module";
import { paymentGatewayProvider } from "./payment-gateway.provider";
import { PAYMENT_GATEWAY } from "./payment-gateway.port";
import { PaymentController } from "./payment.controller";
import { PaymentWebhookController } from "./payment-webhook.controller";
import { PaymentWebhookService } from "./payment-webhook.service";
import { PaymentRepository } from "./payment.repository";
import { PaymentService } from "./payment.service";
import { PaymentStatusService } from "./payment-status.service";
import { PaymentReconciliationService } from "./payment-reconciliation.service";

/**
 * `P3-03`, `P3-04` — payment. `docs/BACKEND/01` § order & payment: this module knows orders, never
 * the wedding domain. It reaches orders through `OrderService`; `order` emits `order.paid` (`P3-05`).
 */
@Module({
  imports: [AuthModule, OrderModule],
  controllers: [PaymentController, PaymentWebhookController],
  providers: [
    paymentGatewayProvider,
    PaymentRepository,
    PaymentService,
    PaymentWebhookService,
    PaymentStatusService,
    PaymentReconciliationService,
  ],
  exports: [PAYMENT_GATEWAY, PaymentService, PaymentReconciliationService],
})
export class PaymentModule {}
