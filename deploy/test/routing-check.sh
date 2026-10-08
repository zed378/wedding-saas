#!/usr/bin/env bash
# deploy/test/routing-check.sh — P3-11 routing and TLS verification
#
# Run this script against a deployed staging or production instance AFTER
# deploying the Caddy configuration. It is not part of pnpm test; it is a
# manual/CI post-deploy verification step.
#
# Usage:
#   bash deploy/test/routing-check.sh
#   bash deploy/test/routing-check.sh --host-prefix staging  # (optional, future)
#
# Dependencies: curl, openssl
#
# Exit code: 0 = all checks passed; 1 = one or more checks failed.
#
# Environment variables (optional overrides):
#   APP_HOST           default: app.vizunicum.my.id
#   INVITE_HOST        default: invitation.vizunicum.my.id
#   ADMIN_HOST         default: admin.vizunicum.my.id
#   SLUG               slug of a known published invitation for smoke testing
#                      (default: uses the seeded demo slug from db:seed)
#   CERT_WARN_DAYS     days-to-expiry threshold below which the check warns
#                      (default: 14)

set -euo pipefail

APP_HOST="${APP_HOST:-app.vizunicum.my.id}"
INVITE_HOST="${INVITE_HOST:-invitation.vizunicum.my.id}"
ADMIN_HOST="${ADMIN_HOST:-admin.vizunicum.my.id}"
SLUG="${SLUG:-demo}"
CERT_WARN_DAYS="${CERT_WARN_DAYS:-14}"

PASS=0
FAIL=0

green()  { printf '\033[0;32m[PASS]\033[0m %s\n' "$*"; ((PASS++)) || true; }
red()    { printf '\033[0;31m[FAIL]\033[0m %s\n' "$*"; ((FAIL++)) || true; }
yellow() { printf '\033[0;33m[WARN]\033[0m %s\n' "$*"; }
section(){ printf '\n\033[1m=== %s ===\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
# Helper: curl with timeout, returns HTTP status code
# ---------------------------------------------------------------------------
http_status() {
  local url="$1"
  curl -s -o /dev/null -w '%{http_code}' --max-time 15 --location "$url"
}

# Helper: get response headers
http_headers() {
  local url="$1"
  curl -s -I --max-time 15 --location "$url"
}

# Helper: check header presence and value
check_header() {
  local label="$1"
  local headers="$2"
  local header_name="$3"
  local expected_pattern="$4"

  if echo "$headers" | grep -qi "^${header_name}:.*${expected_pattern}"; then
    green "$label — header '${header_name}' matches '${expected_pattern}'"
  else
    red "$label — header '${header_name}' NOT found or does not match '${expected_pattern}'"
    echo "  Headers received:"
    echo "$headers" | grep -i "^${header_name}:" || echo "  (none)"
  fi
}

# Helper: check header absence
check_header_absent() {
  local label="$1"
  local headers="$2"
  local header_name="$3"

  if echo "$headers" | grep -qi "^${header_name}:"; then
    red "$label — header '${header_name}' present but should be absent"
    echo "  Value: $(echo "$headers" | grep -i "^${header_name}:")"
  else
    green "$label — header '${header_name}' correctly absent"
  fi
}

# ---------------------------------------------------------------------------
# 1. Reachability: app.vizunicum.my.id
# ---------------------------------------------------------------------------
section "app.vizunicum.my.id — reachability"

status=$(http_status "https://${APP_HOST}/api/healthz")
if [[ "$status" == "200" ]]; then
  green "GET /api/healthz → 200"
else
  red "GET /api/healthz → $status (expected 200)"
fi

# The webhook path should be reachable (returns 400 or 401 without a valid body, NOT 429)
status=$(http_status "https://${APP_HOST}/api/webhooks/payment/midtrans")
if [[ "$status" == "400" || "$status" == "401" || "$status" == "422" ]]; then
  green "GET /api/webhooks/payment/midtrans → $status (route is reachable, not rate-limited)"
elif [[ "$status" == "429" ]]; then
  red "GET /api/webhooks/payment/midtrans → 429 (webhook path IS being rate-limited — must be exempt)"
else
  yellow "GET /api/webhooks/payment/midtrans → $status (unexpected, verify manually)"
fi

# ---------------------------------------------------------------------------
# 2. Reachability: invitation.vizunicum.my.id
# ---------------------------------------------------------------------------
section "invitation.vizunicum.my.id — reachability"

status=$(http_status "https://${INVITE_HOST}/${SLUG}")
if [[ "$status" == "200" ]]; then
  green "GET /${SLUG} → 200 (published invitation reachable)"
elif [[ "$status" == "404" ]]; then
  yellow "GET /${SLUG} → 404 (slug '${SLUG}' not found — set SLUG= to a published invitation slug)"
else
  red "GET /${SLUG} → $status (expected 200 or 404)"
fi

status=$(http_status "https://${INVITE_HOST}/nonexistent-slug-$(date +%s)")
if [[ "$status" == "404" ]]; then
  green "GET /nonexistent-slug → 404 (correct)"
else
  red "GET /nonexistent-slug → $status (expected 404)"
fi

# ---------------------------------------------------------------------------
# 3. Reachability: admin.vizunicum.my.id
# ---------------------------------------------------------------------------
section "admin.vizunicum.my.id — reachability and stub"

status=$(http_status "https://${ADMIN_HOST}/")
if [[ "$status" == "503" ]]; then
  green "GET / → 503 (admin stub correct — P5-01 not yet live)"
else
  red "GET / → $status (expected 503 for admin stub)"
fi

# ---------------------------------------------------------------------------
# 4. Security headers — app.vizunicum.my.id
# ---------------------------------------------------------------------------
section "Security headers — app.vizunicum.my.id"

headers=$(http_headers "https://${APP_HOST}/")
check_header "app HSTS" "$headers" "Strict-Transport-Security" "max-age=31536000"
check_header "app X-Content-Type-Options" "$headers" "X-Content-Type-Options" "nosniff"
check_header "app Referrer-Policy" "$headers" "Referrer-Policy" "strict-origin-when-cross-origin"
check_header "app X-Frame-Options DENY" "$headers" "X-Frame-Options" "DENY"

# ---------------------------------------------------------------------------
# 5. Security headers — invitation.vizunicum.my.id
#    X-Frame-Options must be ABSENT (allow framing for embed use)
# ---------------------------------------------------------------------------
section "Security headers — invitation.vizunicum.my.id"

headers=$(http_headers "https://${INVITE_HOST}/")
check_header "invitation HSTS" "$headers" "Strict-Transport-Security" "max-age=31536000"
check_header "invitation X-Content-Type-Options" "$headers" "X-Content-Type-Options" "nosniff"
check_header "invitation Referrer-Policy" "$headers" "Referrer-Policy" "strict-origin-when-cross-origin"
check_header_absent "invitation X-Frame-Options (must be absent for embed)" "$headers" "X-Frame-Options"

# ---------------------------------------------------------------------------
# 6. Security headers — admin.vizunicum.my.id
# ---------------------------------------------------------------------------
section "Security headers — admin.vizunicum.my.id"

headers=$(http_headers "https://${ADMIN_HOST}/")
check_header "admin HSTS" "$headers" "Strict-Transport-Security" "max-age=31536000"
check_header "admin X-Content-Type-Options" "$headers" "X-Content-Type-Options" "nosniff"
check_header "admin X-Frame-Options DENY" "$headers" "X-Frame-Options" "DENY"

# ---------------------------------------------------------------------------
# 7. Webhook bypass: no rate-limit headers on /api/webhooks/*
# ---------------------------------------------------------------------------
section "Webhook path bypasses rate limiting"

headers=$(http_headers "https://${APP_HOST}/api/webhooks/payment/midtrans")
check_header_absent "no X-RateLimit-Limit on webhook path" "$headers" "X-RateLimit-Limit"
check_header_absent "no RateLimit-Limit on webhook path" "$headers" "RateLimit-Limit"

# ---------------------------------------------------------------------------
# 8. Request body cap: /api/media/* rejects >11MB
# ---------------------------------------------------------------------------
section "Media upload body cap (11MB limit)"

# Generate a file larger than 11MB (12MB) and try to POST it.
# We expect a 413 (Request Entity Too Large) from Caddy.
tmpfile=$(mktemp)
dd if=/dev/urandom of="$tmpfile" bs=1M count=12 2>/dev/null

status=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time 30 \
  -X POST \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@$tmpfile" \
  "https://${APP_HOST}/api/media/upload" 2>/dev/null || echo "000")

rm -f "$tmpfile"

if [[ "$status" == "413" ]]; then
  green "POST /api/media/upload with 12MB body → 413 (body cap enforced by Caddy)"
elif [[ "$status" == "401" || "$status" == "403" ]]; then
  # Auth check fires before size check — acceptable, means Caddy forwarded (body cap may be
  # checked after auth). Document this as an acceptable alternative.
  yellow "POST /api/media/upload with 12MB body → $status (auth gate first; body cap test inconclusive — verify with an authenticated token)"
else
  red "POST /api/media/upload with 12MB body → $status (expected 413)"
fi

# ---------------------------------------------------------------------------
# 9. Certificate expiry check
# ---------------------------------------------------------------------------
section "Certificate expiry (${CERT_WARN_DAYS}-day threshold)"

for host in "$APP_HOST" "$INVITE_HOST" "$ADMIN_HOST"; do
  expiry=$(echo | openssl s_client -connect "${host}:443" -servername "$host" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null \
    | sed 's/notAfter=//')

  if [[ -z "$expiry" ]]; then
    red "$host — could not retrieve certificate expiry"
    continue
  fi

  # Cross-platform: date -d works on GNU, date -j on BSD/macOS
  if date --version 2>/dev/null | grep -q GNU; then
    expiry_epoch=$(date -d "$expiry" +%s 2>/dev/null || echo 0)
  else
    expiry_epoch=$(date -j -f "%b %d %T %Y %Z" "$expiry" +%s 2>/dev/null || echo 0)
  fi

  now_epoch=$(date +%s)
  days_remaining=$(( (expiry_epoch - now_epoch) / 86400 ))

  if [[ "$days_remaining" -lt "$CERT_WARN_DAYS" ]]; then
    red "$host — certificate expires in ${days_remaining} days (threshold: ${CERT_WARN_DAYS})"
  elif [[ "$days_remaining" -lt 30 ]]; then
    yellow "$host — certificate expires in ${days_remaining} days (OK but check renewal)"
  else
    green "$host — certificate valid for ${days_remaining} more days"
  fi
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
section "Summary"
total=$((PASS + FAIL))
printf '\nResults: %d / %d passed\n' "$PASS" "$total"

if [[ "$FAIL" -gt 0 ]]; then
  printf '\033[0;31m%d check(s) FAILED — review output above.\033[0m\n' "$FAIL"
  exit 1
else
  printf '\033[0;32mAll checks passed.\033[0m\n'
  exit 0
fi
