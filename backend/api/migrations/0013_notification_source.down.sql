-- Reverses 0013_notification_source.sql. Development only.

ALTER TABLE "payment_notifications" DROP CONSTRAINT "payment_notifications_source_check";--> statement-breakpoint
ALTER TABLE "payment_notifications" DROP COLUMN "source";
