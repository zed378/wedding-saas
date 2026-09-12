-- P1-09 -- `docs/DATABASE/12-PLATFORM-CONFIG.md`, column for column.
--
-- Backs the reserved-word and profanity blocklist that `docs/SECURITY/10` § Slug Blocklist
-- and `docs/PLAN/10` § Subdomain require. SECURITY/10 asks for a list "managed by admins,
-- updatable without a deploy", which is what makes it a table rather than a constant.
--
-- The admin CRUD is Phase 5 (`P5-13`). The table arrives here because `P1-09` validates
-- every slug against it, and a validation that reads an empty table is a validation that
-- passes everything.
--
-- Seeding is separate, per DATABASE/00's convention that schema and content are different
-- concerns -- see `src/infra/db/seed-data/slug-blocklist.json`.

CREATE TABLE "slug_blocklist" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "term" varchar(60) NOT NULL,
  "match_type" varchar(20) DEFAULT 'exact' NOT NULL,
  "category" varchar(30) DEFAULT 'reserved' NOT NULL,
  "reason" text,
  -- NULL for seeded system entries: nobody typed them, so attributing them to a person
  -- would be a lie an auditor would later have to untangle.
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "slug_blocklist_match_type_check" CHECK (match_type IN ('exact','substring')),
  CONSTRAINT "slug_blocklist_category_check" CHECK (category IN ('reserved','profanity','brand','other'))
);--> statement-breakpoint
ALTER TABLE "slug_blocklist" ADD CONSTRAINT "slug_blocklist_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- On `lower(term)`, so `Admin` and `admin` cannot both be added and disagree.
CREATE UNIQUE INDEX "idx_slug_blocklist_term" ON "slug_blocklist" USING btree (lower("term"),"match_type");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "slug_blocklist" TO wedding_app;
