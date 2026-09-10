CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_mfa_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(20) DEFAULT 'totp' NOT NULL,
	"secret_encrypted" "bytea" NOT NULL,
	"label" varchar(60),
	"confirmed_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_mfa_factors_type_check" CHECK (type IN ('totp'))
);
--> statement-breakpoint
CREATE TABLE "user_notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"rsvp_email" boolean DEFAULT true NOT NULL,
	"guestbook_email" boolean DEFAULT true NOT NULL,
	"marketing_email" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" varchar(255) NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_tokens_type_check" CHECK (type IN ('email_verification', 'password_reset'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255),
	"full_name" varchar(100) NOT NULL,
	"phone" varchar(20),
	"role" varchar(20) DEFAULT 'user' NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"oauth_provider" varchar(20),
	"oauth_subject_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_role_check" CHECK (role IN ('user', 'admin', 'super_admin')),
	CONSTRAINT "users_status_check" CHECK (status IN ('active', 'suspended'))
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mfa_factors" ADD CONSTRAINT "user_mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_recovery_codes" ADD CONSTRAINT "user_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mfa_user_type" ON "user_mfa_factors" USING btree ("user_id","type") WHERE confirmed_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_recovery_codes_user" ON "user_recovery_codes" USING btree ("user_id") WHERE used_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_tokens_hash" ON "user_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_user_tokens_user_type" ON "user_tokens" USING btree ("user_id","type") WHERE used_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email" ON "users" USING btree ("email") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_users_oauth" ON "users" USING btree ("oauth_provider","oauth_subject_id") WHERE oauth_provider IS NOT NULL;--> statement-breakpoint
-- Appended by hand: drizzle-kit does not generate triggers.
--
-- Both tables here carry updated_at. Without these the column keeps its INSERT default
-- forever and reports creation time on every row that has ever been edited -- see
-- migrations/README.md and 0000_baseline.sql.
--
-- WHEN (OLD.* IS DISTINCT FROM NEW.*) so that an UPDATE which changes nothing does not
-- bump the timestamp. The other auth tables have no updated_at by design: a refresh
-- token, a single-use token and a recovery code are written once and then only marked
-- spent, so "when did this row last change" has no meaning worth storing.
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER user_notification_preferences_set_updated_at
  BEFORE UPDATE ON user_notification_preferences
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
