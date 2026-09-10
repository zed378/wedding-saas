#!/usr/bin/env bash
#
# Everything that can be checked about the chart without a cluster.
#
# Nothing deploys this chart today (ADR-015 puts the MVP on a single VPS), which
# means nothing exercises it either — so it will drift silently and the first
# sign will be a failed deploy during the incident it was written for. This
# script is the cheap defence. Wire it into automation with `P0-23`.
#
# Usage: deploy/helm/verify.sh
set -euo pipefail

CHART="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/wedding-invitation"
TAG="0.0.0-verify"
fails=0

pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; fails=$((fails + 1)); }

echo "verifying $CHART"

# ---------------------------------------------------------------- lint
# The chart has a required value, so a bare `helm lint` fails by design. Give it
# what a real install gives it.
if helm lint "$CHART" --set image.tag="$TAG" --set workers.enabled=true >/dev/null 2>&1; then
  pass "helm lint"
else
  fail "helm lint"
  helm lint "$CHART" --set image.tag="$TAG" --set workers.enabled=true || true
fi

# ---------------------------------------------------------------- render
render=$(helm template wi "$CHART" --set image.tag="$TAG" --set workers.enabled=true 2>&1) || {
  fail "helm template"
  echo "$render"
  exit 1
}
pass "helm template renders"

deployments=$(printf '%s\n' "$render" | grep -c '^kind: Deployment' || true)
[ "$deployments" -eq 4 ] \
  && pass "4 Deployments (api + 3 worker pools)" \
  || fail "expected 4 Deployments, rendered $deployments"

# ---------------------------------------------------------------- posture
# docs/DEVOPS/02 § Container Security Principles. Counted against the rendered
# output rather than trusted from _helpers.tpl: a helper that is defined but not
# included on one workload reads correctly and ships wrong.
for key in 'runAsNonRoot: true' 'readOnlyRootFilesystem: true' \
           'seccompProfile' 'drop: \["ALL"\]' 'limits:'; do
  n=$(printf '%s\n' "$render" | grep -c "$key" || true)
  [ "$n" -eq "$deployments" ] \
    && pass "$key on every workload ($n)" \
    || fail "$key on $n of $deployments workloads"
done

# ---------------------------------------------------------------- no secrets
if printf '%s\n' "$render" | grep -qiE 'image: .*:latest|password:|secret_key|api_key'; then
  fail "a moving tag or a plaintext credential reached the render"
  printf '%s\n' "$render" | grep -inE 'image: .*:latest|password:|secret_key|api_key'
else
  pass "no moving tag, no plaintext credential"
fi

# ---------------------------------------------------------------- origins
# ADR-024, docs/SECURITY/02: the invitation host carries guest-submitted content
# and must not be same-origin with anything authenticated.
invite_paths=$(printf '%s\n' "$render" | awk '/host: "invitation/,/^        - host:|^  rules|^---/' | grep -c '  - path:' || true)
[ "$invite_paths" -eq 1 ] \
  && pass "invitation host exposes exactly 1 path (/public)" \
  || fail "invitation host exposes $invite_paths paths, expected 1"

# ---------------------------------------------------------------- guard rails
# Each of these is a configuration that works on the day it is applied and hurts
# later. They must fail the render, not a review.
if helm template wi "$CHART" >/dev/null 2>&1; then
  fail "a missing image.tag rendered (docs/DEVOPS/08 needs an immutable tag)"
else
  pass "refuses to render without image.tag"
fi

if helm template wi "$CHART" --set image.tag="$TAG" --set workers.enabled=true \
     --set workers.pools.cron.replicaCount=2 >/dev/null 2>&1; then
  fail "a second cron replica rendered (it would run every scheduled job twice)"
else
  pass "refuses to render a second cron replica"
fi

# ---------------------------------------------------------------- verdict
echo
if [ "$fails" -eq 0 ]; then
  echo "chart verified — $((deployments)) workloads, all guard rails firing"
  echo
  echo "NOT checked here: acceptance by a Kubernetes API server. \`kubectl apply"
  echo "--dry-run\` needs a live cluster even in client mode, so these manifests are"
  echo "known to render, not known to be accepted. That check belongs to P0-23."
  exit 0
fi
echo "$fails check(s) failed"
exit 1
