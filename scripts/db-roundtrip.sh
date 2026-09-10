#!/usr/bin/env bash
#
# up -> down -> up, asserting the database state at each step.
#
# P0-06 DoD: "the up/down/up round trip passes against a fresh database". CI is
# deferred (ADR-028), so this is a script a person runs rather than a pipeline step.
# Run it after writing any migration: an up that works with a down that does not is
# the normal way this breaks, and nothing else catches it.
#
# Needs a running database:
#   docker compose -f deploy/docker-compose.yml up -d postgres
#
# Override the connection if your host port is not 5432:
#   MIGRATION_DATABASE_URL=postgres://wedding_owner:wedding_owner_dev@localhost:55432/wedding \
#     scripts/db-roundtrip.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${MIGRATION_DATABASE_URL:=postgres://wedding_owner:wedding_owner_dev@localhost:5432/wedding}"
export MIGRATION_DATABASE_URL

API=backend/api
fails=0

# Query through the running container so this needs no local psql.
q() {
  docker compose -f deploy/docker-compose.yml exec -T postgres \
    psql -U wedding_owner -d wedding -tAc "$1" | tr -d '\r' | tr -d '[:space:]'
}

expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s (%s)\n' "$what" "$got"
  else
    printf '  FAIL  %s: expected %s, got %s\n' "$what" "$want" "$got"
    fails=$((fails + 1))
  fi
}

# Number of migrations Drizzle should think are applied, from the journal itself
# rather than a number typed here that would drift the moment one is added.
EXPECTED=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$API/migrations/meta/_journal.json','utf8')).entries.length)")

applied() {
  q "SELECT CASE WHEN to_regclass('drizzle.__drizzle_migrations') IS NULL THEN 0
                 ELSE (SELECT count(*) FROM drizzle.__drizzle_migrations) END;"
}
has_fn() { q "SELECT count(*) FROM pg_proc WHERE proname='set_updated_at';"; }

echo "round trip against $EXPECTED migration(s)"

# ---------------------------------------------------------------- up
echo
echo "== up"
(cd "$API" && node src/infra/db/migrate.mts >/dev/null)
expect "migrations applied" "$EXPECTED" "$(applied)"
expect "set_updated_at exists" "1" "$(has_fn)"

# ---------------------------------------------------------------- down, all of them
echo
echo "== down"
for _ in $(seq 1 "$EXPECTED"); do
  (cd "$API" && node src/infra/db/rollback.mts >/dev/null)
done
expect "migrations applied" "0" "$(applied)"
expect "set_updated_at gone" "0" "$(has_fn)"

# ---------------------------------------------------------------- up again
# The step that matters. A down which drops less than its up created leaves debris,
# and the second up fails on "already exists" -- which is exactly the failure this
# script exists to surface, on a laptop rather than during a release.
echo
echo "== up again"
(cd "$API" && node src/infra/db/migrate.mts >/dev/null)
expect "migrations applied" "$EXPECTED" "$(applied)"
expect "set_updated_at exists" "1" "$(has_fn)"

# ---------------------------------------------------------------- trigger behaviour
echo
echo "== set_updated_at behaviour"
docker compose -f deploy/docker-compose.yml exec -T postgres \
  psql -U wedding_owner -d wedding -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DROP TABLE IF EXISTS roundtrip_probe;
CREATE TABLE roundtrip_probe(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER roundtrip_probe_set_updated_at BEFORE UPDATE ON roundtrip_probe
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION set_updated_at();
INSERT INTO roundtrip_probe(name) VALUES ('a');
SQL

before=$(q "SELECT updated_at FROM roundtrip_probe;")
docker compose -f deploy/docker-compose.yml exec -T postgres \
  psql -U wedding_owner -d wedding -q -c "UPDATE roundtrip_probe SET name = name;" >/dev/null
expect "no-op update leaves updated_at alone" "$before" "$(q "SELECT updated_at FROM roundtrip_probe;")"

docker compose -f deploy/docker-compose.yml exec -T postgres \
  psql -U wedding_owner -d wedding -q -c "UPDATE roundtrip_probe SET name='b';" >/dev/null
expect "real change bumps updated_at" "t" \
  "$(q "SELECT (updated_at > created_at) FROM roundtrip_probe;")"

docker compose -f deploy/docker-compose.yml exec -T postgres \
  psql -U wedding_owner -d wedding -q -c "DROP TABLE roundtrip_probe;" >/dev/null

# ---------------------------------------------------------------- privilege split
# The application role must not be able to change the schema it queries. This is a
# precondition for row-level security, not a nicety: an owner connection bypasses
# every policy silently.
echo
echo "== role separation"
denied=$(docker compose -f deploy/docker-compose.yml exec -T postgres \
  psql -U wedding_app -d wedding -c "CREATE TABLE must_not_exist(id int);" 2>&1 | grep -c 'permission denied' || true)
expect "wedding_app cannot create tables" "1" "$denied"

# ---------------------------------------------------------------- verdict
echo
if [ "$fails" -eq 0 ]; then
  echo "round trip passed"
  exit 0
fi
echo "$fails assertion(s) failed"
exit 1
