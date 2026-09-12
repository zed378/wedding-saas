# 05 - Media API

```
POST   /api/v1/invitations/:id/media           multipart/form-data { file, purpose: cover|gallery|profile }
GET    /api/v1/media/:media_id                  Single media record — used to poll processing status
DELETE /api/v1/media/:media_id
GET    /api/v1/invitations/:id/media            List of media belonging to the invitation
```

`GET /media/:media_id` is the endpoint the client polls between the 201 upload response (`status: processing`) and the file becoming usable (`status: ready`) — see FRONTEND/05-MEDIA-HANDLING.md § Upload Flow. It is scoped to media belonging to an invitation owned by the current user.

## Upload Flow
1. The client POSTs the file directly to the backend (MVP — simpler than a presigned URL flow for a small team; can be migrated to a presigned URL flow in Phase 2 to reduce server load).
2. The backend runs quick synchronous validation (MIME, extension, size) → if it passes, saves it temporarily & enqueues a processing job (resize, strip EXIF, generate variants) — see BACKEND/04-FILE-PROCESSING.md.
3. The initial response contains a `media_id` with `status: processing`; the client polls or receives an event (WebSocket/SSE optional) once `status: ready`.
4. Once `ready`, the CDN `url` becomes available in the response.

## Example Response
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "processing",
    "purpose": "gallery"
  }
}
```
Once complete (via GET media or polling):
```json
{
  "id": "uuid",
  "status": "ready",
  "url": "https://cdn.vizunicum.my.id/invitations/{invitation_id}/media/{media_id}/large.webp",
  "thumbnail_url": ".../thumbnail.webp",
  "width": 1600,
  "height": 1200
}
```

## Limits (see PLAN/11-MEDIA-ASSET-MANAGEMENT.md)
- Max size **10 MB per file**, uniform. There is one package (PLAN/09, ADR-023), so the earlier "Basic 5MB, Premium 10MB" split describes tiers that do not exist.
- Formats: jpg, png, webp.
- **200 photos per invitation**, validated by the service before accepting a new upload. It is a resource control rather than a commercial differentiator (BR-8.1). Enforced under a row lock on the invitation, so parallel uploads cannot each see the same count and both be admitted.

## Error Cases
- 400 `INVALID_FILE_TYPE`, `FILE_TOO_LARGE`, `QUOTA_EXCEEDED`.
- `INVALID_FILE_TYPE` covers both the extension allowlist and the magic-byte check, with the same code and the same message. Which layer refused a file is not told to the caller: it is of no use to somebody whose photo is simply not a jpg, and it is exactly what an attacker needs to know which layer to work around next.
- `FILE_TOO_LARGE` is a **400**, not a 413, even though the limit is enforced by the multipart parser (which raises a 413 internally). One rule should not produce two answers depending on where it happened to be caught.
- 404 if `invitation_id` (or `media_id`) doesn't belong to the current user — never 403, which would confirm the resource exists (API/00 § 403 vs 404, SECURITY/05). A **template asset** — a `media` row with `invitation_id IS NULL` — is also 404 here: it has no owner, so no owner may read it through an owner endpoint.

## Response Shape by Status

`GET /media/:media_id` returns `url`, `thumbnail_url`, `width` and `height` **only once `status` is `ready`**. A `processing` row has not been decoded, so those fields are absent rather than null — an absent field is something a client has to handle, where `url: null` invites it to render one. The URLs are built from the CDN base and the storage path convention (ARCHITECTURE/05), not stored per row; where no CDN is configured they are omitted rather than pointing at a bucket, which ARCHITECTURE/05 § Access Control forbids exposing.

## Security
See SECURITY/06-FILE-UPLOAD-SECURITY.md — mandatory validation must include a magic-byte check, not just the extension/MIME header from the client.
