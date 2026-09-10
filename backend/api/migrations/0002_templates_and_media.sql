CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid,
	"uploaded_by" uuid,
	"purpose" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'processing' NOT NULL,
	"storage_path" varchar(500) NOT NULL,
	"mime_type" varchar(60),
	"width" integer,
	"height" integer,
	"size_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "media_status_check" CHECK (status IN ('processing', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "template_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_version_id" uuid NOT NULL,
	"asset_name" varchar(100) NOT NULL,
	"media_id" uuid,
	"purpose" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" varchar(20) NOT NULL,
	"sections" jsonb NOT NULL,
	"theme" jsonb NOT NULL,
	"customizable_theme_keys" varchar(60)[] DEFAULT '{}' NOT NULL,
	"changelog" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_versions_template_id_version_unique" UNIQUE("template_id","version"),
	CONSTRAINT "template_versions_status_check" CHECK (status IN ('draft', 'published', 'deprecated'))
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(100) NOT NULL,
	"category" varchar(40)[] DEFAULT '{}' NOT NULL,
	"is_premium" boolean DEFAULT false NOT NULL,
	"thumbnail_url" varchar(500),
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_slug_unique" UNIQUE("slug"),
	CONSTRAINT "templates_status_check" CHECK (status IN ('draft', 'published', 'deprecated'))
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_assets" ADD CONSTRAINT "template_assets_template_version_id_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_assets" ADD CONSTRAINT "template_assets_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_media_invitation" ON "media" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "idx_template_versions_template" ON "template_versions" USING btree ("template_id");--> statement-breakpoint
-- Appended by hand: drizzle-kit does not generate triggers.
--
-- Only `templates` carries updated_at among the four tables here. template_versions,
-- template_assets and media are written once and then only have their status or
-- deleted_at changed, so there is no updated_at column to maintain.
CREATE TRIGGER templates_set_updated_at
  BEFORE UPDATE ON templates
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
