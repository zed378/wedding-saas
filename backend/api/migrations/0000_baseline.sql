-- Baseline. No tables: this migration creates only what every later table depends on.
--
-- P0-06. Tables arrive in P0-07 (users and auth), P0-08 (templates, versions, media),
-- P0-09 (invitations and children) and P0-10 (orders, payments, audit logs).

-- ---------------------------------------------------------------------------
-- No CREATE EXTENSION, deliberately.
--
-- The P0-06 task card expected pgcrypto, on the reasoning that every table in
-- docs/DATABASE/ defaults its primary key to gen_random_uuid(). That was true of
-- PostgreSQL 12 and earlier. Since 13 the function is in core, and this project runs
-- 16 -- verified on the actual image: `SELECT gen_random_uuid()` succeeds on
-- postgres:16-alpine with pg_extension holding nothing but plpgsql.
--
-- Not creating it is the better outcome rather than merely an equivalent one.
-- CREATE EXTENSION requires superuser, and deploy/postgres/init/01-app-role.sql
-- exists precisely so that the roles touching this database are as unprivileged as
-- the work allows. An unnecessary superuser step in the migration path is a
-- privilege the migration role would have to keep.
--
-- If a later migration genuinely needs pgcrypto -- crypt(), digest() -- it must add
-- it in its own file and say why. Password hashing is argon2 in the application
-- (ADR-011, docs/SECURITY/03), so it will not be that.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- updated_at maintenance.
--
-- Almost every table in docs/DATABASE/ carries `updated_at TIMESTAMPTZ NOT NULL
-- DEFAULT NOW()`. A default only fires on INSERT, so without this the column records
-- creation time forever and quietly lies on every row that has ever been edited.
--
-- In the database rather than the application, because the guarantee has to hold for
-- writes that do not go through the service layer: a migration backfill, a data fix
-- run by hand during an incident, an admin correction. An application-side hook is
-- correct only while every writer remembers, which is not a property you can verify.
--
-- The trigger itself is attached per table by the migration that creates the table.
-- This function is only the shared implementation.
--
-- WHEN (OLD.* IS DISTINCT FROM NEW.*) belongs on the trigger, not here, so that an
-- UPDATE which changes nothing does not bump the timestamp -- see the README.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_updated_at() IS
  'Sets NEW.updated_at to NOW(). Attach per table: CREATE TRIGGER <table>_set_updated_at '
  'BEFORE UPDATE ON <table> FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) '
  'EXECUTE FUNCTION set_updated_at(); See backend/api/migrations/README.md.';
