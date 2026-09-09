# 11 - Media & Asset Management

See SECURITY/06-FILE-UPLOAD-SECURITY.md for detailed security controls, and BACKEND/04-FILE-PROCESSING.md for the technical pipeline.

## Media Types
- Couple photos (groom/bride profile photo).
- Gallery photos (multiple).
- Cover/hero photo.
- (Phase 2) Video/background music (audio file for the background music section).
- Template assets (managed by admins, separate from user media — see DATABASE/06-MEDIA.md for the separation between the user `media` table and `template_assets`).

## Limits per Package
| Package | Max Photos | Max Size/File | Formats |
|---|---|---|---|
| Basic | 20 | 5 MB | jpg, png, webp |
| Premium | 200 | 10 MB | jpg, png, webp |

## Upload Pipeline (summary — details in BACKEND/04-FILE-PROCESSING.md)
1. Client requests a presigned upload URL / uploads directly to a backend endpoint (see API/05-MEDIA-API.md).
2. Backend validates: MIME, extension, magic-byte, size (see SECURITY/06).
3. Backend processes: strips EXIF, resizes into several variants (thumbnail, medium, capped original), generates WebP.
4. Stores in object storage (see ARCHITECTURE/05-STORAGE-ARCHITECTURE.md) with a path isolated per invitation (`/invitations/{invitation_id}/media/{media_id}.webp`).
5. Stores a record in the `media` table with status `ready`.
6. Response to the client contains the CDN URL.

## Storage Isolation
- The storage path MUST include `invitation_id` to prevent collisions/predictable paths across tenants.
- Public access URLs use a random ID (UUID), not a sequential integer, to prevent enumeration.

## Deletion
- Soft-delete the media record when a user removes it from the gallery (so it can be restored temporarily); hard-deletion of the physical file is done by an async job after a grace period (e.g., 7 days) — avoiding a race condition with deletion while it's still being served from cache.

## CDN & Delivery
- All media is served via CDN with aggressive cache-control (immutable filenames based on hash/UUID).
- Size transformations (thumbnail vs full) are done at upload time (pre-generated), not on-the-fly per-request, for the MVP (simplifying infrastructure).
