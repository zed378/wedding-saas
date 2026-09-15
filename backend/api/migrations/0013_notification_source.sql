-- P3-06 -- ADR-078. Where a verified payment event came from.
--
-- The webhook (P3-05), a server-initiated status query from the polling endpoint, and the daily
-- reconciliation all apply events through one transition path. The log says which, so an
-- investigation can tell a delivered notification from one the system had to go and ask for.
--
-- Expand-only: existing rows are webhooks, which the default states.

ALTER TABLE "payment_notifications" ADD COLUMN "source" varchar(15) DEFAULT 'webhook' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_notifications" ADD CONSTRAINT "payment_notifications_source_check" CHECK (source IN ('webhook', 'query', 'reconciliation'));
