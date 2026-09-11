#!/bin/bash
# Runs once, on first initialisation of the data volume.
#
# The application connects as a role that is NOT the owner of its own tables and has
# neither SUPERUSER nor BYPASSRLS. That is a precondition rather than a nicety: the
# moment row-level policies are added, a superuser or table-owner connection would
# silently bypass every one of them, and no test would fail.
#
# The schema itself is created by migrations (P0-06), never by this file.
#
# A SHELL script rather than plain SQL (P0-23) so the password can come from the
# environment. It was a literal, which is correct for a laptop and wrong for a deployed
# host -- and a file in the repository containing a real staging password is exactly what
# `scripts/check-secrets.mjs` exists to refuse.
#
# The default keeps the development stack working with no .env at all, which is the
# property that makes `docker compose up` a single command there.
set -euo pipefail

APP_DB_PASSWORD="${APP_DB_PASSWORD:-wedding_app_dev}"

# Passed as a psql variable and quoted with `:'...'`, never interpolated into the SQL
# text by the shell. A password containing a quote would otherwise end the string and
# change the statement.
psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" \
     -v app_password="$APP_DB_PASSWORD" \
     -v dbname="$POSTGRES_DB" <<'EOSQL'
CREATE ROLE wedding_app WITH LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT CONNECT ON DATABASE :"dbname" TO wedding_app;
GRANT USAGE ON SCHEMA public TO wedding_app;

-- Objects created later by the migration role are granted to the application role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wedding_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO wedding_app;
EOSQL
