# P1-18 — Media processing worker

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-18 |
| **Phase** | Phase 1 |
| **Surface** | worker |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-18-media-worker` |
| **Status** | Completed |
| **Spec** | `MEMORY/specs/P1-18-media-processing-worker.md` (written before implementation) |

---

## What Changed

`media.process` and `media_cleanup_staging`, the first two real job handlers in the worker.
An upload left `processing` by `P1-17` is scanned, decoded under limits, stripped of EXIF and
published as three WebP variants — or refused, with the staging file deleted and the row
`failed`.

Along the way, two things the card did not ask for and the product could not work without:
a **producer/consumer queue mismatch** that meant no job the API had ever enqueued could be
consumed, and the worker's first **environment validation**, which refuses to start a media
pool with no malware scanner.

## Why

`docs/BACKEND/04` Stage 2 and `docs/SECURITY/06` layers 5, 6, 7, 10 and 11. `P1-17`
deliberately did none of these: they are the expensive and dangerous half, and they belong in
a resource-capped process rather than in a web request.

## How

**The one invariant is that a file becomes `ready` only after it has been scanned, decoded
and stripped.** Every other decision follows from protecting that sentence. A scanner that
cannot answer raises rather than returning `clean`. A scan failure is retried, not resolved
into a verdict. The permanent bucket is written only after both the scan and the decode pass.
A test asserts the ordering directly by recording which of `scan` and `put` happened first.

**Refuse and retry are different outcomes**, and conflating them is how an unscanned file gets
published. Infected, undecodable, over-sized in pixels and no-staging-object are permanent —
`failed`, no retry, because the answer will not change and three retries of an infected file
is three scans of a file already known to be hostile. An unreachable scanner or a down
database is transient and retried; on the **final** attempt it is written as `failed` so an
owner is not left polling `processing` forever.

**The dimension check runs on the header, before any decode.** `sharp().metadata()` parses a
few hundred bytes; `resize()` allocates width × height × channels. A 40000 × 40000 PNG is a
200 KB file and a 4.8 GB buffer, and the whole point of `docs/SECURITY/06` layer 5 is to
answer it before the allocation. `limitInputPixels` is the second line, not the first.

**EXIF stripping is sharp's default**, which is exactly why the test reads the output bytes
back rather than trusting it. A default is what a later "keep the orientation" change
reverses without anybody thinking about a couple's home address. `rotate()` runs first so the
orientation survives as geometry rather than as data.

**ClamAV is spoken to directly**, 80 lines of `INSTREAM` over TCP. The protocol is: send
`zINSTREAM\0`, length-prefixed chunks, a zero-length chunk, read one line. Every failure —
refused connection, timeout, an unrecognised reply — raises `ScannerUnavailableError` and is
never `clean`.

**The worker validates its environment and refuses to start a media pool without a scanner.**
`MEDIA_SCAN_DISABLED=true` is the development escape hatch, refused outright in staging and
production and logged loudly on every boot where it is used.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/worker/src/media/clamav.ts` | **New** — the `INSTREAM` client |
| `backend/worker/src/media/process-image.ts` | **New** — the dimension gate, the decode, the variants |
| `backend/worker/src/media/media-repository.ts` | **New** — the worker's only database access, raw SQL |
| `backend/worker/src/media/media-process.handler.ts` | **New** — Stage 2, in order |
| `backend/worker/src/media/cleanup-staging.handler.ts` | **New** — the hourly sweep |
| `backend/worker/src/env.ts` | **New** — the worker's environment, and the scanner rule |
| `backend/worker/src/handlers/index.ts` | The first real registrations |
| `backend/worker/src/main.ts` | env validation, deps lifecycle, **the cron queue-name fix** |
| `backend/worker/package.json` | `sharp`, `pg`, `@types/pg` |
| `backend/api/src/infra/queue/queue.module.ts` | **The producer fix** — queue by job name, enveloped payload |
| `backend/api/src/modules/media/media.service.ts` | passes an idempotency key and `relatedId` |
| `deploy/docker-compose.staging.yml` | a `clamav` service; storage and `CLAMAV_HOST` on the media and cron workers |
| `.env.example` | the scanner block |
| `docs/ARCHITECTURE/05` | **Amended** — the variant list, and why the two documents never disagreed |
| `MEMORY/DECISIONS.md` | ADR-055 (variants, closes OQ-19), ADR-056 (queue naming) |
| `TASKS/BACKLOG.md` | OQ-19 moved to Answered |
| `backend/worker/test/media-unit.spec.ts` | **New** — 18 tests |
| `backend/worker/test/media-process.itest.ts` | **New** — 25 tests |
| `backend/worker/test/clamav.itest.ts` | **New** — 5 tests, real clamd |
| `backend/worker/test/queue.itest.ts` | 2 contract tests |
| `backend/api/test/queue.spec.ts` | **New** — 5 tests, the producer's half |

No migration.

## Decisions Made

| Decision | Rationale |
|---|---|
| **Three variants; `original` is another name for `large`** (ADR-055) | `docs/PLAN/11` says it outright — "the retained *original* is the **capped** original from the processing pipeline". Closes OQ-19 |
| **The queue name is the job name** (ADR-056) | The runner consumes one queue per job. Naming by pool meant nothing was ever delivered |
| A media pool with no scanner refuses to start | `docs/SECURITY/00` fails closed. A worker publishing unscanned files looks exactly like a working one |
| `MEDIA_SCAN_DISABLED` exists, and is refused in staging and production | A skipped scan must be a visible choice, never an absent variable |
| The scan is injectable | Otherwise the infected branch is reachable only by feeding real malware to a real container, so in practice it goes untested — and it is the branch that most needs a test |
| Raw SQL and `pg` in the worker rather than Drizzle and the API's schema | The alternative is the first cross-application import in the repository. Two places now know the `media` columns, paid for by an integration test that runs the SQL against the real schema |
| The reason for a failure is logged and not stored | `docs/BACKEND/04` step 9. A `failure_reason` column would reach a customer's screen |
| The cleanup sweep marks the row `failed` as well as deleting the file | Otherwise the owner polls forever and `P1-17`'s quota never gives the slot back |

## Deviations from `docs/`

**`docs/ARCHITECTURE/05` § Path Structure amended** from `original | large | thumbnail` to
`thumbnail | medium | large`, with a note explaining that the apparent conflict with
`docs/BACKEND/04` was two documents using different words for the same file. ADR-055.

Nothing else. `docs/BACKEND/04` Stage 2's nine steps are implemented in its order.

## Tests Added

55 (18 unit, 30 worker integration, 5 real-ClamAV, plus 5 API unit and 2 worker contract
tests). Worker unit 6 → 24; API unit 501 → 506.

| Group | Cases |
|---|---|
| clamd replies | clean; infected with the signature; four unrecognised replies refused; the unavailable error carries no verdict |
| clamd, real | a clean file; **EICAR detected by name**; a 200 KB multi-chunk stream; an unreachable scanner; a timeout |
| The environment | a media pool with no scanner refuses; the refusal names the escape hatch; a configured scanner; disabled in development; **refused in staging and production**; every problem named at once; `general` needs only Redis; `cron` needs the database |
| Publishing | three WebP variants and `ready`; **every variant free of EXIF, GPS included, asserted on the output bytes**; no upscaling; the staging object deleted; `storage_path` points at the permanent large |
| Refusing | **the bomb refused at the header**; the bomb end to end; a polyglot; a missing staging object; a template asset |
| The scan | **an infected file deleted and never ready**; not retried into a different answer; **a clean verdict required before anything is published**; unreachable retries; **never `ready` when the scanner is unavailable**; the final attempt leaves an honest `failed` |
| Idempotency | a second run changes nothing; a `failed` row is not resurrected; a missing row is not an error |
| **The repository alone** | `markReady` refuses a non-`processing` row; refuses an already-`ready` row; `markFailed` refuses a `ready` row; **exactly one of two concurrent `markReady` calls succeeds** |
| The sweep | an upload stranded over an hour is cleared **and its row settled**; one merely in flight is left alone |
| The queue contract | producer: queue named by job, enveloped payload, no `undefined` key, one queue per name, enqueue failure swallowed. Consumer: a job enqueued the API's way reaches the handler; **a job addressed to the pool is never delivered** |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| Stored variants contain no EXIF | Card DoD 1, `SECURITY/06` layer 7, `SECURITY/09` | `"every variant is free of EXIF, GPS included"` — reads the output with sharp **and** greps the raw bytes for the tag text. **Mutation**: adding `.withMetadata()` fails it |
| A decompression bomb never becomes `ready` | Card DoD 2, layers 5-6 | Two tests. **Mutation**: removing the dimension gate fails `"refuses the bomb at the HEADER, not during decode"` — and **only** that one; the end-to-end test passes either way, which is why it exists |
| A malware-flagged file is deleted and never reachable | Card DoD 3, layer 10 | `"an infected file is deleted and never becomes ready"`, plus `"a clean verdict is required before anything is published"`. **Mutation**: moving the scan after the publish fails 4 tests |
| An unavailable scanner never yields `clean` | `SECURITY/00` | `"a file is never marked ready when the scanner is unavailable"`. **Mutation**: failing open fails 3 tests |
| The job is idempotent under retry | Card DoD 4 | Three handler tests plus four repository-level ones. **Mutation**: dropping `WHERE status = 'processing'` fails 3 — and passed all 21 tests before those were added |
| Stranded staging files are cleaned up | Card DoD 5 | Two tests, asserting both the file and the row |
| The scanner protocol actually works | layer 10 | `clamav.itest.ts` against a real clamd, with the EICAR test file |

## Abuse Cases Covered

A decompression bomb; EXIF GPS in a wedding photo; a polyglot that passed `P1-17`; an
infected file; a retried job double-publishing; a scanner outage used to smuggle a file
through; a stale retry resurrecting an abandoned row.

## DoD Verification

- [x] Stored variants contain no EXIF, verified by reading the output file. Both by parsing
      and by searching the raw bytes.
- [x] A decompression bomb fails the job within the resource limit and never becomes `ready`.
- [x] A malware-flagged file is deleted and never becomes publicly reachable. The ordering —
      scan before publish — is asserted directly, not assumed from the source order.
- [x] The job is idempotent under retry. At the handler **and** at the repository.
- [x] Stranded staging files older than an hour are cleaned up, and their rows settled.

## What Did Not Work

**1. No job the API enqueued could ever have been consumed.** The producer added to a queue
named after the **pool**; `JobRunner` creates one `new Worker(jobName)` per job, so it
consumes a queue named after the **job**. The payload disagreed too — raw data where the
runner reads a `JobPayload` envelope. The cron scheduler had the same shape, putting every
repeated job into one `cron-scheduler` queue.

`P1-02`'s eight `notification.send` calls had been going nowhere for six tasks. Nothing
noticed because an unconsumed queue and an unregistered handler are indistinguishable from
outside, and no handler had ever been registered. `P1-18` is the first task where a job had
to actually run, so it is the task that found it. ADR-056; two tests, one on each side,
including one named *"a job addressed to the POOL is never delivered"* that encodes the old
bug as a bug.

**2. The repository's conditional writes were untestable through the handler.** A mutation
removing `WHERE status = 'processing'` from `markReady` passed all twenty-one tests: the
handler returns early on a row that is not `processing`, so the repository's guard is never
what refuses. `P1-12`'s finding for the fifth time — **defence in depth makes each layer
untestable from outside**. Four repository-level tests added, including two concurrent
`markReady` calls where exactly one may win. The mutation now fails three.

**3. The bomb test could not tell where the refusal came from.** Asserting the row ends
`failed` passes whether the refusal came from the header gate or from sharp's own
`limitInputPixels` throwing mid-decode — and those differ by 4.8 GB of allocation inside the
worker. A separate test calls `inspect()` alone and asserts `reason === "dimensions"`.
Removing the gate now fails exactly that test and nothing else, which is the point.

**4. The first EICAR multi-chunk test was wrong, and ClamAV was right.** It appended EICAR
after 200 KB of padding and expected a detection; clamd returned clean. The EICAR
specification defines the signature only within the first 128 bytes of a file, so a padded
copy is genuinely not the test file any more. Rewritten to assert `clean` on a large file —
which still discriminates, because a little-endian length prefix would make clamd wait for a
chunk that never arrives and the call would time out rather than return a verdict.

**5. The staging compose would have refused to boot.** The new environment validation makes
`worker-media` and `worker-cron` require storage credentials, and `worker-media` require a
scanner — none of which `deploy/docker-compose.staging.yml` supplied. Adding the `clamav`
service and the missing variables was part of this task rather than a discovery for whoever
next deploys.

## Follow-Ups and Open Questions

- **The job envelope is declared twice**, once per side, held together by two tests that
  cannot see each other. It wants to be a shared package; `P4-06` is the task that will care,
  because `notification.send` is the next job to get a handler.
- **Two places know the `media` columns.** The worker's raw SQL and the API's Drizzle schema.
  Extracting the schema into a package is the Phase 2 refactor that fixes it.
- **`mediaKey()` still accepts `original`** and nothing produces one. Left alone deliberately
  (ADR-055): `parseStoredKey` must keep accepting it, and narrowing the type is a change to
  `@wi/storage` for no behavioural gain.
- **ClamAV's signature database is never checked for freshness.** A container that has been
  up for three months with a stale database still answers `OK` to everything. `docs/DEVOPS/07`
  should carry an alert on `freshclam` age; raised for `P3-12`'s monitoring work.

## What to Watch

**`MEDIA_SCAN_DISABLED` is the most dangerous variable in this repository.** It is refused in
staging and production and logged loudly wherever it is used, and it is still one environment
file away from publishing unscanned uploads. If the refusal is ever relaxed "temporarily",
that is the moment layer 10 stops existing.

**The EXIF strip is an absence.** `process-image.ts` does not call `withMetadata()`, and
that is the whole control. A future change adding it back — for orientation, for copyright,
for anything — republishes GPS coordinates from a couple's phone onto a public CDN. The test
named `"every variant is free of EXIF, GPS included"` is what stands there.

**A media worker that cannot reach clamd stops publishing anything.** That is correct and it
will look like an outage: uploads pile up in `processing` and fail after three attempts.
The alert to write is on `media.failed` with `reason: scanner_unavailable`, not on the queue
depth, because the queue drains normally while every file fails.
