-- Reverses 0000_baseline.sql.
--
-- Safe to run: the baseline creates no tables and holds no data, so nothing is lost.
-- That is unusual. Most down migrations in this repository will not be lossless, and
-- migrations/README.md explains what to write when reversing one would destroy data.

DROP FUNCTION IF EXISTS set_updated_at();
