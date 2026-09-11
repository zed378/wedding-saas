# 10 - Domain & Publishing

## Publishing Address (MVP: path-based)

An invitation is published at a **path on a fixed hostname**:

```
https://invitation.vizunicum.my.id/{slug}
```

There is **no wildcard DNS record and no wildcard certificate** at MVP. See MEMORY ADR-024 for the reasoning; the short version is that programmatic DNS management is not in place yet, and a wildcard is precisely the thing that needs it.

- Slug validation is unchanged: 3-50 characters, `[a-z0-9-]`, cannot start or end with a dash, globally unique, and must not appear in `slug_blocklist` (DATABASE/12-PLATFORM-CONFIG.md, SECURITY/10-ABUSE-PREVENTION.md).
- The slug remains the invitation's identity. Only its **address format** changes, which is what makes the later migration cheap.

### Hostnames

Three fixed hostnames, no wildcards, each added when the surface that needs it is built.

The domain is `vizunicum.my.id`, on Cloudflare since 2026-09-10 (ADR-042 — it replaced `zedth.my.id`, which ADR-024 had assumed). **None of the three records exist yet**; all three are created by `P0-23`.

| Host | Serves | Added at |
|---|---|---|
| `invitation.vizunicum.my.id` | Public invitations at `/{slug}`, share previews at `/preview/{token}`, and `/public/*` proxied to the API so guest submissions stay same-origin | Phase 0 (`P0-23`) |
| `app.vizunicum.my.id` | Marketing, catalogue, auth, dashboard, editor, checkout, plus `/api/v1/*` and `/api/webhooks/*` | Phase 0 (`P0-23`) |
| `admin.vizunicum.my.id` | Admin panel and the admin API paths it proxies | Phase 5 (`P5-01`) |

**The public host serves nothing but invitations.** Guest-submitted content (RSVP names, guestbook messages) is rendered there, and keeping it on its own origin means a stored XSS that survives sanitization cannot act against the authenticated application — the browser's same-origin policy contains it. Under the original wildcard design every invitation had its own origin and this came for free; on a shared host it has to be a deliberate arrangement. SECURITY/02-TRUST-BOUNDARIES.md depends on it.

### Route collision safety

Because invitations sit at the root of their host, any other route on that host could shadow a published invitation — a page deployed at `/pricing` would silently take an invitation named `pricing` offline. Two rules close this:

1. The public host serves only `/{slug}`, `/preview/{token}` and the proxied `/public/*`. Nothing else is routed there.
2. Every reserved path segment is a row in `slug_blocklist`, and CI fails if a route exists that is not reserved (see `P5-13`).

### Migration to per-invitation subdomains

The target remains `{slug}.invitation.vizunicum.my.id`, reached once a Cloudflare API token can create records against the tunnel. This is the same capability the Phase 2 custom domain feature needs, so the work is shared rather than duplicated.

Slug resolution is implemented **once**, reading the slug from either a path segment or the `Host` header according to configuration (BACKEND/06-PUBLISHING.md). Migration is then a configuration change plus DNS, with one hard requirement:

> **Published path URLs must redirect permanently (301) to the subdomain form, indefinitely.** A wedding invitation link is forwarded through family WhatsApp groups and is never re-sent; a published URL is a promise, not a temporary address.

Since `seo_indexable` defaults to false (PLAN/15-SEO.md), very few invitations are indexed, so the canonical-URL change costs little — which is an argument for migrating sooner rather than after that default is commonly overridden.

## Custom Domain (Phase 2)
1. The user enters their own domain (e.g., `andi-sarah-wedding.com`) in Settings.
2. The system displays DNS instructions: CNAME pointing to the platform's tunnel hostname (or an A record to a specific IP).
3. The system periodically performs DNS verification (a job) — status: `pending_verification` → `verified` → `active`.
4. After verification, the system automatically provisions an SSL certificate (e.g., via on-demand ACME/Let's Encrypt, or through a CDN provider's API).
5. Routing: the reverse proxy performs a `custom_domain → invitation_id` lookup before falling back to the platform address (path or subdomain, whichever is configured).

This feature and the per-invitation subdomain migration above are the same underlying capability — programmatic DNS records plus per-hostname certificates — and should be built once.

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
