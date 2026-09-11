# 03 - Reverse Proxy

## Responsibilities
- TLS termination (or delegated to the CDN edge).
- Routing based on the `Host` header: the invitation's wildcard subdomain, a custom domain (Phase 2), the admin subdomain, the API domain.
- First-level rate limiting (before requests reach the application) for basic DoS mitigation.
- Additional security headers (if not already set at the application level): HSTS, etc.

## Chosen Implementation

The origin reverse proxy is **Caddy** (MEMORY ADR-015), with Cloudflare in front for CDN, WAF and the wildcard certificate at the edge. Caddy was chosen over Nginx for automatic certificate management, and specifically for **on-demand TLS**, which turns the Phase 2 per-domain custom-domain certificate requirement (PLAN/10) into configuration rather than a project. The routing rules below are expressed Nginx-style because they read clearly as rules; the Caddyfile implements the same host matching.

## Example Routing Configuration (Nginx-style, indicative)
At MVP there is **no wildcard host** — invitations are addressed by path on a fixed hostname (PLAN/10, MEMORY ADR-024). Three hostnames, each with its own certificate, all issued and renewed automatically by Caddy:

```nginx
# Public invitations — path-based. Serves ONLY invitations, previews and the public API.
# Kept on its own origin so guest-submitted content cannot act against the authenticated app.
server {
  server_name invitation.vizunicum.my.id;

  location /public/ {
    limit_req zone=public_api burst=20 nodelay;
    proxy_pass http://backend_api;          # same-origin for guest RSVP/guestbook submissions
  }
  location /preview/ { proxy_pass http://public_invite_app; }
  location / {
    limit_req zone=public_page burst=50 nodelay;
    proxy_pass http://public_invite_app;    # /{slug} — the app 404s anything that is not one
  }
}

# Authenticated application + API
server {
  server_name app.vizunicum.my.id;

  location /api/webhooks/ {
    # NOT rate-limited with general public traffic: a provider retry storm is legitimate traffic
    proxy_pass http://backend_api;
  }
  location /api/ {
    limit_req zone=authenticated_api burst=50 nodelay;
    proxy_pass http://backend_api;
  }
  location / { proxy_pass http://web_app; }
}

# Admin panel — separate host, separate cookie scope (Phase 5, SECURITY/02 boundary 3→4)
server {
  server_name admin.vizunicum.my.id;
  location /api/ { proxy_pass http://backend_api; }
  location /     { proxy_pass http://admin_app; }   # static SPA build
}
```

Each browser call is same-origin with the surface that made it, so the session cookie for the admin panel is never sent to the user application and vice versa.

### Migration to per-invitation subdomains

When programmatic DNS is available, a wildcard server block resolving the slug from the `Host` header is added, and the path form issues a permanent redirect to it. The application side is already prepared for this: BACKEND/06 resolves the slug by configured strategy rather than by hard-coded parsing.

## Custom Domain (Phase 2)
- The reverse proxy/edge performs a domain → invitation lookup at the layer before `proxy_pass` (e.g., via a Lua script/edge function querying a Redis cache containing the active domain mapping), falling back to an error page if the domain hasn't been verified.

## Timeout & Buffering
- Media upload timeout is longer than for regular API endpoints (accommodating large photo uploads on slow connections).
