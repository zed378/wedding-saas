-- Runs once, on first initialisation of the data volume.
--
-- The application connects as a role that is NOT the owner of its own tables and has
-- neither SUPERUSER nor BYPASSRLS. That is a precondition rather than a nicety: the
-- moment row-level policies are added, a superuser or table-owner connection would
-- silently bypass every one of them, and no test would fail.
--
-- The schema itself is created by migrations (P0-06), never by this file.

CREATE ROLE wedding_app WITH LOGIN PASSWORD 'wedding_app_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT CONNECT ON DATABASE wedding TO wedding_app;
GRANT USAGE ON SCHEMA public TO wedding_app;

-- Objects created later by the migration role are granted to the application role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wedding_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO wedding_app;
