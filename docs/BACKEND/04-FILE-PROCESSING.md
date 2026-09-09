# 04 - File Processing Pipeline

Technical implementation of SECURITY/06-FILE-UPLOAD-SECURITY.md and API/05-MEDIA-API.md.

## Stage 1 — Synchronous (within the request/response cycle, must be fast)
```
1. Receive the multipart upload, size limit at the web server/framework level (reject early before the full body is read if it exceeds the limit).
2. Validate the extension (whitelist).
3. Validate the MIME header (Content-Type) — indicative, not final.
4. Read the first few KB → validate the magic-byte matches the claimed format.
5. If it passes: save it to an ISOLATED staging area (not public-accessible), create a `media` record with status='processing'.
6. Enqueue a `media.process` job with the `media_id`.
7. Respond 201 to the client with the `media_id`, `status: processing`.
```

## Stage 2 — Asynchronous (worker, can be heavier/slower)
```
1. Retrieve the file from staging.
2. Run a malware scan (ClamAV or equivalent) — if detected, set status='failed', delete the file, alert (DEVOPS/07).
3. Decode the image using a safe library (libvips/sharp) with a strict memory & time limit — protection against a decompression bomb.
4. Validate dimensions (reject if extreme, see SECURITY/06).
5. Strip EXIF metadata COMPLETELY.
6. Generate variants: thumbnail (e.g., 300px), medium (800px), large (1600px, capped), all in WebP format.
7. Upload the variants to permanent object storage (path: ARCHITECTURE/05-STORAGE-ARCHITECTURE.md).
8. Update the `media` record: status='ready', `width`, `height`, `size_bytes`, delete the staging file.
9. If it fails at any stage: status='failed', the staging file is deleted, log the reason for debugging (without exposing technical details to the end-user, a generic "Failed to process photo, please try again" message).
```

## Idempotency & Retry
- The `media.process` job is idempotent: it can be safely re-run on retry (e.g., a worker crash mid-process), checking the existing state before reprocessing from scratch.

## Resource Isolation
- The media-processing worker runs in a separate container/process with resource limits (CPU/memory cap) — preventing a single malicious/large file from exhausting resources shared with other workers (email, etc.).

## Cleanup
- Staging files that fail/time out (e.g., a worker crash without a chance to set the final status) are cleaned up by a separate scheduled job (e.g., staging files older than 1 hour with no final status are automatically deleted).
