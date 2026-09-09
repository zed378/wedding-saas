# 05 - Storage Architecture

## Object Storage
- Use S3-compatible object storage (AWS S3, Cloudflare R2, or self-hosted MinIO) for all media (user photos, template assets).
- At least 2 separate buckets: `user-media` (user photos, isolated per invitation via path) and `template-assets` (admin-managed, mostly read, can have more permissive caching).

## Path Structure
```
user-media/
  invitations/{invitation_id}/media/{media_id}/{variant}.webp
    variant: original | large | thumbnail

template-assets/
  templates/{template_id}/versions/{version}/assets/{asset_name}
```
The path includes `invitation_id` for isolation & audit purposes, and `media_id` is a UUID (preventing enumeration — SECURITY/06).

## Access Control
- Buckets are **private** by default; public access is only through a CDN with cache-friendly signed URLs OR through a CDN restricted via Origin Access Control — files must never be accessible directly via the bucket URL.
- Uploads occur through the backend (validated first) or via presigned URLs with strict constraints (content-type, size limit, short expiry) — see SECURITY/06-FILE-UPLOAD-SECURITY.md.

## CDN
- All media & static asset GETs are served via CDN with long cache-control (immutable filenames based on hash/UUID+variant).
- Invalidation is only needed when the user replaces a photo in the same slot (e.g., cover photo) — use filename versioning (not overwrite) to avoid needing active invalidation.

## Backup
- Object storage is generally durable already (e.g., S3's 11 nines), but cross-region replication for `user-media` is still recommended as mitigation against account/bucket-level incidents (see 09-DISASTER-RECOVERY.md).

## Quota & Lifecycle
- Lifecycle policy: files associated with a `hard_deleted` invitation (PLAN/06) are removed from storage via an async job after the retention period, not immediately synchronously upon a delete request (avoiding a race condition with the cache).
