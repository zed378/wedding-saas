-- P2-17 -- Indonesia's administrative regions. MEMORY/specs/P2-17-regions.md.
--
-- `regions`: every province, regency/city, district and village, by Kemendagri code (Kepmendagri
-- No. 300.2.2-2138 Tahun 2025, via cahyadsn/wilayah, MIT). `region_boundaries`: simplified
-- boundaries for provinces and regencies. `invitation_events.region_code`: the region a couple chose
-- for an event.
--
-- Tables only. The rows are loaded by `db:seed` (seed-data/regions/), because schema and content
-- are separate concerns (docs/DATABASE/00) and 91,599 rows do not belong in a migration file.
--
-- Read-only for the application role. The default privileges (deploy/postgres/init/01-app-role.sh)
-- grant every table full DML; reference data that no request may change gets SELECT alone, so a
-- bug or an injection in the API cannot rewrite the map of Indonesia.

CREATE TABLE "region_boundaries" (
	"code" varchar(13) PRIMARY KEY NOT NULL,
	"min_latitude" numeric(9, 6) NOT NULL,
	"max_latitude" numeric(9, 6) NOT NULL,
	"min_longitude" numeric(9, 6) NOT NULL,
	"max_longitude" numeric(9, 6) NOT NULL,
	"rings" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"code" varchar(13) PRIMARY KEY NOT NULL,
	"parent_code" varchar(13),
	"level" smallint NOT NULL,
	"kind" varchar(10) NOT NULL,
	"name" varchar(100) NOT NULL,
	"capital" varchar(100),
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"timezone" varchar(40),
	CONSTRAINT "regions_level_check" CHECK (level BETWEEN 1 AND 4),
	CONSTRAINT "regions_kind_check" CHECK (kind IN ('provinsi', 'kabupaten', 'kota', 'kecamatan', 'kelurahan', 'desa')),
	CONSTRAINT "regions_timezone_check" CHECK (timezone IS NULL OR timezone IN ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'))
);
--> statement-breakpoint
ALTER TABLE "invitation_events" ADD COLUMN "region_code" varchar(13);--> statement-breakpoint
ALTER TABLE "region_boundaries" ADD CONSTRAINT "region_boundaries_code_regions_code_fk" FOREIGN KEY ("code") REFERENCES "public"."regions"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_parent_code_regions_code_fk" FOREIGN KEY ("parent_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_regions_parent" ON "regions" USING btree ("parent_code");--> statement-breakpoint
ALTER TABLE "invitation_events" ADD CONSTRAINT "invitation_events_region_code_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "public"."regions"("code") ON DELETE set null ON UPDATE no action;;--> statement-breakpoint
GRANT SELECT ON "regions", "region_boundaries" TO wedding_app;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "regions", "region_boundaries" FROM wedding_app;
