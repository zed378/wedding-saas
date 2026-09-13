-- P2-16 -- ADR-070. `invitation_events.timezone`.
--
-- The zone an event happens in: 'Asia/Jakarta' (WIB), 'Asia/Makassar' (WITA) or
-- 'Asia/Jayapura' (WIT). `start_time` and `end_time` are local times in it. Answers OQ-27's
-- timezone half: the editor fills it from the event's map pin and the couple can change it.
--
-- Expand-only. Existing rows default to 'Asia/Jakarta', which is exactly how they were read
-- before this column existed, so no rendered time moves. They are NOT re-detected from their
-- coordinates here: the detection rule lives in application code (@wi/schema), and a couple
-- whose event is outside WIB corrects it in the editor, where the pin now fills it.

ALTER TABLE "invitation_events" ADD COLUMN "timezone" varchar(40) DEFAULT 'Asia/Jakarta' NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation_events" ADD CONSTRAINT "invitation_events_timezone_check" CHECK (timezone IN ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'));