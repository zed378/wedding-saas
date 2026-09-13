-- Reverses 0009_regions.sql.
--
-- Drops the region reference data and every event's chosen region. Events keep their address text
-- and timezone. Development only; the production answer is roll-forward (migrations/README.md).

ALTER TABLE "invitation_events" DROP CONSTRAINT "invitation_events_region_code_regions_code_fk";--> statement-breakpoint
ALTER TABLE "invitation_events" DROP COLUMN "region_code";--> statement-breakpoint
DROP TABLE "region_boundaries";--> statement-breakpoint
DROP TABLE "regions";
