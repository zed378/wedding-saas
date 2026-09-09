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
  "url": "https://cdn.zedth.my.id/invitations/{invitation_id}/media/{media_id}/large.webp",
  "thumbnail_url": ".../thumbnail.webp",
  "width": 1600,
  "height": 1200
}
```

## Limits (see PLAN/11-MEDIA-ASSET-MANAGEMENT.md)
- Max size according to package (Basic 5MB, Premium 10MB per file).
- Formats: jpg, png, webp.
- Total photo count per invitation is limited based on the package, validated by the service before accepting a new upload.

## Error Cases
- 400 `INVALID_FILE_TYPE`, `FILE_TOO_LARGE`, `QUOTA_EXCEEDED`.
- 404 if `invitation_id` (or `media_id`) doesn't belong to the current user — never 403, which would confirm the resource exists (API/00 § 403 vs 404, SECURITY/05).

## Security
See SECURITY/06-FILE-UPLOAD-SECURITY.md — mandatory validation must include a magic-byte check, not just the extension/MIME header from the client.
