import type { INestApplicationContext } from "@nestjs/common";

import { InvoiceService } from "../modules/order/invoice/invoice.service";
import { OrderService } from "../modules/order/order.service";
import { PaymentReconciliationService } from "../modules/payment/payment-reconciliation.service";
import { InvitationExpiryService } from "../modules/publishing/invitation-expiry.service";
import { InvitationReminderService } from "../modules/publishing/invitation-reminder.service";
import { InvitationRetentionService } from "../modules/invitation/invitation-retention.service";
import { RsvpDigestService } from "../modules/rsvp/rsvp-digest.service";
import { AnalyticsService } from "../modules/analytics/analytics.service";

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
export type DomainJob = (
  app: INestApplicationContext,
  data: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

export const DOMAIN_JOBS: Readonly<Record<string, DomainJob>> = {
  // docs/BACKEND/08: `order_expire_check`, every 15 minutes (P3-07).
  // P3-08: queued by the payment webhook after it commits a paid order.
  "invoice.generate": (app, data) => {
    const orderId = data["orderId"];
    if (typeof orderId !== "string") {
      throw new Error("invoice.generate needs an orderId");
    }
    return app.get(InvoiceService).generate(orderId);
  },
  order_expire_check: (app) => app.get(OrderService).expireOverdueOrders(),
  // docs/BACKEND/08: `payment_reconciliation`, daily 03:00 WIB.
  payment_reconciliation: (app) => app.get(PaymentReconciliationService).run(),
  // docs/BACKEND/08: `invitation_expiry_check`, daily 00:05 WIB (P3-13).
  invitation_expiry_check: (app) =>
    app.get(InvitationExpiryService).expireOverdueInvitations(),
  // docs/BACKEND/08: `invitation_soft_delete_cleanup`, daily 01:00 WIB (P3-13, BR-9.1).
  invitation_soft_delete_cleanup: (app) =>
    app.get(InvitationRetentionService).sweep(),
  // docs/BACKEND/08: `reminder_email_h7_h1`, daily 08:00 WIB (P4-07).
  reminder_email_h7_h1: (app) =>
    app.get(InvitationReminderService).sendExpiryReminders(),
  // docs/PLAN/13: `rsvp_daily_digest`, daily 09:00 WIB (P4-08).
  rsvp_daily_digest: (app) => app.get(RsvpDigestService).sendDailyDigests(),
  // docs/ARCHITECTURE/07, docs/PLAN/13: `analytics_counter_flush`, every 1 minute (P4-09).
  analytics_counter_flush: (app) =>
    app.get(AnalyticsService).flushViewCounts(),
};
