-- Reverses 0002_templates_and_media.sql.
--
-- Children before parents, or the foreign keys refuse. template_assets references both
-- template_versions and media, so it goes first.
--
-- P0-09 adds media.invitation_id's foreign key with ALTER TABLE (ADR-032). Dropping
-- `media` here removes that constraint with it, which is correct: rolling back past
-- this migration means invitations cannot exist either.

DROP TABLE IF EXISTS template_assets;
DROP TABLE IF EXISTS media;
DROP TABLE IF EXISTS template_versions;
DROP TABLE IF EXISTS templates;
