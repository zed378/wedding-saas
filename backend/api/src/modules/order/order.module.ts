import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../../shared/audit/audit.module";
import { OrderRepository } from "../../shared/tenancy/order-repository";
import { OrderController } from "./order.controller";
import { OrderService } from "./order.service";
import { InvoiceRepository } from "./invoice/invoice.repository";
import { InvoiceService } from "./invoice/invoice.service";
import { PricingModule } from "./pricing.module";

/**
 * `P3-02` — orders. `docs/ARCHITECTURE/01`'s `order` module: creation now; payment initiation,
 * expiry and history follow in `P3-04`, `P3-07` and `P3-08`.
 *
 * `AuditModule` for `InvitationStatusService`, which owns the checkout transition.
 */
@Module({
  imports: [AuthModule, AuditModule, PricingModule],
  controllers: [OrderController],
  providers: [OrderService, OrderRepository, InvoiceService, InvoiceRepository],
  exports: [OrderService, InvoiceService],
})
export class OrderModule {}
