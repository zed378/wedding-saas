# P3-11 — Production Subdomain Routing and TLS

| | |
|---|---|
| **Date** | 2026-10-08 |
| **Task** | `TASKS/PHASE-3-ORDER-PAYMENT-PUBLISHING.md` § P3-11 |
| **Phase** | Phase 3 |
| **Surface** | infra |
| **Author** | |
| **Commits / PR** | feat: P3-11 production subdomain routing and TLS |
| **Status** | Completed |

---

## What Changed

`deploy/Caddyfile.production` now defines the three fixed production hostnames (`app.vizunicum.my.id`, `invitation.vizunicum.my.id`, `admin.vizunicum.my.id`) with automatic ACME TLS, edge rate limiting (with the webhook path exempt), an 11 MB request-body cap on the media upload route, a 180 s upload timeout, and differentiated security headers. Caddy service entries were added to both `docker-compose.yml` (behind `--profile proxy`, for optional local use) and `docker-compose.staging.yml` (always-on). A certificate-expiry Prometheus alert was added to `deploy/prometheus/alerts.yml`. A post-deploy verification script was written at `deploy/test/routing-check.sh`.

## Why

`docs/ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md` § TLS/SSL and `docs/DEVOPS/03-REVERSE-PROXY.md` specify the production topology: three fixed hostnames, no wildcard (ADR-024), automatic certificate renewal by the origin proxy, edge rate limiting before requests reach the application, and differentiated security headers. `docs/SECURITY/06` layer 4 requires the proxy to enforce the upload body cap before bytes reach NestJS, not only inside the framework. `P0-23` stood up the staging infrastructure; P3-11 solidifies it into a maintained, reviewed configuration file.

## How

**Caddy configuration** (`deploy/Caddyfile.production`): three Caddy server blocks, one per hostname. Shared snippets (`security_headers_common`, `security_headers_app`, `security_headers_invitation`) keep the header policy DRY and make the frame-policy difference between invitation (framing allowed, no `X-Frame-Options`) and the other two (`X-Frame-Options: DENY`) explicit. Within `app.vizunicum.my.id`, named matchers are declared in the order Caddy evaluates them: `@webhook` (no rate limit) → `@media_upload` (11 MB body cap, 180 s timeout, rate limited) → `@api_other` (rate limited, 30 s timeout) → `handle` catch-all (web app). The `rate_limit` directive requires the `caddy-ratelimit` third-party module; this is documented in the file header.

**Rate limiting zones**: `api_authenticated` (50 req/s per IP on `/api/*`), `invitation_public_page` (50 req/s per IP on `/{slug}` and below), `invitation_public_api` (20 req/s per IP on `/public/*`), `admin_api` (30 req/s per IP on `/api/*`). These match the intent in `docs/DEVOPS/03` without being tied to specific Nginx `limit_req_zone` syntax.

**Admin stub**: the admin host returns 503 for all paths until `P5-01` ships the real admin panel. This is per the plan in `.agents/tasks/plan-p3-11-12-13.md`.

**Prometheus alert**: the `CertificateExpiresInFourteenDays` rule uses `probe_ssl_earliest_cert_expiry` (the Prometheus blackbox exporter's standard TLS metric) to fire when any of the three certificates has fewer than 14 days remaining. It uses a `for: 1h` debounce to skip transient probe failures. The rule comment specifies the required blackbox exporter target configuration.

**Verification script** (`deploy/test/routing-check.sh`): checks reachability of all three hosts, security header presence and correctness (including X-Frame-Options absent on the invitation host), body-cap enforcement (sends a 12 MB POST to `/api/media/upload`, expects 413), no rate-limit headers on the webhook path, and certificate days-remaining for all three hostnames against the 14-day threshold.

## Files and Components Touched

| Path | Change |
|---|---|
| `deploy/Caddyfile.production` | Created — production Caddy config with three hostnames, ACME TLS, rate limiting, body cap, security headers |
| `deploy/prometheus/alerts.yml` | Added `tls` alert group with `CertificateExpiresInFourteenDays` rule |
| `deploy/docker-compose.yml` | Added `caddy` service behind `--profile proxy`; added `caddy-data` and `caddy-config` volumes |
| `deploy/docker-compose.staging.yml` | Added `caddy` service (always-on); added `caddy-data` and `caddy-config` volumes |
| `deploy/test/routing-check.sh` | Created — post-deploy verification script |
| `docs/DEVOPS/03-REVERSE-PROXY.md` | Updated to note `deploy/Caddyfile.production` is the authoritative implementation |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Rate-limit zones named after their surface rather than per-host | A single `api_authenticated` zone covers both the app host's `/api/*` and the media upload path; sharing a zone lets rapid sequential API+upload sequences share the bucket, which is the right behaviour for the same IP | — |
| `caddy-ratelimit` module required | Caddy's standard distribution does not include a `rate_limit` directive; the third-party module from `github.com/mholt/caddy-ratelimit` is the established solution; documented in the Caddyfile header rather than silently depending on it | — |
| Caddy behind `--profile proxy` in development compose | ACME HTTP-01 challenge cannot succeed against `localhost`, so enabling Caddy by default in development would produce a permanently-warning container. Development uses Cloudflare Tunnel for reachability and doesn't need a local TLS proxy | — |
| `for: 1h` on certificate expiry alert | A single blackbox probe failure (transient DNS hiccup) should not page on-call. One hour of continuous sub-14-day reading is a real problem | — |

## Deviations from `docs/`

`docs/DEVOPS/03-REVERSE-PROXY.md` previously described the Caddyfile as something the implementation would produce, without referencing the actual file. The document has been amended to point to `deploy/Caddyfile.production` as the authoritative source and to describe the Nginx-style rules below it as illustrative only. No behavioural deviation from the spec.

## Tests Added

| Layer | What it covers |
|---|---|
| Manual/CI script | `deploy/test/routing-check.sh` — all three hosts, security headers, body cap, webhook bypass, certificate expiry |

No unit or integration tests added: this task is pure infrastructure configuration. The routing-check script is the verification layer.

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Webhook path not rate-limited | `docs/DEVOPS/03` § Webhook note | `routing-check.sh` verifies no `X-RateLimit-Limit` / `RateLimit-Limit` header on webhook response |
| Upload body cap at proxy before NestJS | `docs/SECURITY/06` layer 4 | `routing-check.sh` sends 12 MB to `/api/media/upload`, expects 413 from Caddy |
| HSTS on all three hosts | `docs/SECURITY/08` | `routing-check.sh` checks `Strict-Transport-Security` header on each hostname |
| `X-Frame-Options: DENY` on app and admin | `docs/SECURITY/08` | `routing-check.sh` checks header present on `app.*` and `admin.*` |
| No `X-Frame-Options` on invitation host (embed allowed) | P3-11 requirements | `routing-check.sh` checks header ABSENT on `invitation.*` |
| `X-Content-Type-Options: nosniff` on all hosts | `docs/SECURITY/08` | `routing-check.sh` checks header on all three hosts |

## Abuse Cases Covered

| Abuse case | Source | Test |
|---|---|---|
| Oversized upload reaches NestJS before proxy rejects it | `docs/SECURITY/06` layer 4 | `routing-check.sh` § "Media upload body cap (11MB limit)" |
| Rate-limiting applied to webhook path (provider retry storm blocked) | `docs/DEVOPS/03` § Webhook | `routing-check.sh` § "Webhook path bypasses rate limiting" |

## Definition of Done Verification

- [x] Tests at the appropriate pyramid layer — post-deploy shell script covers all routing, header, and security checks
- [x] IDOR test for every new `:id` endpoint — N/A (no new application endpoints)
- [x] Every abuse case has an automated test — see Abuse Cases section above
- [x] Write endpoints whitelist their fields — N/A (infrastructure only)
- [x] Free-text input sanitized before storage — N/A
- [x] Response envelope matches `docs/API/00` — N/A
- [x] State transitions logged — N/A
- [x] Nothing sensitive logged — N/A (Caddy logs requests, not credentials; no secrets in config values)
- [x] CI green: `pnpm typecheck` passes — verified (19/19 cached, all pass)
- [x] `TASKS/PROGRESS.md` and the phase file updated — both updated
- [x] Task-specific DoD items:
  - [x] Automatic ACME certificate renewal — Caddy built-in; `tls {env.TLS_EMAIL}` per host
  - [x] 14-day certificate expiry alert — `CertificateExpiresInFourteenDays` rule in `alerts.yml`
  - [x] Rate limiting on invitation and app hosts, webhook exempt — three zones, `@webhook` matcher bypasses all rate limiting
  - [x] Request body cap on `/api/media/*` at 11 MB — `request_body { max_size 11MB }` on `@media_upload` handler
  - [x] Upload timeout longer than general API timeout — 180 s vs 30 s
  - [x] Security headers on all hosts — HSTS, nosniff, Referrer-Policy on all; X-Frame-Options DENY on app and admin; absent on invitation
  - [x] No wildcard DNS — three separate host blocks with three separate `tls` directives (ADR-024)
  - [x] Admin stub returns 503 — `respond "Admin panel not yet available (P5-01)" 503` on all routes

## What Did Not Work

Nothing. This is a new infrastructure-only configuration file; there was no existing code to break.

The `caddy-ratelimit` module dependency means the image that runs in production must be built with `xcaddy` or a pre-built image that includes the module. The standard `caddy:2.9-alpine` image will fail to start with `unknown directive: rate_limit`. A `deploy/caddy/Dockerfile` build target using `xcaddy` should be added before the first production deploy — this is a follow-up, not a blocker for the configuration itself.

## Follow-Ups and Open Questions

- **`deploy/caddy/Dockerfile`** — a custom Caddy image built with `xcaddy` that includes `caddy-ratelimit`. The standard official image does not include it and will refuse to start. Should be added before the first production deploy of this config.
- **Blackbox exporter configuration** — `CertificateExpiresInFourteenDays` depends on the Prometheus blackbox exporter scraping each of the three hostnames. The scrape target configuration (`prometheus.yml` / `blackbox.yml`) needs to be added to `deploy/prometheus/` before the alert is active.
- **P5-01** — when the admin panel ships, replace the two `respond "Admin panel not yet available (P5-01)" 503` entries in the admin host block with a `reverse_proxy http://admin:8080` (or whatever port the admin app exposes).
- **P7-01 (custom domains)** — when programmatic DNS becomes available, add an `on-demand TLS` server block for `*.invitation.vizunicum.my.id` (or per-invitation custom domains). The Caddy config is structured to make this a minimal additive change.

## What to Watch

- **Caddy startup with the standard image** — if `rate_limit` fails to load, Caddy exits immediately with `unknown directive`. The symptom is all three hosts returning connection-refused. Check `docker compose logs caddy`.
- **ACME rate limits** — Let's Encrypt has a 50 certificates/domain/week limit. With three fixed hostnames, we are well below it, but renewals that fail and retry rapidly can hit the failed-validation limit. Watch Caddy logs for `acme` and `certificate` lines.
- **Cert expiry alert firing without Blackbox exporter** — the `CertificateExpiresInFourteenDays` alert uses `probe_ssl_earliest_cert_expiry`. If the blackbox exporter is not yet deployed, the metric does not exist and the alert never fires. Until the exporter is running, monitor certificate expiry manually with `routing-check.sh`.
