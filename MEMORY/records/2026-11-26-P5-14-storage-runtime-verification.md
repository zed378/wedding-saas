# P5-14 — Official pinned MinIO storage integration verification

| | |
|---|---|
| **Date** | 2026-11-26 |
| **Task** | `TASKS/PHASE-5-ADMIN-PANEL.md` § P5-14 acceptance continuation |
| **Phase** | Phase 5 |
| **Surface** | Local storage verification infrastructure |
| **Author** | Parallel dependency/storage verification agent |
| **Commits / PR** | Shared working tree; no commit, merge, deployment or migration |
| **Status** | Storage integration verification completed; overall acceptance remains parent-owned |

## What Changed

Provisioned a disposable loopback-only MinIO process from the official binary of the repository's exact pinned release, `RELEASE.2025-01-20T14-49-07Z`, after the coordinating lane could not pull the Docker Hub or Quay image. Ran the complete existing storage integration suite on Node 24.18.0: one file, nine tests, all pass, process exit 0.

No application source, compose image tag, deployment configuration, manifest or lockfile changed. This record adds a repeatable verified artifact route; it does not replace MinIO with a different S3 implementation or assert that the unavailable container image was tested.

## Why

ADR-011 selects MinIO locally for S3 parity. `packages/storage/vitest.integration.config.mts` and `src/s3-storage.itest.ts` explicitly require real infrastructure because anonymous object denial and private staging cannot be certified by a mock. P5-14's complete local verification could not be considered executed while these tests lacked their real service.

Mandatory task/progress/memory/project/security reading was completed earlier in this lane, and ADR-011, the checked-in compose pin, the storage integration configuration and the relevant named tests were read before provisioning. Graph tools were not exposed in the tool catalog; bounded configuration/source inspection was used.

## How

The official `dl.min.io` Linux and Windows checksum URLs returned HTTP 410 with a notice that open-source MinIO Server, Client and KES are archived and that community/hotfix files are no longer served there. No unofficial mirror was used. The official GitHub API for repository `minio/minio` still listed the exact release and its Windows binary/checksum assets:

- Release API: `https://api.github.com/repos/minio/minio/releases/tags/RELEASE.2025-01-20T14-49-07Z` (release ID `195808175`).
- Binary: `https://github.com/minio/minio/releases/download/RELEASE.2025-01-20T14-49-07Z/minio.windows-amd64.RELEASE.2025-01-20T14-49-07Z.exe`.
- Checksum: the same official binary URL with `.sha256sum` appended.

Downloaded the binary and checksum over HTTPS, compared SHA-256 before execution, then checked the executable's own version. Actual binary identity:

| Property | Verified value |
|---|---|
| Bytes | `119217664` |
| SHA-256 | `ec1bf8de91729ef670abdbc9e743560c4957de251168ce5b48b0ae1154c45d85` |
| Release | `RELEASE.2025-01-20T14-49-07Z` |
| Commit | `827004cd6d3da8f49a5320c94ae74ae128156ed6` |
| Runtime | `go1.23.5 windows/amd64` |
| License shown by executable | GNU AGPLv3 |

Launched the executable as a hidden detached process using only fresh data under the ignored repository `tmp/` directory. API and console bind explicitly to loopback. Queried `/minio/health/ready` and received 200; created `user-media`, `template-assets` and `staging` using the existing AWS SDK with no anonymous bucket policy. Existing integration tests subsequently prove both denied anonymous access and successful authorized access.

## Files and Components Touched

| Path | Change |
|---|---|
| This record | Artifact provenance, exact release/hash, test evidence and lifecycle limits |
| `tmp/minio-release20250120.exe` (ignored) | Official checksum-verified binary |
| `tmp/minio-release20250120-verification.json` (ignored) | Download source, checksum source, size and actual SHA-256 |
| `tmp/start-p5-official-minio-20261126.cjs` (ignored) | Hidden disposable loopback service launcher |
| `tmp/p5-official-minio-20261126.{pid,log}` (ignored) | Process identity and service log |
| `tmp/p5-minio-20261126-data/` (ignored) | Fresh disposable MinIO data; no existing user data mounted |
| `tmp/run-p5-official-minio-storage-20261126.cjs` (ignored) | Supported-runtime integration runner using the explicit endpoint |
| `tmp/p5-official-minio-storage-20261126.log` (ignored) | Full successful suite output |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Obtain the exact official release binary from official GitHub assets | Official download host/image routes unavailable; official release/checksum remained available | ADR-011 unchanged; local verification provisioning only |
| Run native Windows MinIO on loopback with fresh local data | This host is Windows; avoids backend substitution or an unnecessary rebuild | No architecture/deployment change |
| Leave the disposable process running for the coordinating lane | Parent may need the same real object-storage endpoint for final worker/regression evidence | Parent owns final cleanup |

## Deviations from `docs/`

No application, S3 contract, selected storage provider or release-version deviation. Verification used the official Windows binary of the same pinned release instead of the unreachable Linux container image. Therefore this result proves the storage adapter against that native release, not container packaging, Linux filesystem behavior, compose readiness or deployment-image availability.

The upstream archive/maintenance notice is a lifecycle concern for future approved tooling decisions; this verification does not authorize a provider replacement or waive that concern.

## Tests Added and Run

No permanent tests added; the full existing `packages/storage/src/s3-storage.itest.ts` suite ran on actual infrastructure.

Command: `rtk proxy "C:/Users/Zed/AppData/Local/OpenClaw/deps/portable-node/node.exe" tmp/run-p5-official-minio-storage-20261126.cjs`. Runner invokes `vitest run --config vitest.integration.config.mts --maxWorkers=1` from `packages/storage`, with explicit loopback endpoint and disposable development credentials.

| Named test | Result |
|---|---|
| `stores and reads an object back` | Pass |
| `returns null for a missing object rather than throwing` | Pass |
| `treats deleting a missing object as success` | Pass |
| `denies an unauthenticated GET of a real object` | Pass: 403 |
| `denies an unauthenticated GET against the staging bucket` | Pass: 403 |
| `denies listing a bucket anonymously` | Pass: 403 |
| `a signed URL does work, and carries an expiry` | Pass: signed URL includes 60-second expiry and GET returns 200 |
| `does not resolve a staging key inside user-media` | Pass |
| `moves a validated upload out of staging, copying before deleting` | Pass |

Actual output: Vitest 5.1.1, one file / nine tests passed, duration 1.44 seconds, Node v24.18.0, process exit 0. Download and version checks separately succeeded. No integration case was skipped or mocked.

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Private user-media object access | `docs/ARCHITECTURE/05` access control / ADR-011 | `denies an unauthenticated GET of a real object` |
| Unvalidated staging objects not anonymously reachable | `docs/SECURITY/06` / storage task infrastructure DoD | `denies an unauthenticated GET against the staging bucket` |
| No anonymous object enumeration | `docs/SECURITY/06` | `denies listing a bucket anonymously` |
| Authorized signed access with bounded expiry | Storage port contract | `a signed URL does work, and carries an expiry` |
| Separate staging namespace | Upload pipeline separation | `does not resolve a staging key inside user-media` |
| Non-owner 404, input whitelisting, stored-text sanitization, payment authority | `docs/SECURITY/05`, `07`, `08` | Not newly verified here; no application code changed; parent runtime suites remain required |
| Upload magic bytes, malware scan, EXIF stripping, decompression protection | `docs/SECURITY/06` | Not certified by these storage tests; separate worker/media integration required |

The checksum proves consistency with the checksum asset obtained from the same official repository over HTTPS. No independent detached-signature or reproducible-build verification was performed. Development credentials are disposable local fixtures; process binds only to `127.0.0.1`.

## Abuse Cases Covered

Anonymous object fetching, staging access and bucket enumeration are denied by the three named tests above, with authorized signed access as a positive control. The remaining P5-14 admin escalation/MFA/audit cases run in coordinating acceptance suites; this record makes no claim about them. No public application route was added.

## Definition of Done Verification

Existing real-storage integration passed, source provenance/hash/version were checked, and evidence was read back. New resource authorization tests, accepted-body fields, stored-text handling, response envelopes and state-history writes are not applicable to this verification-only addition. No sensitive production input is logged or accessed. Global lint/types/build/API/worker/security gates and overall P5-14 status remain parent-owned; none is waived. Parent integrates this record into the index/changelog/progress and records the upstream maintenance follow-up.

## What Did Not Work

Parent reported denied image pulls from Docker Hub and HTTP 401 from Quay for the pinned image; this lane did not infer availability from either. Direct official `dl.min.io` checksum probes returned actual HTTP 410, so the lane used official GitHub release assets. An initial directory probe looked for nonexistent `packages/storage/test`; the real suite is under `src/`, located from its integration config. No failed probe is represented as passing evidence.

## Follow-Ups and Open Questions

The official archived-project notice merits an explicit upstream lifecycle assessment/backlog entry before any future storage-development tooling change. Container-image retrieval remains a separate environment issue; the native test result does not fix compose pulls. Parent must finish global verification, shared metadata and cleanup. No application-level question was silently decided.

## What to Watch

Temporary process at verification time: PID `17036`, executable absolute path `C:/Users/Zed/Documents/Project/wedding-invitation/tmp/minio-release20250120.exe`, API `http://127.0.0.1:19000`, console binding `127.0.0.1:19001`. Verify process ID still belongs to that exact executable before stopping it; do not terminate unrelated MinIO or broadly delete user data. Data lives only at `C:/Users/Zed/Documents/Project/wedding-invitation/tmp/p5-minio-20261126-data`. No production endpoint or persistent service registration changed.
