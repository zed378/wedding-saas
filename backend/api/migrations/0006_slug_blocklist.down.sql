-- Reverses 0006_slug_blocklist.sql.
--
-- Destroys the reserved-word list. Harmless in development; in production this would make
-- every reserved slug available, which is why migrations/README.md insists db:rollback is
-- a development tool and the production answer is roll-forward.

DROP TABLE IF EXISTS slug_blocklist;
