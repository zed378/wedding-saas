-- P3-05 -- ADR-077. Every payment notification received, genuine or forged.
--
-- docs/DATABASE/08 keeps forged callbacks for investigation through `signature_valid`. A forged
-- callback has no payment of its own, and writing its claim onto the real payment it names would let
-- a forger overwrite a genuine record. So each arrival is a row here; `payments.signature_valid` is set
-- only from a verified notification.
--
-- Append-mostly, enforced by permission rather than convention: the application role keeps INSERT and
-- SELECT (default privileges, deploy/postgres/init/01-app-role.sql), may UPDATE only the four columns
-- processing fills in, and may not DELETE. A fraud investigation must be able to trust that nothing
-- the application did removed or rewrote what arrived.

CREATE TABLE "payment_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(30) NOT NULL,
	"claimed_reference" varchar(150),
	"payment_id" uuid,
	"signature_valid" boolean NOT NULL,
	"rejection_reason" varchar(30),
	"outcome" varchar(20),
	"provider_status" varchar(40),
	"amount" bigint,
	"result" varchar(40),
	"needs_review" boolean DEFAULT false NOT NULL,
	"raw_payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payment_notifications" ADD CONSTRAINT "payment_notifications_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payment_notifications_reference" ON "payment_notifications" USING btree ("provider","claimed_reference");--> statement-breakpoint
CREATE INDEX "idx_payment_notifications_received" ON "payment_notifications" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "idx_payment_notifications_review" ON "payment_notifications" USING btree ("received_at") WHERE needs_review;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wedding_app') THEN
    REVOKE UPDATE, DELETE ON payment_notifications FROM wedding_app;
    GRANT UPDATE (payment_id, result, needs_review, processed_at) ON payment_notifications TO wedding_app;
    RAISE NOTICE 'payment_notifications: DELETE revoked, UPDATE limited to processing columns for wedding_app';
  ELSE
    RAISE NOTICE 'payment_notifications: role wedding_app not found; append-only NOT enforced. Revoke DELETE and column-restrict UPDATE manually (docs/DATABASE/08).';
  END IF;
END $$;
