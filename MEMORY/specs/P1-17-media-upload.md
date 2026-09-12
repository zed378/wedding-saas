# P1-17 — Feature Spec: Media Upload, Synchronous Validation Stage

| | |
|---|---|
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-17 |
| **Date** | 2026-09-12 |
| **Author** | Claude Code session |
| **Status** | Draft |

---

## 1. Goal

An owner can upload a photo to their invitation. `POST /invitations/:id/media` accepts the
file only after five synchronous checks, stores it in an isolated staging bucket under a
server-generated name, records it as `processing`, and hands it to the worker. The client
polls `GET /media/:media_id` until the status changes.

Nothing served, nothing public, nothing trusted. This stage's whole job is to decide, cheaply
and inside the request, whether the bytes are worth handing to a decoder at all.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/05-MEDIA-API.md` | whole file | `POST /invitations/:id/media` (multipart, `file` + `purpose`), `GET /media/:media_id` as the polling endpoint, the 201 body `{id, status, purpose}`, and the three 400 codes |
| `docs/SECURITY/06-FILE-UPLOAD-SECURITY.md` | layers 1-5, 8, 9 | The five synchronous checks, filename normalization, storage isolation. Layers 6, 7, 10, 11 are `P1-18`'s |
| `docs/BACKEND/04-FILE-PROCESSING.md` | Stage 1 | The exact seven steps, in order |
| `docs/PLAN/11-MEDIA-ASSET-MANAGEMENT.md` | § Limits per Package | 200 photos per invitation, 10 MB per file, jpg/png/webp — uniform, because there is one package |
| `docs/PLAN/02-BUSINESS-RULES.md` | BR-8.1, BR-8.2 | The quota is a resource control; all files are reprocessed before permanent storage |
| `docs/ARCHITECTURE/05-STORAGE-ARCHITECTURE.md` | § Path Structure, § Access Control | The path carries `invitation_id` for isolation; nothing is reachable by bucket URL |
| `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` | § 1, § 6 | Ownership at the query level; a nested id validated against its parent |

**One conflict, already resolved in `docs/`.** `docs/API/05` § Limits says "Basic 5MB,
Premium 10MB per file", which predates the single-package decision; `docs/PLAN/11` and BR-8.1
say 10 MB uniformly because there is one package (ADR-023). `docs/PLAN/11` wins, and
`docs/API/05` is amended in this task to stop naming packages that do not exist.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-8.1 | 200 photos per invitation, 10 MB each, free draft and paid alike | `InvitationRepository.insertMediaWithinQuota` — counted and inserted under one row lock, so parallel uploads cannot both see 199 |
| BR-8.2 | Every file is reprocessed before permanent storage | This stage never writes to `user-media`. The staging bucket is the only destination, and only `P1-18` may promote |
| BR-1.2 | Users modify only their own invitations | The invitation is locked with an owner predicate inside the same transaction as the insert |

## 4. API Contract

- **`POST /api/v1/invitations/:id/media`** — `multipart/form-data`, exactly two parts:
  `file` and `purpose` (`cover` | `gallery` | `profile`).

  201:

  ```json
  { "data": { "id": "uuid", "status": "processing", "purpose": "gallery" } }
  ```

- **`GET /api/v1/media/:media_id`** — the endpoint the upload flow polls (ADR-021 added it).

  200, shaped by status, because a `processing` row has no dimensions and no URL yet:

  ```json
  { "data": { "id": "uuid", "status": "processing", "purpose": "gallery" } }
  ```

  ```json
  {
    "data": {
      "id": "uuid",
      "status": "ready",
      "purpose": "gallery",
      "url": "https://cdn…/invitations/{invitation_id}/media/{media_id}/large.webp",
      "thumbnail_url": "https://cdn…/thumbnail.webp",
      "width": 1600,
      "height": 1200
    }
  }
  ```

- **Errors**
  - 400 `INVALID_FILE_TYPE` — extension not in the allowlist, or the leading bytes do not
    match a permitted format. One code for both, deliberately: telling a caller *which* check
    rejected them is telling an attacker which layer to work around.
  - 400 `FILE_TOO_LARGE` — over 10 MB, raised by the parser before the body is fully read.
  - 400 `QUOTA_EXCEEDED` — 200 photos already on this invitation.
  - 400 — a missing file part, a missing or unknown `purpose`, more than one file.
  - 404 — the invitation is not the caller's, or the media is not on an invitation that is
    (`docs/API/05` § Error Cases, corrected by ADR-018).
  - 401, 429.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `media` | read + write | One row per upload: `invitation_id`, `uploaded_by`, `purpose`, `status = 'processing'`, `storage_path`, `mime_type`, `size_bytes`. `width`/`height` stay null until `P1-18` decodes the file — this stage never decodes |
| `invitations` | read, `FOR UPDATE` | The quota lock. Not written |

**Migration required: no.** Every column already exists (`P0-08`), including the
`media_status_check` constraint permitting only `processing`, `ready`, `failed`.

**`media` is added to `scripts/check-tenant-scope.mjs`'s GUARDED list.** It was absent, and a
`media` row with a non-null `invitation_id` is tenant-owned data — the same category as
`invitation_gallery`. The omission is understandable (the table also holds template assets,
where `invitation_id` is null) and it is still a hole: any module could have written
`db.select().from(media).where(eq(media.id, id))` and served another couple's photo.

## 6. Authorization

- **Who may call**: the authenticated owner of the invitation. Email verification is not
  required — `docs/API/01` gates publish and checkout, not editing.
- **How ownership is enforced, and where**: at the query level in
  `shared/tenancy/invitation-repository.ts`.
  - Upload: `SELECT … FROM invitations WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
    FOR UPDATE` — the same statement that takes the quota lock. A non-owner finds no row and
    the transaction ends before anything is inserted or stored.
  - Read: a join from `media` to `invitations` with the owner predicate, in one statement.
    This is `docs/SECURITY/05` § 6's two-step rule: the media id is validated against its
    invitation **and** the invitation against its owner, never fetched and then checked.
- **A non-owner receives 404.** So does anyone naming a template asset — a `media` row with
  `invitation_id IS NULL` has no owner and therefore no owner who can read it here.
- **Admin path**: none.

## 7. Validation and Sanitization

Five checks, in the order `docs/BACKEND/04` Stage 1 gives them, cheapest first:

1. **Size**, at the parser. `multer`'s `limits.fileSize` aborts the read at the limit rather
   than buffering the rest, which is layer 4's "before the file is fully received" at the
   framework level. The web-server half — Caddy's `request_body max_size` — does not exist
   yet: there is no Caddy until `P3-11`, and that obligation is recorded on its card rather
   than claimed here.
2. **Extension allowlist** — `.jpg`, `.jpeg`, `.png`, `.webp`, matched case-insensitively on
   the client-supplied filename. The filename is used for *this decision only* and never
   reaches a path.
3. **`Content-Type`** — read, logged, and treated as advisory. `docs/SECURITY/06` layer 1:
   "NOT FULLY TRUSTED". It is checked for consistency with the magic bytes so a mismatch is
   visible, but it never decides on its own.
4. **Magic bytes** — the leading bytes must match a permitted format: `FF D8 FF` for JPEG,
   `89 50 4E 47 0D 0A 1A 0A` for PNG, `RIFF….WEBP` for WebP. This is the check that catches a
   webshell renamed `.jpg`, and it is the only one of the five that looks at content.
5. **Quota** — 200 per invitation, counted under the row lock.

- **Free text**: none. `purpose` is an enum; the filename is not stored. Registered in
  `NOT_USER_TEXT` accordingly.
- **Not accepted from the client**: `storage_path`, `status`, `width`, `height`, `media_id`,
  `invitation_id` (it is a path parameter), `uploaded_by`. Every one of those is server-set.

**The filename never reaches a path.** `docs/SECURITY/06` layer 8. The object is named
`uploads/{media_id}` by `stagingKey()`, which only accepts a UUID — so path traversal in a
filename is not mitigated, it is unrepresentable.

## 8. State Transitions

`media.status` starts at `processing` and is not moved by this stage, with one exception: if
storing the bytes fails after the row is committed, the row is set to `failed` rather than
left claiming a file that does not exist. `invitations.status` is untouched, so
`check-status-writes.mjs` stays satisfied.

## 9. Side Effects

| Effect | When | Why |
|---|---|---|
| `PUT` into the `staging` bucket | after the insert commits | The insert holds the quota lock; holding it across a network write to object storage would serialise uploads on the slowest thing in the request |
| `media.process` enqueued | after the object is stored | A job that arrives before the bytes do finds nothing and fails. `P0-15`'s queue swallows enqueue failures, so the hourly staging cleanup is the backstop |
| `status = 'failed'` | only if the `PUT` throws | An honest row beats a row that promises a file |

**Nothing is written to `user-media`.** The permanent bucket is `P1-18`'s to write, after the
scan, the decode and the EXIF strip.

## 10. Failure Modes

- **Object storage down** — the row is committed and then marked `failed`; the caller gets a
  500 and can retry. The alternative, rolling the row back, loses the record that an attempt
  happened at all.
- **The process dies between the insert and the `PUT`** — a `processing` row with no object.
  The hourly `media_cleanup_staging` job (`docs/BACKEND/04` § Cleanup) is what closes this;
  the job itself is `P1-18`'s, and until it exists such a row stays `processing` forever.
  Recorded as a follow-up rather than left implied.
- **Redis down** — the upload succeeds and the job is lost, because `P0-15`'s producer
  swallows enqueue failures by design. The file sits in staging as `processing` until the
  cleanup job removes it. Acceptable: this is not a payment.
- **Two uploads racing at the quota boundary** — serialised by the `FOR UPDATE` lock on the
  invitation row. The second sees 200 and gets `QUOTA_EXCEEDED`.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| `.php` renamed to `.jpg` | `SECURITY/06` layer 3 | 400 `INVALID_FILE_TYPE`, nothing stored, no row | `"a PHP webshell renamed .jpg is rejected at the magic-byte check"` |
| `Content-Type: image/jpeg` on a non-image | `SECURITY/06` layer 1 | Rejected — the header is not consulted alone | `"a spoofed Content-Type does not rescue bytes that are not an image"` |
| Path traversal in the filename | `SECURITY/06` layer 8 | The filename is discarded; the object is `uploads/{uuid}` | `"the storage path contains no part of the client's filename"` |
| Upload to another tenant's invitation | `SECURITY/05` § 6 | 404, **no row and no object** | `"uploading to another user's invitation is 404 and stores nothing"` |
| Quota bypass by parallel uploads | BR-8.1 | Exactly one of two concurrent uploads at the boundary succeeds | `"two uploads racing at the quota boundary cannot both succeed"` |
| Reading another tenant's media by id | `SECURITY/05` § 1 | 404 | `"another user's media is 404"` |
| Reading a template asset by id | `DATABASE/06` | 404 — no invitation, so no owner | `"a template asset is not readable through the owner endpoint"` |
| An oversized file to exhaust memory | `SECURITY/06` layer 4 | 400 `FILE_TOO_LARGE`, raised at the limit | `"an oversized upload is rejected"` |
| A polyglot: valid JPEG header, script payload after | `SECURITY/06` layers 3, 10 | **Accepted here**, caught in `P1-18` by the malware scan and the decode. Stated so the limit of this stage is on the record | `"a file with a valid header is accepted — this stage does not decode"` |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit | `detectFormat` — each permitted signature; a truncated file; an empty file; a PHP script; a PHP script with a JPEG header prefix; a PNG whose extension says jpg. `allowedExtension` — case-insensitivity, a double extension, no extension |
| Integration | happy path writes one row and one staging object; the object key is `uploads/{media_id}`; quota at 200; the concurrency race; IDOR on upload and on read at both service and repository level; a template asset is unreadable; `status` shaping of the read response; a failed `PUT` marks the row `failed` |
| HTTP | 201 body; multipart with a bad extension; a missing `purpose`; an unknown `purpose`; oversized; 404; 401; 429 |
| Security | the eight abuse cases above, plus a **mutation**: removing the magic-byte check must fail a named test, and removing the owner predicate from the quota lock must fail a named test |

## 13. Observability

`info` on acceptance: `event: "media.uploaded"`, `invitation_id`, `media_id`, `purpose`,
`size_bytes`, `detected_format`. **Not the filename** — it is attacker-controlled text that
would then sit in a log aggregator, which is `P1-04`'s lesson applied before the fact.

`warn` on rejection: `event: "media.rejected"`, with `reason` as a fixed slug
(`extension`, `magic_bytes`, `quota`, `size`) and never the file's bytes or name. A run of
`magic_bytes` rejections from one user is the signal worth alerting on.

## 14. Open Questions

1. **Which variants does `P1-18` produce?** `OQ-19` is still open — `docs/ARCHITECTURE/05`
   says `original | large | thumbnail`, `docs/BACKEND/04` says `thumbnail | medium | large`.
   It does not block this task: nothing here writes a variant. It blocks `P1-18` and the
   `url`/`thumbnail_url` fields of the read response, which are therefore derived from
   `mediaKey()` rather than stored.
2. **Does `purpose: profile` count against the 200?** `docs/PLAN/11` says "Max Photos" per
   invitation without qualifying by purpose, so yes, all rows count. Stated rather than
   assumed, because the opposite reading is defensible and would change the number.
3. **The web-server size cap does not exist.** There is no Caddy in this repository yet
   (`P3-11`). Layer 4 is therefore enforced at the framework only, which is one layer thinner
   than `docs/SECURITY/06` asks for. Recorded on `P3-11`'s card rather than silently
   considered done.
