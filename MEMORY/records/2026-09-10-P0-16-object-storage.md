# P0-16 — Object storage abstraction

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-16 |
| **Phase** | Phase 0 |
| **Surface** | backend, worker |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-16-object-storage` |
| **Status** | Completed |

---

## What Changed

`@wi/storage` — a `StoragePort` with an S3 implementation, an in-memory fake, and a path builder that is the only way to name an object. A third bucket for staging. 47 unit tests and 9 against real MinIO, plus a build guard.

## Why

`docs/ARCHITECTURE/05` says the storage path carries `invitation_id` "for isolation & audit purposes". That one clause turns path construction from a formatting concern into a **tenant isolation control** — and a control that any call site can assemble is not a control. A path built from the wrong variable files one couple's photos under another couple's invitation, and nothing errors.

## How

**A new package, not a folder in the API.** Both surfaces touch storage: the API receives an upload into staging (`docs/BACKEND/04` Stage 1) and the worker writes the variants (Stage 2). The `P0-15` record flagged duplicating the logger across those two packages as a known problem; doing the same thing again a task later would have been choosing it twice.

**The key is a branded type.** `StorageKey` can only be produced by `paths.ts`, and every `StoragePort` method takes one. A caller who has a string does not have a key — so the compiler, not a reviewer, is what stops a hand-built path.

**Every path component is validated, not just formatted.** UUIDs must be UUIDs, versions must be semver, asset names may not contain a separator. The case worth naming is `{valid-uuid}/../../other`: a naive `startsWith` check passes it, and the object lands outside the invitation's prefix.

**There is no `getPublicUrl`.** `docs/ARCHITECTURE/05` § Access Control: files "must never be accessible directly via the bucket URL". A method returning one would be used, and would be the fastest way to undo that. `presignGet` exists instead — time-bounded, five minutes by default.

**`move` copies before deleting, and the order is fixed in the port.** A failed delete leaves an orphan in staging that `media_cleanup_staging` removes within the hour. A delete before the copy would lose the file. Leaving the order to each call site means getting it right every time.

**Staging is a separate bucket, keyed differently.** A file there has passed only the extension, MIME and magic-byte checks — not the malware scan, not the decode, not the EXIF strip. It is not a media object yet, so it must not be reachable from a media path.

## Files and Components Touched

| Path | Change |
|---|---|
| `packages/storage/src/paths.ts` | Branded `StorageKey`, four builders, strict validation |
| `packages/storage/src/port.ts` | The interface; no public-URL method exists |
| `packages/storage/src/s3-storage.ts` | MinIO and R2 through one client |
| `packages/storage/src/in-memory-storage.ts` | A faithful fake |
| `backend/api/src/infra/storage/storage.module.ts` | DI; falls back to the fake in tests |
| `backend/api/src/config/env.schema.ts` | `STORAGE_*`, optional with bucket-name defaults |
| `deploy/docker-compose.yml` | **`staging` bucket, private**; storage env for the API |
| `scripts/check-storage-paths.mjs` | Catches the cast that would bypass the builders |
| `.env.example` | The storage section, with why the buckets are private |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| A shared package rather than a folder per surface | API and worker both need it; `P0-15` already flagged this duplication | — |
| `StorageKey` is branded | The compiler stops a hand-built path; a reviewer might not | — |
| No `getPublicUrl` on the port | A method that returns a bucket URL will be used | — |
| `move` copies then deletes, in the port | An orphan is recoverable; a lost file is not | — |
| Staging is its own bucket with its own key shape | An unscanned file must not be reachable from a media path | — |
| All four variants accepted | Two documents disagree; narrowing now means migrating objects later | `OQ-19` |
| `STORAGE_*` optional, fake in tests | Requiring them means every unit test needs MinIO | — |

## Deviations from `docs/`

**None, but a contradiction found and not resolved.** `docs/ARCHITECTURE/05` § Path Structure lists variants as `original | large | thumbnail`. `docs/BACKEND/04` step 6 generates `thumbnail (300px) | medium (800px) | large (1600px)`. Neither is a superset: `medium` is missing from one, `original` from the other.

The path builder accepts all four. Choosing now would be guessing, and guessing wrong means migrating every stored object — the filename is the cache key (`docs/ARCHITECTURE/05` § CDN), so a rename is not free. `P1-17` decides which are produced when it writes the pipeline. Raised as `OQ-19`; no document amended, because the decision belongs to the task that implements it.

## Tests Added

47 unit (no infrastructure) and 9 integration (real MinIO).

| Group | Cases |
|---|---|
| `mediaKey` | the documented path exactly; all four variants; always `.webp`; unknown variant rejected; **five bad invitation ids including traversal-after-valid-prefix**; bad media id; case normalised; two invitations kept in separate prefixes |
| `templateAssetKey` | documented path; six bad versions; **six bad asset names including `a/b.jpg` and `../../../etc/passwd`**; four good ones |
| `stagingKey` | keyed by media id alone; **shares no prefix with media**; non-UUID rejected |
| `parseStoredKey` | accepts what the builders produce; rejects five malformed values |
| `InMemoryStorage` | round trip; missing returns null; delete idempotent; buckets separate; move copies-then-deletes; expiry bounded |
| **MinIO** | round trip; **unauthenticated GET of a real object → 403**; **staging GET → 403**; **anonymous listing → 403**; **a signed URL works and carries an expiry**; staging separate; move works |

The signed-URL test earns its place: without it, all three 403 assertions would pass against a MinIO that was simply down. It proves the denials are the bucket policy rather than an unreachable endpoint.

The guard was tested both ways — a clean tree passes 55 files, and a probe file doing `` `invitations/${id}/...` as StorageKey `` fails on both patterns.

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| A bucket object is not fetchable directly | `docs/ARCHITECTURE/05` § Access Control | 403 on a real object, against real MinIO |
| Staging is not publicly reachable | `docs/BACKEND/04` Stage 1 step 5 | 403 on a real staging object |
| A bucket cannot be enumerated | `docs/SECURITY/06` | Anonymous listing → 403 |
| Signed access is time-bounded | `docs/ARCHITECTURE/05` | `X-Amz-Expires=60` asserted, and the URL works |
| A path cannot escape its invitation prefix | `docs/ARCHITECTURE/05`, `docs/SECURITY/06` | Traversal cases rejected, including after a valid UUID prefix |
| Callers cannot name an object | task DoD | Branded type at compile time, plus a guard for the cast |
| Storage errors do not leak the endpoint | `docs/SECURITY/08` | Driver errors wrapped in `StorageError`; the cause reaches the log only |

## Definition of Done Verification

- [x] The path scheme matches `docs/ARCHITECTURE/05` exactly and is unit tested
- [x] Callers cannot construct a storage path — branded type, plus a guard against the cast
- [x] A direct request to a bucket object URL is denied — 403, against real MinIO
- [x] The staging area is separate and not publicly reachable — its own bucket, its own key shape, 403

## What Did Not Work

**`StorageError` could not simply declare `cause`.** `Error` already declares it in ES2022, so a parameter property needs `override`. Keeping the name rather than renaming to `underlying` is deliberate: `console.error` and pino both follow `cause` chains, so the driver's real message reaches the log without anything unwrapping it by hand.

**The first `tsconfig.json` compiled the tests into `dist/`.** `exclude` listed `*.spec.ts` but not `*.itest.ts`, so the integration suite — which imports `vitest` — would have shipped in the published package. Caught by adding the second pattern; a build that "worked" would have carried a dev dependency into the runtime.

**The variant contradiction has no clean answer and I did not invent one.** Choosing three names now would look decisive and would be a guess, and because the filename is the CDN cache key, being wrong means rewriting every object rather than changing a constant.

## Follow-Ups and Open Questions

- **`OQ-19` — which variants are actually produced.** `docs/ARCHITECTURE/05` and `docs/BACKEND/04` disagree. `P1-17` decides; the builder accepts anything either sanctions until then.
- **Nothing uploads anything yet.** The port is wired into the API's DI and the worker's dependencies, and no code calls it. `P1-17` is the first consumer.
- **`STORAGE_*` are optional.** That is right for tests and wrong for production, where the in-memory fallback would be silent data loss. `P0-23` must make them required outside development.
- **No lifecycle policy.** `docs/ARCHITECTURE/05` § Quota & Lifecycle wants files for a hard-deleted invitation removed by an async job. The job is `P4-*`; the port has `delete`.
- **No cross-region replication.** Recommended by `docs/ARCHITECTURE/05` § Backup as mitigation for a bucket-level incident. `P0-23`/`P6-*`.

## What to Watch

**The absence of `getPublicUrl` is the security property, and it reads as a missing feature.** The first time someone needs an image URL, adding one will look like an obvious gap rather than a deliberate omission. The port's comment says why; nothing else will.

**`parseStoredKey` is the escape hatch and it will be reached for.** It validates the shape, so it is safe — but it is also the only function that turns a string into a key, and widening its patterns to accept "just this one other case" would quietly reopen the door the branded type closed.

**Staging holds unscanned files.** It is private and separate today. Any future code that grants read access to it — a debugging endpoint, an admin preview — hands out files that have not been through the malware scan.
