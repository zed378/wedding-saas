# 06 - File Upload Security

For all photo uploads (couple profile photos, gallery, cover). See the technical pipeline in BACKEND/04-FILE-PROCESSING.md.

## Validation Layers (ALL MANDATORY, not pick-one)
1. **MIME validation** — check the `Content-Type` header from the request, but it is NOT FULLY TRUSTED (easily spoofed by the client).
2. **Extension validation** — whitelist extensions (`.jpg`, `.jpeg`, `.png`, `.webp`), reject anything else.
3. **Magic-byte validation** — read the first few bytes of the file to confirm the file content truly matches the claimed format (e.g., the `FF D8 FF` signature for JPEG), not another file renamed with a different extension (preventing upload of a webshell/script disguised as an image).
4. **File size limit** — rejected at the request level (e.g., `client_max_body_size`) BEFORE the file is fully received by the server, per the package limits (PLAN/11).
5. **Image dimension limit** — reject extreme dimensions (e.g., > 10000x10000px) that could be used for a decompression bomb/resource exhaustion attack during processing.
6. **Decompression bomb protection** — process resize/decode with strict memory & time limits in the worker; use an image processing library that is safe against crafted files (e.g., libvips with built-in limits), run in an isolated process/container.
7. **EXIF stripping** — remove ALL EXIF metadata (including GPS location, if a photo is taken from a phone — a serious privacy risk, could leak the user's home location) before permanently storing/serving it publicly.
8. **Filename normalization** — the original filename is NOT used as the storage path; use a server-generated UUID/hash (preventing path traversal, command injection via a crafted filename).
9. **Storage isolation** — the storage path includes `invitation_id` (see ARCHITECTURE/05-STORAGE-ARCHITECTURE.md), the bucket is separate from application code (cannot be executed as a script even if a malicious file is successfully uploaded).
10. **Malware scanning** — run antivirus/malware scanning (e.g., ClamAV) on the file before marking it `ready`, especially for a deployment that accepts uploads from the public without strong authentication.
11. **Thumbnail generation & image transformation** — done in an isolated (sandboxed) worker, resize results derived from the ALREADY-VALIDATED source file, not repeatedly reprocessed from the raw input.

## Safe Flow (Summary)
```
Upload received → validation steps 1-5 (synchronous, fast, reject immediately if it fails)
   → save temporarily in an isolated area (not yet public-accessible)
   → async job: validation steps 6-11 (scan, strip EXIF, resize)
   → if everything passes: move to permanent storage, status = ready
   → if it fails at any stage: status = failed, temporary file deleted, NEVER becomes public-accessible
```

## Prohibited
- Serving an uploaded file directly from a path executable by the web server (i.e., never store it in a directory that could serve `.php`/`.js` as executable).
- Trusting the `Content-Type` from the client as the sole validation.
- Storing a photo with EXIF GPS location data without stripping it (a privacy risk regarding the couple's home location).
