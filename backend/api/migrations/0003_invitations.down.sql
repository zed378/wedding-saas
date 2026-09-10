-- Reverses 0003_invitations.sql.
--
-- The media foreign key is dropped first and separately: it was added to a table this
-- migration does not own (ADR-032), so leaving it would make `invitations` undroppable
-- and the rollback would fail halfway.
--
-- Everything else is dropped children-first. The triggers go with their tables.

ALTER TABLE media DROP CONSTRAINT IF EXISTS media_invitation_id_invitations_id_fk;

DROP TABLE IF EXISTS invitation_view_counts;
DROP TABLE IF EXISTS invitation_guestbook;
DROP TABLE IF EXISTS invitation_guests;
DROP TABLE IF EXISTS invitation_quote;
DROP TABLE IF EXISTS invitation_bank_accounts;
DROP TABLE IF EXISTS invitation_gallery;
DROP TABLE IF EXISTS invitation_events;
DROP TABLE IF EXISTS invitation_people;
DROP TABLE IF EXISTS invitation_custom_domains;
DROP TABLE IF EXISTS invitation_preview_tokens;
DROP TABLE IF EXISTS invitation_status_history;
DROP TABLE IF EXISTS invitation_settings;
DROP TABLE IF EXISTS invitations;
