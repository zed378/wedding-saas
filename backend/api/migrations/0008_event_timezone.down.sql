-- Reverses 0008_event_timezone.sql.
--
-- Every event is read as WIB again, including the ones a couple set to WITA or WIT.
-- Development only; the production answer is roll-forward (migrations/README.md).

ALTER TABLE "invitation_events" DROP CONSTRAINT "invitation_events_timezone_check";--> statement-breakpoint
ALTER TABLE "invitation_events" DROP COLUMN "timezone";
