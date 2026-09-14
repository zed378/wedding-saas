-- Reverses 0011_payment_checkout.sql. Development only; production rolls forward.

ALTER TABLE "payments" DROP COLUMN "checkout_token";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "checkout_url";
