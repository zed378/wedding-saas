-- Reverses 0007_section_memory.sql.
--
-- Forgets every couple's section choices for templates they are not currently on. The next
-- switch back to such a template applies its defaults instead. Development only; the
-- production answer is roll-forward (migrations/README.md).

ALTER TABLE "invitation_settings" DROP COLUMN "section_memory";
