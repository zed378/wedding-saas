import type { INestApplicationContext } from "@nestjs/common";

import { OrderService } from "../modules/order/order.service";
import { PaymentReconciliationService } from "../modules/payment/payment-reconciliation.service";

/**
 * `P3-06`, ADR-078 — scheduled jobs whose work is domain logic the API owns.
 *
 * `worker-cron` (`backend/worker`) schedules every cron job, with leader election, into a BullMQ queue
 * named after the job. A queue is consumed by whichever process registers a handler for that name.
 * Jobs that change payments, orders or invitations are consumed HERE, in the API's jobs process
 * (`dist/jobs/main.js`), so they run through the same services, status machine and transaction
 * boundaries as a request — not through a second copy of those rules inside the worker package.
 *
 * `backend/worker` registers no handler for these names, so nothing consumes them twice.
 */
export type DomainJob = (app: INestApplicationContext) => Promise<unknown>;

export const DOMAIN_JOBS: Readonly<Record<string, DomainJob>> = {
  // docs/BACKEND/08: `order_expire_check`, every 15 minutes (P3-07).
  order_expire_check: (app) => app.get(OrderService).expireOverdueOrders(),
  // docs/BACKEND/08: `payment_reconciliation`, daily 03:00 WIB.
  payment_reconciliation: (app) => app.get(PaymentReconciliationService).run(),
};
