-- P3-08 -- ADR-079. One invoice per paid order, stored as the PDF that was issued.
--
-- Immutable by permission: the application role keeps INSERT and SELECT from its default privileges
-- and loses UPDATE and DELETE. An invoice is forwarded to other people; a re-rendered document that
-- differed from the one already sent is a correctness problem, not a formatting one.
--
-- Expand-only: a new table.

CREATE TABLE "invoices" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"number" varchar(40) NOT NULL,
	"pdf" bytea NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wedding_app') THEN
    REVOKE UPDATE, DELETE ON invoices FROM wedding_app;
    RAISE NOTICE 'invoices: UPDATE and DELETE revoked from wedding_app (immutable)';
  ELSE
    RAISE NOTICE 'invoices: role wedding_app not found; immutability NOT enforced. Revoke UPDATE and DELETE manually (docs/DATABASE/07).';
  END IF;
END $$;
