# 03 - Reverse Proxy

## Responsibilities
- TLS termination (or delegated to the CDN edge).
- Routing based on the `Host` header: the invitation's wildcard subdomain, a custom domain (Phase 2), the admin subdomain, the API domain.
- First-level rate limiting (before requests reach the application) for basic DoS mitigation.
- Additional security headers (if not already set at the application level): HSTS, etc.

## Chosen Implementation

The origin reverse proxy is **Caddy** (MEMORY ADR-015), with Cloudflare in front for CDN, WAF and the wildcard certificate at the edge. Caddy was chosen over Nginx for automatic certificate management, and specifically for **on-demand TLS**, which turns the Phase 2 per-domain custom-domain certificate requirement (PLAN/10) into configuration rather than a project. The routing rules below are expressed Nginx-style because they read clearly as rules; the Caddyfile implements the same host matching.

## Example Routing Configuration (Nginx-style, indicative)
```nginx
# Wildcard subdomain invitation → the public-invite app
server {
  server_name ~^(?<slug>.+)\.maindomain\.com$;
  location / {
    proxy_pass http://public_invite_app;
    proxy_set_header X-Invitation-Slug $slug;
  }
}

# Admin panel
server {
  server_name admin.maindomain.com;
  location / { proxy_pass http://admin_app; }
}

# API
server {
  server_name api.maindomain.com;
  location /public/ {
    limit_req zone=public_api burst=20 nodelay;
    proxy_pass http://backend_api;
  }
  location /api/ {
    limit_req zone=authenticated_api burst=50 nodelay;
    proxy_pass http://backend_api;
  }
  location /webhooks/ {
    # not rate-limited the same as general public traffic; whitelist the provider's IP if possible
    proxy_pass http://backend_api;
  }
}

# Main web app (marketing, dashboard, editor)
server {
  server_name maindomain.com www.maindomain.com;
  location / { proxy_pass http://web_app; }
}
```

## Custom Domain (Phase 2)
- The reverse proxy/edge performs a domain → invitation lookup at the layer before `proxy_pass` (e.g., via a Lua script/edge function querying a Redis cache containing the active domain mapping), falling back to an error page if the domain hasn't been verified.

## Timeout & Buffering
- Media upload timeout is longer than for regular API endpoints (accommodating large photo uploads on slow connections).
