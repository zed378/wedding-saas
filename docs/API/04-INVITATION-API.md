# 04 - Invitation API

All endpoints require authentication & object-level authorization: only `owner_id == current_user.id` (except for admins). See SECURITY/05-MULTI-TENANCY-SECURITY.md.

## Invitation CRUD
```
POST   /api/v1/invitations                    { template_id, internal_name, slug? }
GET    /api/v1/invitations                     List invitations owned by the current user
GET    /api/v1/invitations/:id                  Full detail (all entities embedded)
PATCH  /api/v1/invitations/:id                   Partial update (settings, etc.)
DELETE /api/v1/invitations/:id                   Soft-delete
POST   /api/v1/invitations/:id/change-template   { template_id }
POST   /api/v1/invitations/:id/upgrade-template-version   Move to the latest published version of the SAME template
GET    /api/v1/invitations/slug-available?slug=&exclude_invitation_id=   Is this address usable?
```

`slug-available` is **advisory**. It answers `{ available, slug, reason?, message? }` where `reason` is `format`, `blocked` or `taken` — the three kinds stay distinct because "not a valid address", "reserved" and "somebody got there first" are different problems for the person typing. Between its answer and the `POST /invitations` that uses it, another user can claim the slug, so **the creation call remains authoritative** and a client must still handle 409 `SLUG_TAKEN`. Authenticated and rate limited despite a slug being a public address by design: the endpoint is a yes/no oracle over every published invitation's URL, and bulk-harvesting which addresses exist should not be convenient. Added by `P1-21` (gap `PG-18`).

`change-template` and `upgrade-template-version` are separate endpoints because they are separate user intentions and carry different warnings. Changing templates may hide sections the new template does not support (BR-4.1); upgrading a version keeps the same design and is the conscious action BR-3.2 promises. Neither is ever automatic — an invitation stays on the `template_version_id` it locked at creation until the user acts (BR-3.1).

### `change-template` response

The response is the source for the confirmation modal in UI-UX/05 § Change Template Flow, which lists the fields that will stop being displayed before the user commits:

```json
{
  "data": {
    "template_id": "uuid",
    "template_version_id": "uuid",
    "enabled_sections": ["hero", "quote"],
    "hidden_sections": ["gallery"],
    "dropped_theme_keys": ["colors.accent"]
  }
}
```

- `enabled_sections` is recomputed by the server from `section_key` equality (PLAN/07 § Template Compatibility): what was enabled and the new template still defines, plus the new template's `enabled_by_default` sections the old template did not have, plus any section the new template marks non-configurable. The client does not send it — a client that could would be able to enable a section the template does not define.
- `hidden_sections` is what was enabled and the new template does not define. The data behind those sections **is not deleted** (BR-4.1); switching back restores the display.
- `dropped_theme_keys` is what was removed from `theme_override` because the new template does not list it in `customizable_theme_keys`. Unlike section data these are not retained: a theme key's meaning belongs to the template that defines it.
- 422 `TEMPLATE_NOT_AVAILABLE` when the target template has no published version (BR-3.3); 422 `TEMPLATE_UNCHANGED` when the invitation is already on it; 404 when the template id is unknown, indistinguishable from an invitation that is not the caller's.

## Sub-resource: Couple/Person
```
PATCH  /api/v1/invitations/:id/couple/groom      { full_name, nickname, photo_media_id, instagram, father_name, mother_name, child_order }
PATCH  /api/v1/invitations/:id/couple/bride       (same fields)
```

## Sub-resource: Events
```
GET    /api/v1/invitations/:id/events
POST   /api/v1/invitations/:id/events             { type, title, date, start_time, end_time, venue_name, address, latitude, longitude, description }
PATCH  /api/v1/invitations/:id/events/:event_id
DELETE /api/v1/invitations/:id/events/:event_id
```

## Sub-resource: Gallery
```
GET    /api/v1/invitations/:id/gallery
POST   /api/v1/invitations/:id/gallery            { media_id, caption?, is_cover? }
PATCH  /api/v1/invitations/:id/gallery/:photo_id    { caption?, order? }
DELETE /api/v1/invitations/:id/gallery/:photo_id
POST   /api/v1/invitations/:id/gallery/reorder      { ordered_photo_ids: [...] }
```

## Sub-resource: RSVP (owner side)

Public submission is in 08-PUBLIC-INVITATION-API.md. These are the owner's management endpoints (PLAN/04 § F10, UI-UX/10 § RsvpTable).

```
GET    /api/v1/invitations/:id/rsvps                 ?attendance_status=&page=  Paginated list
GET    /api/v1/invitations/:id/rsvps/summary          Totals per status + total guest count
GET    /api/v1/invitations/:id/rsvps/export           CSV download
DELETE /api/v1/invitations/:id/rsvps/:rsvp_id         Remove a spam or mistaken entry
```

- The summary is computed in SQL, not by loading every row — a popular wedding produces hundreds of entries and the dashboard reads this on every visit.
- CSV cells beginning with `=`, `+`, `-` or `@` are prefixed so a guest name cannot execute as a formula when the file is opened in a spreadsheet. The export is opened by non-technical users and forwarded to clients (UI-UX/04, Budi's journey).

## Sub-resource: Guestbook (owner side)

Owner moderation, distinct from the platform-level admin moderation queue in 09-ADMIN-API.md (PLAN/04 § F11, BR-7.3).

```
GET    /api/v1/invitations/:id/guestbook              ?status=pending|approved|rejected&page=
PATCH  /api/v1/invitations/:id/guestbook/:entry_id     { status: approved|rejected }
DELETE /api/v1/invitations/:id/guestbook/:entry_id
```

- `moderated_by` and `moderated_at` are recorded on every decision (DATABASE/09).
- Approving an entry invalidates the invitation's public page cache so the message appears without waiting for TTL (ARCHITECTURE/06).
- Turning moderation on does **not** retroactively hide already-approved entries, and turning it off does **not** auto-approve the pending queue. The UI states this, because an owner who believes they hid something that is still public has been failed by the product.

## Sub-resource: Bank Accounts, Quote
```
GET/POST/PATCH/DELETE /api/v1/invitations/:id/bank-accounts[/:bank_id]
PATCH  /api/v1/invitations/:id/quote               { text, source? }
```

## Settings
```
GET    /api/v1/invitations/:id/settings
PATCH  /api/v1/invitations/:id/settings            { enabled_sections, theme_override, rsvp_enabled, guestbook_enabled, guestbook_moderation, slug }
```

## Publish
```
POST   /api/v1/invitations/:id/publish             Full validation + set status published (see PLAN/10)
POST   /api/v1/invitations/:id/unpublish
GET    /api/v1/invitations/:id/publish-check         Check missing fields without actually publishing (used for a UI checklist indicator)
```

## Preview
```
GET    /api/v1/invitations/:id/preview-links         List active preview links
POST   /api/v1/invitations/:id/preview-link          Generate a share-preview token (7-day expiry)
DELETE /api/v1/invitations/:id/preview-links/:token_id   Revoke a link
```

The token is returned **once**, at creation, and stored only as a hash (DATABASE/04 § Share-Preview Tokens). It is consumed by the public route `GET /public/preview/:token` (API/08), which always renders `noindex` and watermarked, with submissions disabled.

## Example Response — GET /invitations/:id (summary)
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "owner_id": "uuid",
    "status": "draft",
    "template_id": "uuid",
    "template_version_id": "uuid",
    "slug": "andi-sarah",
    "couple": { "groom": {...}, "bride": {...} },
    "events": [ {...}, {...} ],
    "gallery": [ {...} ],
    "bank_accounts": [ {...} ],
    "quote": { "text": "...", "source": null },
    "settings": { "enabled_sections": ["hero","couple","event","gallery","gift","rsvp"], "rsvp_enabled": true }
  }
}
```

## Notes
- `PATCH` is partial (JSON merge); fields not included are left unchanged.
- All free-text input is sanitized server-side before saving (see SECURITY/08).
- `POST /publish` returns a 422 with `details[]` listing the missing fields if validation fails (BR-4.2).
