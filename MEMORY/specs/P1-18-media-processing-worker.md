# P1-18 — Feature Spec: Media Processing Worker

| | |
|---|---|
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-18 |
| **Date** | 2026-09-12 |
| **Author** | Claude Code session |
| **Status** | Draft |

---

## 1. Goal

The asynchronous half of the upload pipeline. `media.process` takes a `media` row that
`P1-17` left in `processing`, and either turns it into three WebP variants in permanent
storage with `status = 'ready'`, or refuses it and leaves `status = 'failed'` with the
staging file deleted. Nothing in between ever becomes publicly reachable.

This is where the expensive and dangerous checks live: the malware scan, the decode under
limits, the dimension rejection and the EXIF strip. `P1-17` deliberately does none of them.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/BACKEND/04-FILE-PROCESSING.md` | Stage 2, § Idempotency, § Cleanup | The nine steps in order, idempotent retry, the hourly staging sweep |
| `docs/SECURITY/06-FILE-UPLOAD-SECURITY.md` | layers 5-7, 10, 11 | Dimension limit, decompression-bomb protection, EXIF stripping, malware scan, isolated transform |
| `docs/SECURITY/09-PRIVACY-COMPLIANCE.md` | EXIF GPS | A couple's photo carries their home location |
| `docs/ARCHITECTURE/05-STORAGE-ARCHITECTURE.md` | § Path Structure | `invitations/{id}/media/{media_id}/{variant}.webp` |
| `docs/ARCHITECTURE/07-QUEUE-WORKER-ARCHITECTURE.md` | § Principles | Idempotent, dead-lettered, run outside the API process |
| `docs/BACKEND/08-JOBS-WORKERS.md` | § Worker pools | `worker-media` is CPU-intensive and scales separately |
| `docs/PLAN/11-MEDIA-ASSET-MANAGEMENT.md` | § Limits, § CDN | 10 MB, three formats, variants pre-generated at upload time |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-8.2 | Every file is reprocessed — resized, EXIF stripped — before being permanently stored | The job writes only derived output. The raw upload is never copied to `user-media` |

## 4. Contract

Not an HTTP endpoint. The job payload is `{ mediaId }`, enqueued by `P1-17`.

**A producer/consumer mismatch has to be fixed first, and it is a real defect.** The API's
`QueueModule.enqueue(pool, name, data)` adds to a BullMQ queue named after the **pool**
(`new Queue("media")`) and passes `data` raw. `JobRunner.start()` creates one
`new Worker(jobName)` per registered job — a queue named after the **job**
(`"media.process"`) — and reads `job.data.data` out of a `JobPayload` envelope.

So today every job the API enqueues lands in a queue nobody consumes, in a shape nobody
would understand if they did. Nothing noticed because no handler has ever been registered:
`P1-02`'s eight `notification.send` calls all go into `"general"` and sit there. `P1-18` is
the first task where a job actually has to run, so it is the task that fixes it.

The fix: address the queue by job name, and wrap the payload in the envelope the runner
already defines. Both sides then agree on two things — the queue name is the job name, and
the payload is `{ data, idempotencyKey?, relatedId?, trace? }` — and each side gets a test
pinning its half.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `media` | read + write | `status`, `width`, `height`, `size_bytes`. `storage_path` is rewritten from the staging key to the permanent prefix |

**Migration required: no.**

**The worker needs database access, which it has never had.** It gets a `pg.Pool` and raw
SQL for the three statements it needs, rather than Drizzle and the API's schema module:
`backend/api/src/infra/db/schema` is inside another application, and importing across
`backend/api` → `backend/worker` would be the first such import in the repository. Extracting
the schema into a package is the right long-term answer and is a Phase 2 refactor, not
something to do inside a media task. The cost — two places that know the `media` columns — is
paid for by an integration test that runs the real SQL against the real schema.

## 6. Authorization

**None, and that is the correct answer here.** A worker is a system actor with no request
and no user. It is reached only by a job id that the API put on the queue after proving
ownership, so the tenancy boundary was crossed in `P1-17` and is not re-crossed here.

Two consequences worth stating rather than discovering:

- The worker's database role is the **application** role, not the owner. It cannot alter
  schema (`P0-06`).
- `scripts/check-tenant-scope.mjs` scans `backend/api/src` only, so nothing stops the worker
  writing an unscoped query. The mitigation is that it has exactly one table and three
  statements, all in one file, all addressed by primary key.

## 7. Validation

Everything `P1-17` could not afford to do inside a request:

1. **Malware scan** (layer 10) — ClamAV `INSTREAM` over TCP to the sidecar. Infected means
   `failed`, the staging file deleted, and a `warn` with the signature name.
2. **Dimension check before full decode** (layer 5) — `sharp().metadata()` reads the header
   only. Over 10000 × 10000 is refused without ever allocating the pixel buffer.
3. **Decode under limits** (layer 6) — `limitInputPixels` and `sequentialRead` on every
   sharp pipeline, in the resource-capped media pool.
4. **EXIF strip** (layer 7) — sharp drops all metadata unless asked to keep it. That is a
   default, and a default is exactly the kind of thing a later "keep the orientation" change
   silently reverses, so a test reads the output bytes back and asserts there is no EXIF.
5. **Variants derived from the validated source** (layer 11) — one decode, three resizes.

## 8. State Transitions

`processing → ready` on success, `processing → failed` on any refusal. `media.status` is not
covered by `check-status-writes.mjs`, which guards `invitations.status`; the constraint that
holds here is `media_status_check`, which permits only those three values.

A job that throws (scanner unreachable, storage down) does **not** set `failed` on its early
attempts — it retries. Only the final attempt marks the row, so a transient outage does not
turn a good photo into a failed upload.

## 9. Side Effects

| Effect | When | Why |
|---|---|---|
| Three objects in `user-media` | after the scan and decode pass | `docs/SECURITY/06`'s safe flow: permanent storage is reached only by validated output |
| The staging object deleted | after the row reaches `ready` **or** `failed` | Either way the raw upload has served its purpose. Deleting before the row is updated would lose the file if the update failed |
| `media_cleanup_staging` hourly | scheduled | For files stranded by a crash between `P1-17`'s insert and this job |

## 10. Failure Modes

| Failure | Behaviour | Reasoning |
|---|---|---|
| ClamAV unreachable | **Throw and retry.** On the final attempt, `failed` | `docs/SECURITY/00` fails closed on anything security-relevant. An unscanned file must never reach `ready` |
| ClamAV not configured at all | The media pool **refuses to start**, unless `MEDIA_SCAN_DISABLED=true` is set explicitly — which is refused outright in staging and production | A skipped scan has to be a decision somebody made and can see, not an absent environment variable |
| The file is not in staging | `failed`, no retry. The row is unprocessable, not unlucky | |
| sharp cannot decode it | `failed`. It passed `P1-17`'s twelve-byte check and is not an image | |
| Storage write fails mid-variant | Throw and retry. A partial variant set is overwritten on the next attempt because the keys are deterministic | |
| The job runs twice | Both runs produce identical objects at identical keys, and the second finds the row already `ready` and returns | `docs/BACKEND/04` § Idempotency |

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Decompression bomb | `SECURITY/06` layers 5, 6 | Refused at the metadata check, before any pixel buffer is allocated | `"a declared 40000x40000 image is refused before it is decoded"` |
| EXIF GPS in a wedding photo | `SECURITY/06` layer 7, `SECURITY/09` | Every variant has no EXIF at all | `"every variant is free of EXIF, GPS included"` |
| A polyglot that passed `P1-17` | `SECURITY/06` layers 3, 10 | The scan or the decode refuses it; it never reaches `ready` | `"a file with a JPEG header and a script payload never becomes ready"` |
| An infected file | `SECURITY/06` layer 10 | `failed`, staging deleted, nothing in `user-media` | `"an infected file is deleted and never becomes ready"` |
| A retried job double-publishing | `ARCHITECTURE/07` | The second run is a no-op | `"a second run of the same job changes nothing"` |
| A scanner outage used to smuggle a file through | `SECURITY/00` | The job retries and finally fails; it never becomes `ready` | `"a file is never marked ready when the scanner is unavailable"` |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit | The ClamAV `INSTREAM` framing — a clean reply, an infected reply, a truncated reply, a connection error. The dimension gate. The variant plan |
| Integration (real Postgres + storage fake) | the happy path writing three variants and `ready`; **EXIF asserted absent by reading the output**; the bomb refused; an undecodable file failed; a missing staging object failed; idempotent second run; scanner-unavailable retries then fails on the last attempt; the staging object deleted in both outcomes |
| Integration (real Redis) | **the producer/consumer contract**: a payload enqueued exactly as the API enqueues it is consumed by the runner and reaches the handler |
| API unit | the producer addresses the queue by **job name** and wraps the payload in the envelope |
| Security | the six abuse cases, plus a **mutation**: removing the EXIF assertion's cause (asking sharp to keep metadata) must fail a named test, and removing the dimension gate must fail a named test |

## 13. Observability

Per-job: `job_name`, `media_id`, `related_id` (the invitation), duration, outcome — the
runner already emits this shape. The handler adds `detected_dimensions`, `variant_count` and
`scan_result`.

Never logged: the file's bytes, its original name (it is not even stored), or the ClamAV
signature database version. A `warn` with the **signature name** on an infection is
deliberate — that is the one thing an operator needs.

## 14. Open Questions

1. **`OQ-19` — which variants?** Answered here rather than left open: `thumbnail` (300),
   `medium` (800), `large` (1600), matching `docs/BACKEND/04` step 6 and `P1-18`'s own card
   step 5. `docs/ARCHITECTURE/05` listed `original | large | thumbnail`; `docs/PLAN/11`
   § Limits resolves the conflict itself — "the retained *original* is the **capped**
   original from the processing pipeline" — which is precisely what `large` is. So there are
   three files, not four, and `original` is a name for `large` rather than a fourth variant.
   Recorded as an ADR and `OQ-19` closed.
2. **The envelope shape is defined in the worker and duplicated by the API.** Fixed for now
   by a test on each side. It wants to be a shared package, which is `P4-06`'s problem when
   `notification.send` gets its handler.
