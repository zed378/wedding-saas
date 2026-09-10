CREATE TABLE "addons" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"name" varchar(60) NOT NULL,
	"price" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" varchar(60) NOT NULL,
	"resource_type" varchar(40) NOT NULL,
	"resource_id" uuid NOT NULL,
	"reason" text,
	"before_state" jsonb,
	"after_state" jsonb,
	"ip_address" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"package_id" varchar(30) NOT NULL,
	"addon_ids" varchar(30)[] DEFAULT '{}' NOT NULL,
	"amount_total" bigint NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"order_type" varchar(20) DEFAULT 'new_publish' NOT NULL,
	"expired_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_status_check" CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'refunded')),
	CONSTRAINT "orders_order_type_check" CHECK (order_type IN ('new_publish', 'renewal'))
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"name" varchar(60) NOT NULL,
	"price" bigint NOT NULL,
	"duration_months" integer NOT NULL,
	"max_photos" integer NOT NULL,
	"has_watermark" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" varchar(30) NOT NULL,
	"provider_reference_id" varchar(150) NOT NULL,
	"method" varchar(30),
	"amount" bigint NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"raw_callback_payload" jsonb,
	"signature_valid" boolean,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_status_check" CHECK (status IN ('pending', 'success', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_admin" ON "audit_logs" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "idx_audit_resource" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_orders_invitation" ON "orders" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "idx_orders_user" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_orders_status" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payments_provider_ref" ON "payments" USING btree ("provider","provider_reference_id");--> statement-breakpoint
CREATE INDEX "idx_payments_order" ON "payments" USING btree ("order_id");--> statement-breakpoint
-- Appended by hand: drizzle-kit generates neither triggers nor grants.

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER payments_set_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- audit_logs is append-only, enforced by permission rather than by convention.
--
-- docs/DATABASE/10 § Policy asks for this "at the DB user permission level where
-- possible". It is possible: this migration runs as the owner, and the application
-- connects as a different, unprivileged role (P0-06). An audit trail the application
-- can rewrite is not an audit trail -- the one actor you most need it to constrain is
-- the code an attacker would be running.
--
-- Guarded on the role existing, so a deployment whose application role is named
-- differently does not fail the migration. It RAISES A NOTICE rather than passing
-- silently, because a skipped revoke means the guarantee is simply absent and nothing
-- else would say so.
--
-- Note there is no explicit GRANT of SELECT/INSERT here: the role receives those from
-- ALTER DEFAULT PRIVILEGES in deploy/postgres/init/01-app-role.sql, which applies to
-- tables this migration creates. The REVOKE then takes two of the four back.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wedding_app') THEN
    REVOKE UPDATE, DELETE ON audit_logs FROM wedding_app;
    RAISE NOTICE 'audit_logs: UPDATE and DELETE revoked from wedding_app (append-only)';
  ELSE
    RAISE NOTICE 'audit_logs: role wedding_app not found; append-only NOT enforced. Revoke UPDATE and DELETE from the application role manually (docs/DATABASE/10).';
  END IF;
END $$;
