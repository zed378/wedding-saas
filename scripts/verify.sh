#!/usr/bin/env bash
#
# What CI would have run, run locally instead.
#
# GitHub Actions is deferred (ADR-028, P0-17), so nothing runs on a pull request
# and nothing runs on a merge. Every gate that would have lived in the pipeline
# lives here, and the only thing that invokes it is a person or the pre-push
# hook. That is strictly weaker than CI — see the note at the end — but it is the
# difference between "checked" and "hoped".
#
# Usage:
#   scripts/verify.sh          full run
#   scripts/verify.sh --fast   skip the slow steps (what pre-push runs)
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

FAST=0
[ "${1:-}" = "--fast" ] && FAST=1

failed=()

step() {
  local name="$1"; shift
  printf '\n\033[1m== %s\033[0m\n' "$name"
  if "$@"; then
    printf '   ok\n'
  else
    printf '   FAILED\n'
    failed+=("$name")
  fi
}

# ---------------------------------------------------------------------------
# The security gate first, and it runs even in fast mode.
#
# docs/SECURITY/05 is the project's highest-priority document and sets zero
# tolerance for cross-tenant leaks. This is the one check that must not be
# skipped for speed, because the failure it catches is silent: an endpoint that
# works perfectly for its owner and also works for everybody else.
# ---------------------------------------------------------------------------
step ":id endpoints have tests" node scripts/check-id-endpoint-tests.mjs

# The other half of docs/SECURITY/05: the gate above insists on a test for every :id
# endpoint, this one insists the query goes through the tenant-scoped repository at all.
# A handler that imports the table directly can be perfectly tested and still unscoped.
step "tenant-scoped data access" node scripts/check-tenant-scope.mjs

# docs/DATABASE/04: every status transition writes a history row, at the service layer.
# One direct update in a hotfix and there is an invitation whose journey nobody can
# reconstruct -- and the diff will look like two lines of obvious code.
step "status changes go through the writer" node scripts/check-status-writes.mjs

# ---------------------------------------------------------------------------
# Migration gates (P0-06). Both are file checks, so they need no database and
# belong here rather than in scripts/db-roundtrip.sh, which does.
# ---------------------------------------------------------------------------
step "migrations have down files" node scripts/check-migration-pairs.mjs
step "destructive migrations justified" node scripts/check-destructive-migration.mjs

step "format" pnpm -w run format:check
step "lint" pnpm -w run lint
step "typecheck" pnpm -w run typecheck
step "test" pnpm -w run test

if [ -f deploy/helm/verify.sh ]; then
  step "helm chart" bash deploy/helm/verify.sh
fi

if [ "$FAST" -eq 0 ]; then
  # Slow steps: skipped by pre-push, required before a merge to main.
  step "build" pnpm -w run build
fi

# ---------------------------------------------------------------------------
printf '\n'
if [ ${#failed[@]} -eq 0 ]; then
  if [ "$FAST" -eq 1 ]; then
    printf 'fast checks passed. Run scripts/verify.sh in full before merging to main.\n'
  else
    printf 'all checks passed.\n'
  fi
  printf '\n'
  printf 'Not covered here, and not covered anywhere until P0-17 ships a pipeline:\n'
  printf '  - integration tests against real Postgres and Redis (P0-19)\n'
  printf '  - service-layer coverage gate, 80%% (docs/BACKEND/09)\n'
  printf '  - SAST and dependency CVE scanning (docs/SECURITY/11)\n'
  printf '  - required reviewer approval before merge (docs/DEVOPS/01)\n'
  printf 'and none of this runs on a clean checkout, or at all if someone passes\n'
  printf -- '--no-verify. A local hook is a reminder with teeth, not a gate.\n'
  exit 0
fi

printf '\033[1m%d check(s) failed:\033[0m\n' "${#failed[@]}"
for f in "${failed[@]}"; do printf '  - %s\n' "$f"; done
exit 1
