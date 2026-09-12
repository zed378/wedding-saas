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

# docs/ARCHITECTURE/05: the storage path carries invitation_id for isolation and audit,
# so path construction is a tenant control. @wi/storage's branded StorageKey enforces it
# at compile time; this catches the cast that would bypass it in one word.
step "storage paths built by the port" node scripts/check-storage-paths.mjs

# docs/FRONTEND/02: the access token lives in memory and nowhere else. A token in
# localStorage turns every XSS from a session-length problem into a permanent one.
step "no auth token in browser storage" node scripts/check-token-storage.mjs

# docs/UI-UX/06: the tokens are the single source of truth for application UI, and
# docs/UI-UX/08's dark mode depends on it. One literal is one thing that will not change
# when the theme does.
step "design tokens, not literals" node scripts/check-design-tokens.mjs
step "sources are plain text" node scripts/check-text-sources.mjs
step "no hard-coded section or field" node scripts/check-no-hardcoded-fields.mjs
step "every request text field is sanitized or exempt" node scripts/check-sanitized-fields.mjs

# docs/DATABASE/03: sections and theme are validated in application code before the
# write, because the columns are JSONB and Postgres will accept any well-formed JSON --
# including a component no renderer provides.
step "template definitions validated before write" node scripts/check-template-version-writes.mjs

# docs/DEVOPS/06: redaction happens at the logger, not at the call site. A logger built
# straight from pino() writes secrets in clear text and looks identical in every other
# respect -- the worker shipped exactly that for four tasks (P0-15).
step "loggers built by @wi/logging" node scripts/check-logger-construction.mjs

# Secret scanning over the whole tree. The pre-commit hook scans the staged diff, which
# is where a leak is stopped; this is the sweep that catches one already in the working
# tree -- a debug script that kept a token, a value pasted into .env.example.
step "no committed credentials" node scripts/check-secrets.mjs --all

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
