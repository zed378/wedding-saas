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
- The handler always works with a `slug`, whatever the address format. At MVP the public app derives it from the URL path (`invitation.zedth.my.id/{slug}`); later it will derive it from a subdomain label, and for a custom domain (Phase 2) the edge resolves `Host` → `slug` first. See PLAN/10-DOMAIN-PUBLISHING.md and BACKEND/06-PUBLISHING.md § Slug Resolution.
- These endpoints are reachable at `/public/*` on the public invitation host, proxied to the API, so a guest's RSVP or guestbook submission is a same-origin request from the page they are reading.

## GET /public/i/:slug — Response
```json
{
  "success": true,
  "data": {
    "status": "published",
    "template": { "sections": [...], "theme": {...} },
    "display": { "watermark": true },
    "invitation": {
      "couple": {...}, "events": [...], "gallery": [...],
      "bank_accounts": [...], "quote": {...},
      "settings": { "enabled_sections": [...], "rsvp_enabled": true, "guestbook_enabled": true }
    }
  }
}
```
- If the status is NOT `published` (e.g., `expired`, not found) → 404 with a dedicated frontend page ("Invitation not found / has ended"), WITHOUT leaking the specific reason (e.g., not explicitly distinguishing "never published" vs "intentionally unpublished" vs "expired" in the API response — differentiation at the UI level, if needed, based only on publicly-safe status).
- `display.watermark` is derived **server-side** from the package the invitation was paid for (`packages.has_watermark`, DATABASE/07) — the renderer cannot determine it from any other field in this response, and it must never be influenced by a client hint. It is the visible difference between the Basic and Premium packages (PLAN/09).
- `bank_accounts` is ONLY included if the `gift` section is active in `enabled_sections` — respect the user's toggle even if data exists in the DB (BR-4.1).

## RSVP & Guestbook Submission
- Rate-limited per IP+slug (e.g., max 10 submissions/hour) — see SECURITY/10.
- Input validation & sanitization is just as strict as authenticated endpoints (SECURITY/08).
- Guestbook: if `guestbook_moderation = true`, the new entry's `status = pending` and does NOT appear in `GET guestbook` until approved by the owner.

## Caching
- `GET /public/i/:slug` is the primary candidate for CDN/app-level caching (see ARCHITECTURE/06-CACHING-ARCHITECTURE.md) — the response must be deterministic per `invitation_id + template_version_id`, without user-specific data (personalization `?to=Name` is handled on the frontend, not in this API response).
