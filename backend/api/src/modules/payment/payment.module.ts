import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { OrderModule } from "../order/order.module";
import { paymentGatewayProvider } from "./payment-gateway.provider";
import { PAYMENT_GATEWAY } from "./payment-gateway.port";
import { PaymentController } from "./payment.controller";
import { PaymentRepository } from "./payment.repository";
import { PaymentService } from "./payment.service";

/**
 * `P3-03`, `P3-04` — payment. `docs/BACKEND/01` § order & payment: this module knows orders, never
 * the wedding domain. It reaches orders through `OrderService`; `order` emits `order.paid` (`P3-05`).
 */
@Module({
  imports: [AuthModule, OrderModule],
  controllers: [PaymentController],
  providers: [paymentGatewayProvider, PaymentRepository, PaymentService],
  exports: [PAYMENT_GATEWAY, PaymentService],
})
export class PaymentModule {}
