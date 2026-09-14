-- P3-04 -- ADR-076. Where a payment attempt is paid.
--
-- A second click, a refresh or a second tab on checkout reopens the pending payment's page instead
-- of creating another provider transaction. Each extra transaction would be a live payment page for
-- the same order, and a customer who pays on two of them pays twice.
--
-- Expand-only: two nullable columns. Existing rows have no checkout to reuse and are never reused.

ALTER TABLE "payments" ADD COLUMN "checkout_url" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "checkout_token" varchar(255);
