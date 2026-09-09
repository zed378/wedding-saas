# 10 - Domain & Publishing

## Subdomain (MVP)
- Format: `{slug}.maindomain.com`.
- Slug validation: 3-50 characters, `[a-z0-9-]`, cannot start/end with a dash, must not appear on the reserved-word blocklist (`admin`, `api`, `www`, `app`, hate-speech/profanity list — see SECURITY/10-ABUSE-PREVENTION.md).
- Wildcard DNS resolution `*.maindomain.com` → the application, which determines the tenant from the `Host` header, looks up `Settings.slug` → `invitation_id`.
- SSL: a wildcard certificate for the main domain (e.g., Let's Encrypt wildcard or a certificate from a CDN/proxy — see ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md & DEVOPS/03-REVERSE-PROXY.md).

## Custom Domain (Phase 2)
1. The user enters their own domain (e.g., `andi-sarah-wedding.com`) in Settings.
2. The system displays DNS instructions: CNAME pointing to `custom.maindomain.com` (or an A record to a specific IP).
3. The system periodically performs DNS verification (a job) — status: `pending_verification` → `verified` → `active`.
4. After verification, the system automatically provisions an SSL certificate (e.g., via on-demand ACME/Let's Encrypt, or through a CDN provider's API).
5. Routing: the reverse proxy performs a `custom_domain → invitation_id` lookup before falling back to subdomain lookup.

## Publish Flow (Technical)
1. Precondition: `Invitation.status == paid`.
2. Validate data completeness according to the `required_fields` of the active template — if it fails, show the list of missing fields.
3. Validate slug availability (DB unique constraint + API pre-check).
4. Set `Invitation.status = published`, `published_at = now()`, `expiry_date = now() + package_duration`.
5. Invalidate/warm the public page cache (see ARCHITECTURE/06-CACHING-ARCHITECTURE.md).
6. Send an event for analytics/notifications (see 13-NOTIFICATION-SYSTEM.md).

## Unpublish
- Set `status = paid` (not `draft`), remove from the public cache, the slug remains reserved (not released to other users) as long as this invitation still exists (prevents slug hijacking by others while temporarily unpublished).

## Renewal
- Extends `expiry_date` according to the purchased package, without changing the status if still `published`; if already `expired`, it returns to `published` after successful renewal payment.
