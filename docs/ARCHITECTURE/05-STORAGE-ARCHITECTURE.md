# 05 - Storage Architecture

## Object Storage
- Use S3-compatible object storage (AWS S3, Cloudflare R2, or self-hosted MinIO) for all media (user photos, template assets).
- At least 2 separate buckets: `user-media` (user photos, isolated per invitation via path) and `template-assets` (admin-managed, mostly read, can have more permissive caching).

## Path Structure
```
user-media/
  invitations/{invitation_id}/media/{media_id}/{variant}.webp
    variant: thumbnail | medium | large

template-assets/
  templates/{template_id}/versions/{version}/assets/{asset_name}
```
The path includes `invitation_id` for isolation & audit purposes, and `media_id` is a UUID (preventing enumeration — SECURITY/06).

## Access Control
- Buckets are **private** by default; public access is only through a CDN with cache-friendly signed URLs OR through a CDN restricted via Origin Access Control — files must never be accessible directly via the bucket URL.
- Uploads occur through the backend (validated first) or via presigned URLs with strict constraints (content-type, size limit, short expiry) — see SECURITY/06-FILE-UPLOAD-SECURITY.md.

**Three variants, and `original` is another name for `large`** (ADR-055, P1-18). This line previously read `original | large | thumbnail`, while BACKEND/04 step 6 generated `thumbnail (300px) | medium (800px) | large (1600px)`. The two were never in conflict: PLAN/11 § Limits says "the retained *original* is the **capped** original from the processing pipeline", and the capped original from step 6 is `large`. One document used the product's word and the other the pipeline's. The raw upload is never retained — BR-8.2 requires reprocessing before permanent storage, and keeping it would keep un-stripped EXIF (including GPS) in a public bucket, which SECURITY/06 layer 7 forbids.

## CDN
- All media & static asset GETs are served via CDN with long cache-control (immutable filenames based on hash/UUID+variant).
- Invalidation is only needed when the user replaces a photo in the same slot (e.g., cover photo) — use filename versioning (not overwrite) to avoid needing active invalidation.

## Backup
- Object storage is generally durable already (e.g., S3's 11 nines), but cross-region replication for `user-media` is still recommended as mitigation against account/bucket-level incidents (see 09-DISASTER-RECOVERY.md).

## Quota & Lifecycle
- Lifecycle policy: files associated with a `hard_deleted` invitation (PLAN/06) are removed from storage via an async job after the retention period, not immediately synchronously upon a delete request (avoiding a race condition with the cache).
