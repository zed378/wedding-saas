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
    "template": { "sections": [...], "theme": {...}, "customizable_theme_keys": [...] },
    "display": { "watermark": true },
    "invitation": {
      "couple": {...}, "events": [...], "gallery": [...],
      "bank_accounts": [...], "quote": {...},
      "settings": { "enabled_sections": [...], "theme_override": {...}, "rsvp_enabled": true, "guestbook_enabled": true, "seo_indexable": false }
    }
  }
}
```
- `template.customizable_theme_keys` accompanies the theme because the renderer validates `settings.theme_override` against it (FRONTEND/04, `P2-02`). Serving the override without the whitelist would leave the public page unable to apply the rule the editor applied. It is template metadata, already public through API/03. Added by `P2-07` (ADR-062).
- `settings.seo_indexable` is included because `P2-09` emits `robots` from it; it is the owner's own instruction about their own page.
- `settings.guestbook_moderation` is deliberately **absent**. It is a setting, but it tells a guest whether their message appears immediately or waits for approval, which is the knowledge that makes moderation worth evading.
- **Media is served as URLs, never as ids.** A guest has no authenticated media endpoint, so `gallery[].url` / `gallery[].thumbnail_url` and `couple.*.photo_url` carry CDN addresses built per ARCHITECTURE/05 § Path Structure. They are present only for a `ready` media row with a CDN configured — never a bucket URL as a fallback (ARCHITECTURE/05 § Access Control). Note that the storage path contains the invitation id by design, so a public photo URL necessarily discloses it; the id is not a capability, since every `:id` endpoint filters on `owner_id` (SECURITY/05).
- Nothing else from the invitation appears: no `id`, `owner_id`, `internal_name`, `template_id`, `template_version_id`, `published_at`, `expiry_date`, `created_at`, `updated_at`, and nothing order- or payment-related. The payload is assembled field by field rather than filtered down from the owner's response, so adding a field to an invitation is not also a decision to publish it.
- If the status is NOT `published` (e.g., `expired`, not found) → 404 with a dedicated frontend page ("Invitation not found / has ended"), WITHOUT leaking the specific reason (e.g., not explicitly distinguishing "never published" vs "intentionally unpublished" vs "expired" in the API response — differentiation at the UI level, if needed, based only on publicly-safe status).
- `display.watermark` is derived **server-side** from the package the invitation was paid for (`packages.has_watermark`, DATABASE/07) — the renderer cannot determine it from any other field in this response, and it must never be influenced by a client hint. It is the visible difference between the Basic and Premium packages (PLAN/09).
- `bank_accounts` is ONLY included if the `gift` section is active in `enabled_sections` — respect the user's toggle even if data exists in the DB (BR-4.1). Absent, not an empty array: an empty array says "the couple listed no accounts", and absence says "this invitation does not show gift accounts", which is the true statement.
- The same rule applies to **every** section that owns data, not only to gift accounts. The implementation asks *"does any displayed section reference this data?"*, reading the field paths the template itself declares in `required_fields`/`optional_fields`, rather than mapping section keys to payload keys in code. Two consequences worth knowing: a `configurable: false` section is displayed whatever `enabled_sections` says (FRONTEND/04 § Render Flow step 2), so its data is always served; and data a **still-displayed** section references is kept even when the section usually associated with it is off — the reference template's `hero` lists `gallery.photos.*.media_id`, so turning the gallery off does not remove the hero's background photo. Added by `P2-07` (ADR-062).

## RSVP & Guestbook Submission
- Rate-limited per IP+slug (e.g., max 10 submissions/hour) — see SECURITY/10.
- Input validation & sanitization is just as strict as authenticated endpoints (SECURITY/08).
- Guestbook: if `guestbook_moderation = true`, the new entry's `status = pending` and does NOT appear in `GET guestbook` until approved by the owner.

## Caching
- `GET /public/i/:slug` is the primary candidate for CDN/app-level caching (see ARCHITECTURE/06-CACHING-ARCHITECTURE.md) — the response must be deterministic per `invitation_id + template_version_id`, without user-specific data (personalization `?to=Name` is handled on the frontend, not in this API response).
