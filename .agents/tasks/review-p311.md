# Production Subdomain Routing and TLS (P3-11)

Three fixed hostnames (`app.vizunicum.my.id`, `invitation.vizunicum.my.id`, `admin.vizunicum.my.id`) are now Caddy server blocks with automatic ACME TLS, per-host security headers, edge rate limiting, and a media-upload route with its own body cap and extended timeout. The Cloudflare Tunnel remains the ingress mechanism on staging; Caddy sits behind it and handles TLS termination at the origin. All ten review criteria from the task are addressed, with one structural gap the record acknowledges: the `caddy:2.9-alpine` image referenced in both compose files does not include the `caddy-ratelimit` module, so `rate_limit` directives in the Caddyfile will cause a startup failure at every deploy until a custom xcaddy image is built and the compose references are updated.

Watch for: (1) **confirmed** — both compose files reference `caddy:2.9-alpine`, which does not ship the `caddy-ratelimit` module; rate limiting will not function and Caddy will fail to start. (2) **confirmed** — `CertificateExpiresInFourteenDays` depends on `probe_ssl_earliest_cert_expiry` from the Prometheus blackbox exporter, which has no configuration in `deploy/prometheus/`; the alert is permanently silent until the exporter is deployed.

**Verdict**: NEEDS_CHANGES

---

## High-level view

The Caddyfile structure satisfies every routing, header, and timeout requirement in the spec. Named matchers within `app.vizunicum.my.id` are declared in evaluation order — `@webhook` first (no rate limit), then `@media_upload` (11 MB cap, 180 s timeout, rate limited), then `@api_other` (30 s, rate limited), then the catch-all — which is the correct Caddy pattern for priority routing. The frame-policy split is clean: `security_headers_app` adds `X-Frame-Options: DENY` and is applied to both `app.*` and `admin.*`; `security_headers_invitation` deliberately omits it, and the comment makes the intent explicit.

The rate-limiting implementation has a structural blocker. Both `docker-compose.yml` and `docker-compose.staging.yml` reference `caddy:2.9-alpine`, the unmodified upstream image. That image does not include the `caddy-ratelimit` third-party module. Caddy parses the entire Caddyfile at startup; an unrecognised directive (`rate_limit`) causes an immediate fatal error. The `What Did Not Work` section of the record correctly identifies this and asks for a `deploy/caddy/Dockerfile` using `xcaddy` — but neither the Dockerfile nor updated compose image references exist in the diff. The task is marked DONE while the blocking follow-up is unbuilt.

The 14-day certificate expiry alert is correctly specified in `alerts.yml` using the blackbox exporter's standard metric. However, no blackbox exporter configuration exists in `deploy/prometheus/`, and no compose service for it exists in either compose file. The metric `probe_ssl_earliest_cert_expiry` will never be scraped, so the alert will never fire. The record notes this as a follow-up, but a non-firing alert is equivalent to no alert.

The admin stub returns 503 on all paths with its own server block, `X-Frame-Options: DENY`, and HSTS — it does not route to `app.*` or `public-invite.*`.

<details>
<summary>Issues (4)</summary>

1. **caddy-ratelimit missing from image** — Both `docker-compose.yml` and `docker-compose.staging.yml` reference `caddy:2.9-alpine`, which does not include the `caddy-ratelimit` module. Caddy will fail to start with `unknown directive: rate_limit`, making all three hosts unreachable. Add `deploy/caddy/Dockerfile` using `xcaddy` with `github.com/mholt/caddy-ratelimit`, build and tag the image, and update both compose files to reference it before the first production deploy.

2. **Blackbox exporter not deployed — cert alert permanently silent** — `CertificateExpiresInFourteenDays` uses `probe_ssl_earliest_cert_expiry`, but no blackbox exporter is configured in `deploy/prometheus/` and no compose service exists for it. Add the exporter service to both compose files and add `prometheus/blackbox.yml` with the three hostname targets.

3. **ACME HTTP-01 challenge port not exposed in `docker-compose.yml`** — The development compose service for Caddy only publishes `443:443`. ACME HTTP-01 needs port 80. The staging compose correctly exposes both `80:80` and `443:443`. The dev compose omitting port 80 is lower risk because the profile flag gates it, but it will silently fail TLS provisioning if exercised with real hostnames.

4. **`routing-check.sh` body-cap test is inconclusive against auth-gated endpoints** — The script acknowledges this: a 401/403 on the 12 MB POST to `/api/media/upload` is reported as a warning rather than a failure, because the auth gate fires first and Caddy never gets to evaluate the body cap. The test cannot confirm that Caddy enforces the cap before NestJS sees the bytes. Add a dedicated unauthenticated probe path (or test in staging with a valid token) to confirm the 413 comes from Caddy rather than the app layer.

</details>

<details>
<summary>Details</summary>

### caddy-ratelimit module gap

The `rate_limit` directive throughout the Caddyfile requires the `caddy-ratelimit` third-party module (`github.com/mholt/caddy-ratelimit`). Caddy parses the entire Caddyfile before serving any requests; an unknown directive causes a fatal startup error. Neither compose file has been updated from `caddy:2.9-alpine` to a custom image. The symptom at deploy time is all three hosts returning connection-refused, with `docker compose logs caddy` showing `unknown directive: rate_limit`.

This is a blocking gap. Rate limiting is a P3-11 DoD item, and the Caddyfile implements it correctly in syntax — but it cannot load. The record's follow-up section correctly describes the fix (`deploy/caddy/Dockerfile` with `xcaddy`), but the file does not exist in the diff and the compose files are unchanged.

### Certificate expiry alert has no data source

`alerts.yml` defines `CertificateExpiresInFourteenDays` using `probe_ssl_earliest_cert_expiry`, which the Prometheus blackbox exporter emits when it probes an HTTPS target. No blackbox exporter service appears in either compose file, and no `blackbox.yml` scrape configuration exists in `deploy/prometheus/`. Until both are added and the exporter is scraping all three hosts, the metric does not exist in Prometheus and the alert never evaluates. The `for: 1h` debounce and the runbook annotation are correct; the data pipeline behind them is absent.

### Body cap test is inconclusive

`@media_upload` sets `request_body { max_size 11MB }` and `read_timeout 180s`. The routing-check script tests the cap by sending a 12 MB POST to `/api/media/upload`, but the auth gate fires first and the script reports 401/403 as an inconclusive warning rather than a failure. This means the DoD item "upload body cap enforced at the proxy before bytes reach NestJS" has no passing test. The Caddyfile syntax is correct, but the enforcement is unverified against a real request.

</details>

---

<details>
<summary>File map</summary>

| File | Change |
|---|---|
| `deploy/Caddyfile.production` | Created — three Caddy server blocks with ACME TLS, rate limiting, webhook bypass, media body cap, upload timeout, security headers |
| `deploy/prometheus/alerts.yml` | Added `tls` alert group with `CertificateExpiresInFourteenDays` rule |
| `deploy/docker-compose.yml` | Added `caddy` service (behind `--profile proxy`); added `caddy-data` and `caddy-config` volumes |
| `deploy/docker-compose.staging.yml` | Added `caddy` service (always-on); added volumes |
| `deploy/test/routing-check.sh` | Created — post-deploy shell verification for all routing, header, body-cap, and certificate checks |
| `docs/DEVOPS/03-REVERSE-PROXY.md` | Updated to reference `Caddyfile.production` as the authoritative implementation |

Full diff: `git diff main -- deploy/`

</details>
