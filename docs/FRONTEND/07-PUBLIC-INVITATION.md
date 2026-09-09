# 07 - Public Invitation (Rendering Strategy)

## Why Not a Pure CSR SPA
Sharing bots (WhatsApp, Facebook, Telegram) scrape `og:*` meta tags WITHOUT executing JavaScript — a pure SPA will fail to display the correct link preview (empty/generic og:image, og:title). This is why SSR or pre-rendering is mandatory.

## Strategy: SSR + Cache Invalidation on Update (similar to ISR)
```
When an invitation is published/updated:
  → The server renders the full HTML (including dynamic meta tags) for that invitation
  → Stores it in cache (CDN + app cache, see ARCHITECTURE/06)
  → Subsequent public requests: served from cache (fast)
  → When the owner updates content: invalidate that invitation's cache → the next request re-renders & re-caches
```
If using Next.js: dynamic `generateMetadata` per slug + ISR (on-demand `revalidate` triggered via an API route called from the `invitation.updated` event) is the appropriate pattern.

## Data Fetching
- A server-side fetch to `GET /public/i/:slug` (API/08) during rendering — NOT a client-side fetch for the initial render (so the meta tags & main content are already present in the initial HTML).
- Additional data intended for "live-update without reload" (e.g., a new guestbook entry after the user submits their own) may be fetched client-side after the initial load.

## Personalization `?to=Name`
- Does NOT affect the primary SSR/cache key (to keep the cache efficient for many different guests) — read & rendered client-side (during hydration) from `window.location.search`; the related element is rendered as part that's allowed to flash/update post-hydration (an acceptable trade-off, a small non-critical part for SEO).

## Address & Host
- At MVP the invitation is at `https://invitation.zedth.my.id/{slug}` — path-based on a fixed host, no wildcard DNS (PLAN/10, ADR-024). The slug arrives as a path segment and is validated before use, exactly as a `Host`-derived slug would be.
- The canonical URL and `og:url` use this address. When per-invitation subdomains arrive, the canonical changes and the path form redirects permanently.

## Fallback & Error State
- Slug not found / status not `published` → render a dedicated 404 page (not a generic framework 404) with a friendly message (see UI-UX/14).

## SEO Meta Generation
- `og:image` is taken from the photo with `is_cover=true` in the gallery, falling back to the template thumbnail if there's no cover photo.
- The `robots` meta follows `invitation_settings.seo_indexable` (PLAN/15).
