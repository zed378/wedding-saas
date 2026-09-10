CREATE TABLE "invitation_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"type" varchar(10) NOT NULL,
	"provider_name" varchar(60) NOT NULL,
	"account_number" varchar(60) NOT NULL,
	"account_holder" varchar(150) NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation_custom_domains" (
	"invitation_id" uuid PRIMARY KEY NOT NULL,
	"domain" varchar(255) NOT NULL,
	"verification_status" varchar(20) DEFAULT 'pending_verification' NOT NULL,
	"ssl_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_custom_domains_domain_unique" UNIQUE("domain"),
	CONSTRAINT "invitation_custom_domains_verification_status_check" CHECK (verification_status IN ('pending_verification', 'verified', 'active', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "invitation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"title" varchar(150) NOT NULL,
	"event_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time,
	"venue_name" varchar(200) NOT NULL,
	"address" text NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"maps_url" varchar(500),
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_events_type_check" CHECK (type IN ('akad', 'reception', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "invitation_gallery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"caption" varchar(200),
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_cover" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation_guestbook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"guest_name" varchar(150) NOT NULL,
	"message" text NOT NULL,
	"status" varchar(15) DEFAULT 'approved' NOT NULL,
	"submitted_ip_hash" varchar(64),
	"moderated_by" uuid,
	"moderated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_guestbook_status_check" CHECK (status IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "invitation_guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"guest_name" varchar(150) NOT NULL,
	"attendance_status" varchar(15) NOT NULL,
	"guest_count" integer DEFAULT 1 NOT NULL,
	"message" text,
	"submitted_ip_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_guests_attendance_status_check" CHECK (attendance_status IN ('attending', 'not_attending', 'maybe')),
	CONSTRAINT "invitation_guests_guest_count_check" CHECK (guest_count BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "invitation_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"role" varchar(10) NOT NULL,
	"full_name" varchar(150) DEFAULT '' NOT NULL,
	"nickname" varchar(60) DEFAULT '' NOT NULL,
	"photo_media_id" uuid,
	"instagram" varchar(60),
	"father_name" varchar(150),
	"mother_name" varchar(150),
	"child_order" varchar(60),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_people_invitation_id_role_unique" UNIQUE("invitation_id","role"),
	CONSTRAINT "invitation_people_role_check" CHECK (role IN ('groom', 'bride'))
);
--> statement-breakpoint
CREATE TABLE "invitation_preview_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation_quote" (
	"invitation_id" uuid PRIMARY KEY NOT NULL,
	"text" text,
	"source" varchar(200),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation_settings" (
	"invitation_id" uuid PRIMARY KEY NOT NULL,
	"enabled_sections" varchar(40)[] DEFAULT '{}' NOT NULL,
	"theme_override" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rsvp_enabled" boolean DEFAULT true NOT NULL,
	"guestbook_enabled" boolean DEFAULT true NOT NULL,
	"guestbook_moderation" boolean DEFAULT false NOT NULL,
	"seo_indexable" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"from_status" varchar(20),
	"to_status" varchar(20) NOT NULL,
	"changed_by" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation_view_counts" (
	"invitation_id" uuid NOT NULL,
	"view_date" date NOT NULL,
	"view_count" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_view_counts_invitation_id_view_date_pk" PRIMARY KEY("invitation_id","view_date")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"internal_name" varchar(150),
	"template_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"slug" varchar(50),
	"published_at" timestamp with time zone,
	"expiry_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "invitations_status_check" CHECK (status IN ('draft', 'pending_payment', 'paid', 'published', 'expired', 'soft_deleted'))
);
--> statement-breakpoint
ALTER TABLE "invitation_bank_accounts" ADD CONSTRAINT "invitation_bank_accounts_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_custom_domains" ADD CONSTRAINT "invitation_custom_domains_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_events" ADD CONSTRAINT "invitation_events_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_gallery" ADD CONSTRAINT "invitation_gallery_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_gallery" ADD CONSTRAINT "invitation_gallery_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_guestbook" ADD CONSTRAINT "invitation_guestbook_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_guestbook" ADD CONSTRAINT "invitation_guestbook_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_guests" ADD CONSTRAINT "invitation_guests_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_people" ADD CONSTRAINT "invitation_people_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_people" ADD CONSTRAINT "invitation_people_photo_media_id_media_id_fk" FOREIGN KEY ("photo_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_preview_tokens" ADD CONSTRAINT "invitation_preview_tokens_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_preview_tokens" ADD CONSTRAINT "invitation_preview_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_quote" ADD CONSTRAINT "invitation_quote_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_settings" ADD CONSTRAINT "invitation_settings_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_status_history" ADD CONSTRAINT "invitation_status_history_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_status_history" ADD CONSTRAINT "invitation_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_view_counts" ADD CONSTRAINT "invitation_view_counts_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_template_version_id_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_events_invitation" ON "invitation_events" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "idx_gallery_invitation" ON "invitation_gallery" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "idx_guestbook_invitation" ON "invitation_guestbook" USING btree ("invitation_id","status");--> statement-breakpoint
CREATE INDEX "idx_guests_invitation" ON "invitation_guests" USING btree ("invitation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_preview_tokens_hash" ON "invitation_preview_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_preview_tokens_invitation" ON "invitation_preview_tokens" USING btree ("invitation_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_status_history_invitation" ON "invitation_status_history" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "idx_view_counts_invitation" ON "invitation_view_counts" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "idx_invitations_owner" ON "invitations" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_invitations_slug" ON "invitations" USING btree ("slug") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_invitations_status" ON "invitations" USING btree ("status");--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Appended by hand: drizzle-kit does not generate triggers.
--
-- Six of the thirteen tables carry updated_at. The other seven are append-only or
-- write-once-then-mark: status history, preview tokens, gallery rows, bank accounts,
-- RSVP submissions, guestbook entries and custom domains. For those, "when did this
-- row last change" has no meaning worth storing.
CREATE TRIGGER invitations_set_updated_at
  BEFORE UPDATE ON invitations
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER invitation_settings_set_updated_at
  BEFORE UPDATE ON invitation_settings
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER invitation_people_set_updated_at
  BEFORE UPDATE ON invitation_people
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER invitation_events_set_updated_at
  BEFORE UPDATE ON invitation_events
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER invitation_quote_set_updated_at
  BEFORE UPDATE ON invitation_quote
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- The view counter is upserted every minute by the flush job (P4-09). The WHEN clause
-- matters more here than anywhere: a flush that writes the same count again must not
-- move updated_at, or "last seen activity" becomes "last time the job ran".
CREATE TRIGGER invitation_view_counts_set_updated_at
  BEFORE UPDATE ON invitation_view_counts
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
