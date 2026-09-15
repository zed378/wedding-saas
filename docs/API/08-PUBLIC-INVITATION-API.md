# 08 - Public Invitation API

No authentication required. Aggressively rate-limited (SECURITY/10-ABUSE-PREVENTION.md). Kept separate from `/api/v1/*` to make caching & policy differences easier.

```
GET    /public/i/:slug                         Full data for the published invitation to be rendered (or via a custom domain, see the resolution note below)
POST   /public/i/:slug/rsvp                      { guest_name, attendance_status, guest_count, message? }
POST   /public/i/:slug/guestbook                  { guest_name, message }
GET    /public/i/:slug/guestbook                  List of entries with `status=approved` (for display on the page)
POST   /public/i/:slug/guestbook/:entry_id/report   Report an entry for moderation (rate-limited, no body beyond an optional reason)
POST   /public/i/:slug/view                        Increment the page-view counter (fire-and-forget from the client)
GET    /public/preview/:token                      Render an unpublished invitation from a share-preview token (API/04 § Preview)
```

`report` is the guest-facing half of the admin moderation queue in PLAN/12 § Moderation Queue — a queue fed by "user reports" needs a way for a user to report. It is heavily rate-limited per IP hash, reveals nothing about the entry's current state, and flags rather than hides: a report queues the entry for review (PLAN/05 § Admin Guestbook Moderation), it does not let a stranger remove a message from someone's wedding page.

## Address Resolution
- The handler always works with a `slug`, whatever the address format. At MVP the public app derives it from the URL path (`invitation.vizunicum.my.id/{slug}`); later it will derive it from a subdomain label, and for a custom domain (Phase 2) the edge resolves `Host` → `slug` first. See PLAN/10-DOMAIN-PUBLISHING.md and BACKEND/06-PUBLISHING.md § Slug Resolution.
- These endpoints are reachable at `/public/*` on the public invitation host, proxied to the API, so a guest's RSVP or guestbook submission is a same-origin request from the page they are reading.

## GET /public/i/:slug — Response
```json
{
  "success": true,
  "data": {
    "status": "published",
    "template": { "sections": [...], "theme": {...}, "customizable_theme_keys": [...], "thumbnail_url": "https://cdn…/thumb.webp" },
    "display": { "watermark": true },
    "invitation": {
      "couple": { "groom": {...}, "bride": {...} },
      "events": [ { "type": "akad", "title": "...", "date": "2027-05-15", "start_time": "08:00", "timezone": "Asia/Jakarta", "venue_name": "...", ... } ],
      "gallery": { "photos": [ { "url": "...", "medium_url": "...", "thumbnail_url": "...", "caption": "...", "is_cover": true, "order": 0 } ] },
      "gift": { "accounts": [ { "type": "bank", "provider_name": "...", "account_number": "...", "account_holder": "...", "order": 0 } ] },
      "quote": { "text": "...", "source": "..." },
      "settings": { "enabled_sections": [...], "theme_override": {...}, "rsvp_enabled": true, "guestbook_enabled": true, "seo_indexable": false }
    }
  }
}
```
- **The `invitation` object is in `PLAN/08`'s canonical shape, not `API/04`'s.** `events[].date` not `event_date`; `gallery.photos` not `gallery`; `gift.accounts` not `bank_accounts`; `couple.<role>.photo` holding a URL, not `photo_media_id`. Those are the paths the field registry defines and the paths a template names in its `required_fields`, so they are the paths the renderer resolves a section's props from — a payload in any other shape renders a page with the right sections and nothing in them. This document's earlier example predated the registry (`P0-20`); the registry is the source of truth. `P2-08` (ADR-063).
- `template.customizable_theme_keys` accompanies the theme because the renderer validates `settings.theme_override` against it (FRONTEND/04, `P2-02`). Serving the override without the whitelist would leave the public page unable to apply the rule the editor applied. It is template metadata, already public through API/03. Added by `P2-07` (ADR-062).
- `settings.seo_indexable` is included because `P2-09` emits `robots` from it; it is the owner's own instruction about their own page.
- `template.thumbnail_url` is the catalogue thumbnail, and exists for one reason: `FRONTEND/07` § SEO Meta Generation makes it the `og:image` fallback when an invitation has no cover photo. That case is not an edge — a couple who has not uploaded photos yet is exactly the couple testing what their link looks like. Not new exposure; API/03 serves the same URL to anyone browsing the catalogue. Added by `P2-09` (ADR-064).
- `settings.guestbook_moderation` is deliberately **absent**. It is a setting, but it tells a guest whether their message appears immediately or waits for approval, which is the knowledge that makes moderation worth evading.
- **Media is served as URLs, never as ids.** A guest has no authenticated media endpoint, so `gallery.photos[].url` / `gallery.photos[].medium_url` / `gallery.photos[].thumbnail_url` and `couple.<role>.photo` carry CDN addresses built per ARCHITECTURE/05 § Path Structure. `url` is the 1600w variant, `medium_url` the 800w and `thumbnail_url` the 300w. `couple.<role>.photo` is the **thumbnail**: the portrait is drawn 140px square, and the 1600w file it used to carry cost two ~150KB downloads on the page with the tightest budget in the product. `medium_url` and the portrait variant were added by `P2-13` (ADR-067). They are present only for a `ready` media row with a CDN configured — never a bucket URL as a fallback (ARCHITECTURE/05 § Access Control). Note that the storage path contains the invitation id by design, so a public photo URL necessarily discloses it; the id is not a capability, since every `:id` endpoint filters on `owner_id` (SECURITY/05).
- Nothing else from the invitation appears: no `id`, `owner_id`, `internal_name`, `template_id`, `template_version_id`, `published_at`, `expiry_date`, `created_at`, `updated_at`, and nothing order- or payment-related. The payload is assembled field by field rather than filtered down from the owner's response, so adding a field to an invitation is not also a decision to publish it.
- If the status is NOT `published` (e.g., `expired`, not found) → 404 with a dedicated frontend page ("Invitation not found / has ended"), WITHOUT leaking the specific reason (e.g., not explicitly distinguishing "never published" vs "intentionally unpublished" vs "expired" in the API response — differentiation at the UI level, if needed, based only on publicly-safe status).
- `display.watermark` is `true` for an invitation nobody has paid for — a BR-2.8 trial publish — and the public page then shows a small "Undangan versi uji coba" notice (P3-09; its design is `OQ-13`). It is derived **server-side** from the package the invitation was paid for (`packages.has_watermark`, DATABASE/07) — the renderer cannot determine it from any other field in this response, and it must never be influenced by a client hint. It is the visible difference between the Basic and Premium packages (PLAN/09).
- `gift.accounts` is ONLY included if the `gift` section is active in `enabled_sections` — respect the user's toggle even if data exists in the DB (BR-4.1). Absent, not an empty array: an empty array says "the couple listed no accounts", and absence says "this invitation does not show gift accounts", which is the true statement.
- The same rule applies to **every** section that owns data, not only to gift accounts. The implementation asks *"does any displayed section reference this data?"*, reading the field paths the template itself declares in `required_fields`/`optional_fields`, rather than mapping section keys to payload keys in code. Two consequences worth knowing: a `configurable: false` section is displayed whatever `enabled_sections` says (FRONTEND/04 § Render Flow step 2), so its data is always served; and data a **still-displayed** section references is kept even when the section usually associated with it is off — the reference template's `hero` lists `gallery.photos`, so turning the gallery off does not remove the hero's background photo. Added by `P2-07` (ADR-062); the hero's declaration corrected by `P2-13` — as `gallery.photos.*.media_id` it narrowed every photo to an id the payload never carries, and the cover had never rendered on a public page.

## GET /public/preview/:token — Response (`P2-12`)
- The same payload as `GET /public/i/:slug`, built by the same code, with four fields forced whatever the invitation's own settings say: `status: "preview"` (a preview usually shows a draft, and claiming `"published"` would be false), `display: { watermark: true, preview: true }`, `settings.seo_indexable: false`, and `settings.rsvp_enabled` / `settings.guestbook_enabled: false`.
- Served with `Cache-Control: private, no-store` — a shared cache holding a preview would keep serving the draft after the owner revoked it — and `X-Robots-Tag: noindex, nofollow`.
- The token's shape is checked before it is hashed or queried. A malformed, unknown, expired or revoked token, and a token for a deleted invitation, all answer with the identical 404 the slug route uses.
- A successful resolve records `last_accessed_at` on the token.

## POST /public/rum — Real-user Core Web Vitals (`P2-13`)
- The public page reports each Core Web Vital it measures in a guest's browser, per FRONTEND/09 § Monitoring. Reachable at `/public/rum` on the public invitation host, which forwards it to the API with the guest's `X-Forwarded-For` unchanged, so it is a same-origin beacon and no third-party origin sees the guest's browser.
- Request body, strict — an unknown field is a 400, not silently dropped: `{ "metric": "LCP" | "CLS" | "INP" | "FCP" | "TTFB", "value": number (0–120000), "rating": "good" | "needs-improvement" | "poor", "page_kind": "invitation" | "preview" | "not_found" }`.
- **No URL, slug or token is accepted.** A preview path is a credential (`P2-12`) and an invitation path names a couple; `page_kind` is set by the page that mounts the reporter, not parsed from the address.
- `204 No Content` for a valid report; the standard 400 envelope otherwise. Rate-limited under `general-public`. Each report becomes one structured log line, `rum.web_vital`, aggregated into percentiles by the log pipeline (DEVOPS/06); nothing is stored per report.
- The page's server-side fetches (`GET /public/i/:slug`, `GET /public/preview/:token`) forward the guest's `X-Forwarded-For` the same way, for the same reason: without it every guest of every wedding shares the public page server's `general-public` allowance.
- **CDN requirement**: media responses should carry `Timing-Allow-Origin: *`. The photos are cross-origin to the page, and without the header a browser hides their paint time, so RUM reports an image's load time as its LCP.

## RSVP & Guestbook Submission
- Rate-limited per IP+slug (e.g., max 10 submissions/hour) — see SECURITY/10.
- Input validation & sanitization is just as strict as authenticated endpoints (SECURITY/08).
- Guestbook: if `guestbook_moderation = true`, the new entry's `status = pending` and does NOT appear in `GET guestbook` until approved by the owner.

## Caching
- `GET /public/i/:slug` is the primary candidate for CDN/app-level caching (see ARCHITECTURE/06-CACHING-ARCHITECTURE.md) — the response must be deterministic per `invitation_id + template_version_id`, without user-specific data (personalization `?to=Name` is handled on the frontend, not in this API response).
