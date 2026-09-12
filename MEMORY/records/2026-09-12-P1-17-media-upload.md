# P1-17 — Media upload, the synchronous validation stage

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-17 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-17-media-upload` |
| **Status** | Completed |
| **Spec** | `MEMORY/specs/P1-17-media-upload.md` (written before implementation) |

---

## What Changed

`POST /invitations/:id/media` and `GET /media/:media_id`. An upload is admitted only after
five checks, stored in the isolated staging bucket under a server-generated UUID, recorded as
`processing`, and handed to the worker. The client polls the second endpoint.

`media` was also added to `scripts/check-tenant-scope.mjs`'s guarded list. It was missing, and
a `media` row with a non-null `invitation_id` is a couple's photo.

## Why

`docs/SECURITY/06-FILE-UPLOAD-SECURITY.md` layers 1-5, 8 and 9, and `docs/BACKEND/04` Stage 1.
The split between this task and `P1-18` is the document's own: the cheap checks run inside the
request and the expensive, dangerous ones — malware scan, decode, EXIF strip — run in a
resource-capped worker.

## How

**The bytes decide; nothing else does.** A filename is a string the client chose and a
`Content-Type` is a header the client typed. `file-format.ts` checks the extension because it
is free and rejects most accidents, logs a `Content-Type` disagreement because
`docs/SECURITY/06` layer 1 asks for the header to be consulted and not trusted, and refuses on
the magic bytes because that is the only input the file itself has to satisfy.

**Every content rejection carries the same code and the same message.** Telling a caller which
layer refused them is telling an attacker which layer to work around next, and it is of no use
to someone whose photo is simply not a jpg. A test asserts the two paths are indistinguishable.

**The filename cannot reach a path**, rather than being sanitized out of one. The object is
`uploads/{media_id}` via `stagingKey()`, which accepts nothing but a UUID, and
`scripts/check-storage-paths.mjs` refuses a hand-assembled key anywhere in the repository. A
mutation interpolating `originalname` is caught by the guard *and* by two tests.

**The quota is enforced under a row lock.** `SELECT … FROM invitations WHERE id = ? AND
owner_id = ? … FOR UPDATE`, then the count, then the insert, in one transaction. A
count-then-insert cannot cap anything: under READ COMMITTED every concurrent reader sees 199
and every one of them is right. The owner predicate rides on the same statement, so a
non-owner takes no lock, learns no count and inserts nothing.

**Nothing is written to `user-media`.** BR-8.2: every file is reprocessed before permanent
storage. A test asserts the permanent bucket is untouched, because "this stage cannot publish"
is the property that makes the staging bucket worth having.

**The order is validate → insert → store → enqueue.** Validation first so a rejected upload
never touches the database. The store happens *after* the transaction commits, because holding
a lock across a network write to object storage would make every upload to one invitation wait
for the slowest thing in the request — and if it fails, the row is set to `failed` rather than
left `processing` for a status that can never change.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/media/file-format.ts` | **New** — layers 1-3, no dependency |
| `backend/api/src/modules/media/media.service.ts` | **New** — Stage 1 |
| `backend/api/src/modules/media/media.controller.ts` | **New** — both endpoints, plus `UploadErrorInterceptor` |
| `backend/api/src/modules/media/media.module.ts` | **New** |
| `backend/api/src/shared/tenancy/invitation-repository.ts` | `insertMediaWithinQuota`, `findOwnedMedia`, `markMediaFailed`, `MediaRow` |
| `scripts/check-tenant-scope.mjs` | **`media` added to GUARDED** |
| `backend/api/src/http/errors.ts` | `ValidationError` takes a closed-union `code` |
| `backend/api/src/config/env.schema.ts`, `.env.example` | `CDN_BASE_URL`, optional, no default |
| `backend/api/src/shared/sanitizer/registry.ts` | `purpose` registered |
| `backend/api/src/app.module.ts` | `MediaModule` |
| `docs/API/05-MEDIA-API.md` | **Amended** — the single-package limits, the two error-code notes, the by-status response shape |
| `TASKS/PHASE-3-*.md` | step 4b on `P3-11`: the web-server body cap this task cannot set |
| `backend/api/test/file-format.spec.ts` | **New** — 30 tests |
| `backend/api/test/integration/media-upload.itest.ts` | **New** — 27 tests |
| `backend/api/test/media-http.spec.ts` | **New** — 17 tests |

No migration. Every column already existed from `P0-08`.

## Decisions Made

| Decision | Rationale |
|---|---|
| **`media` added to the tenant-scope guard** | A row with an `invitation_id` is tenant data. The table also holds template assets, which is a reason to route access through the tenancy layer rather than an exemption from it |
| No `file-type` dependency | Three formats, twelve bytes. A library would add supply-chain surface to the one path whose whole job is distrusting its input |
| One code for every content rejection | Which layer refused is useful only to an attacker |
| `FILE_TOO_LARGE` is a 400, not the 413 the parser raises | `docs/API/05` says 400, and one rule should not produce two answers depending on where it was caught |
| The quota counts every non-`failed`, non-deleted row, `profile` included | `docs/PLAN/11` says "Max Photos" per invitation without qualifying by purpose. Stated because the other reading is defensible |
| `CDN_BASE_URL` optional with **no default** | A wrong CDN hostname breaks images on every published invitation, and a default is how a placeholder domain reaches production. Unset means the read omits `url` rather than emitting a link it cannot build |
| `ValidationError.code` is a closed union | Matches `UnauthenticatedError`'s existing design: the documented codes only, so no endpoint can invent one |
| The row is inserted before the bytes are stored | An orphan object is invisible and cleaned hourly; an orphan row is visible to its owner as a failed upload. The second is the honest failure |

## Deviations from `docs/`

**`docs/API/05` § Limits named packages that do not exist** ("Basic 5MB, Premium 10MB"),
predating the single-package decision (ADR-023). Corrected to 10 MB uniform, matching
`docs/PLAN/11` and BR-8.1. The two error-code notes and the by-status response shape were
added in the same edit — both were decisions this task had to make and neither was written
down anywhere.

**`docs/SECURITY/06` layer 4 is half-implemented, and the half is named.** The document asks
for rejection "at the request level BEFORE the file is fully received by the server". The
framework half is done — multer stops reading at 10 MB. The web-server half needs Caddy, which
this repository does not have until `P3-11`, so it is written on that card as step 4b rather
than counted as done here.

## Tests Added

74 (30 unit, 27 integration, 17 HTTP). API unit 454 → 501; integration 629 → 656.

| Group | Cases |
|---|---|
| `file-format` | each signature; a GIF; an empty file; a truncated JPEG and PNG; a non-WEBP RIFF; a PHP script; **a polyglot with a JPEG header, asserted ACCEPTED**; extension casing; `.svg`; a dotfile; `shell.php.jpg`; `Content-Type` with parameters, mismatched, absent |
| Accepting | one `processing` row and one staging object; the **canonical** mime type stored, not the claim; `width`/`height` left null; `media.process` enqueued on the media pool; **nothing written to `user-media`** |
| The path | **no part of the client's filename**, tested with `../../../etc/passwd.jpg`; a staging path, never a media path |
| Refusing | a webshell renamed `.jpg`; a spoofed `Content-Type`; a bad extension with valid bytes; oversized; **every content rejection indistinguishable** |
| The quota | the 201st refused; the 200th accepted; a `failed` row frees a slot; a soft-deleted row frees a slot; eight-way race leaves the cap intact; **the upload takes a conflicting row lock**, proved deterministically |
| Storage failure | the row is marked `failed` and no job is enqueued |
| Reading | the `processing` shape has no `url`; the `ready` shape has CDN urls; **no CDN configured omits them**; a soft-deleted photo is 404 |
| IDOR | upload 404 with **no row and no object**; another user's media 404; **a template asset is unreadable**; the repository refuses a foreign scope on the insert; `markMediaFailed` refuses one |
| HTTP | 201 body; three purposes; three bad purposes; no purpose; no file; **oversized → 400 `FILE_TOO_LARGE`**; a second file; 404; 401; 429 |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| A file whose bytes do not match its extension is rejected before staging | Card DoD 1 | `"a PHP webshell renamed .jpg is rejected at the magic-byte check"`, asserting no row **and** no object. **Mutation**: neutering `detectFormat` fails 3 tests |
| An oversized upload is rejected without buffering the body | Card DoD 2 | `"an oversized upload is rejected as 400 FILE_TOO_LARGE"`, asserting the service never saw the full size. Framework half only — the web-server half is on `P3-11` |
| Uploading to another user's invitation returns 404, no row, no file | Card DoD 3 | `"uploading to another user's invitation is 404 and stores nothing"`. **Mutation**: removing the owner predicate fails it and the repository-level test |
| The stored path contains no attacker-controlled string | Card DoD 4 | `"contains no part of the client's filename"`. **Mutation**: interpolating `originalname` is refused by `check-storage-paths.mjs` **and** fails 2 tests |
| `GET /media/:media_id` is ownership-scoped | Card DoD 5 | `"another user's media is 404"` and `"a template asset is not readable through the owner endpoint"`, both through the repository's join |
| Quota cannot be bypassed by parallel uploads | BR-8.1, `SECURITY/06` | `"the upload takes a conflicting row lock on the invitation"`. **Mutation**: removing `FOR UPDATE` fails it |
| Nothing reaches permanent storage before the worker runs | BR-8.2 | `"writes nothing to the permanent bucket"` |
| A failed row does not consume a slot | BR-8.1 | `"a failed upload does not occupy a slot"`. **Mutation**: dropping the `status <> 'failed'` filter fails it |

## Abuse Cases Covered

A `.php` renamed `.jpg`; a spoofed `Content-Type`; path traversal in a filename; upload into
another tenant's invitation; quota bypass by parallel uploads; reading another tenant's media
by id; reading a template asset through an owner endpoint; an oversized file; a second file
smuggled into one request.

**Not covered here, and deliberately**: a polyglot with a valid JPEG header and a script
payload after it is **accepted** by this stage, and there is a test named for that. It is
caught by `docs/SECURITY/06` layers 6 and 10 — the safe decode and the malware scan — both in
`P1-18`. A test asserting it is rejected here would assert a defence this code does not have.

## DoD Verification

- [x] A file whose bytes do not match its extension is rejected before it reaches staging.
- [x] An oversized upload is rejected without the whole body being buffered. **Framework
      level only** — the web-server cap is owed by `P3-11` step 4b, written on that card.
- [x] Uploading to another user's invitation returns 404 and creates no row and no file.
- [x] The stored path contains no attacker-controlled string. Unrepresentable, not sanitized.
- [x] `GET /media/:media_id` exists, is ownership-scoped, and `docs/API/05` is amended.

## What Did Not Work

**1. The concurrency test passed with the lock removed — twice.** The first version fired two
parallel uploads at the quota boundary and asserted exactly one succeeded. It passed with
`FOR UPDATE` deleted. Raising it to eight also passed with the lock deleted: node-postgres and
the foreign key's own `FOR KEY SHARE` happen to serialise the inserts often enough that the
race simply does not occur on this machine. A concurrency test that cannot observe the thing
it is named after is worse than no test, because the board says it passed.

The fix is a deterministic probe rather than more parallelism. A second connection holds
`FOR NO KEY UPDATE` on the invitation row and the test asserts the upload does **not** complete
while it is held. The lock mode matters: `FOR NO KEY UPDATE` conflicts with `FOR UPDATE` and
does *not* conflict with the `FOR KEY SHARE` the media insert's foreign key takes on its own —
so an upload that blocks can only be blocking on the quota lock. A `FOR UPDATE` probe would
have proved nothing, because the FK lock conflicts with that one and the upload would block
either way. The eight-way race is kept, renamed to what it actually asserts: the cap held.

This is the eighth case in this project of a test verifying less than its name suggested, and
the first where the fix required knowing Postgres's lock conflict table.

**2. `media` was not in the tenant-scope guard.** Found while writing `findOwnedMedia`: the
guard did not object to importing the table, which meant any module could have written
`db.select().from(media).where(eq(media.id, id))` and served another couple's photo. The
omission was understandable — the table also holds template assets, where `invitation_id` is
null — and it was still a hole. Added.

**3. `ValidationError` had a fixed code**, so the three 400s `docs/API/05` names could not be
expressed. Widened to a closed union rather than a free string, matching
`UnauthenticatedError`'s existing shape, so no endpoint can invent a code.

**4. Nest turns multer's size limit into a 413.** `docs/API/05` asks for 400 `FILE_TOO_LARGE`.
Because the interceptor throws before the handler runs, a `try` inside the method cannot see
it; `UploadErrorInterceptor` is listed *before* `FileInterceptor` so it wraps it, which is the
only ordering that works.

## Follow-Ups and Open Questions

- **`P1-18` owes the hourly staging cleanup.** Until it exists, a process that dies between
  the insert and the object write leaves a `processing` row forever. Already step 8 on that
  card; naming it here because this task is what creates such rows.
- **`P3-11` step 4b** — the web-server body cap.
- **`P1-19` will need `GET /invitations/:id/media` and `DELETE /media/:media_id`**, the other
  two endpoints in `docs/API/05`. Not on this card and not built.
- **`OQ-19` is answered by `P1-18`'s card**, not by the backlog: step 5 says thumbnail, medium
  and large. `mediaKey` still accepts `original` as a fourth variant. Worth closing the
  question formally when `P1-18` lands.
- **The 200-photo quota counts `profile` photos.** If that proves wrong, the change is one
  predicate in `insertMediaWithinQuota` and a test.

## What to Watch

**The staging bucket must never become web-servable.** Everything here rests on it: a file
that has passed three cheap checks and nothing else sits there under a name an attacker
partially predicted the shape of. `docs/SECURITY/06` layer 9 and `docs/ARCHITECTURE/05`
§ Access Control both say private; the bucket policy is infrastructure, not code, so no test
in this repository can prove it.

**`insertMediaWithinQuota` is the only place the cap exists.** A future "bulk upload" endpoint
that inserts rows another way would bypass it silently — the quota is not a database
constraint and cannot be. If such an endpoint is written, it goes through this method.

**The `media.content_type_mismatch` warning is a signal, not noise.** A steady trickle is
browsers being browsers. A burst from one user is somebody probing what the header does.
