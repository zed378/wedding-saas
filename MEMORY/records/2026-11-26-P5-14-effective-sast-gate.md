# P5-14 — Executable local static security analysis

| | |
|---|---|
| Date | 2026-11-26 |
| Task / phase | P5-14 acceptance continuation; Phase 5 |
| Surface / author | Local security tooling and parser-compatible admin JSX; parallel SAST lane |
| Commits / PR | Shared uncommitted working tree; no commit, merge, migration or deployment |
| Status | Bounded SAST gate implemented and passed; overall Phase 5 acceptance remains incomplete |

## What Changed

`scripts/check-sast.mjs` runs the checked-in Semgrep rule tests and scans application source with Semgrep 1.186.0, pinned to Docker image digest `sha256:6e1b04340e60e910fbb4ddbf3c857ab0918f064417ad5ac530014ccb3cf8c8f1`. Findings, analysis errors, tool failures and an empty scan fail the command. Seven AST/taint rules replace the absence of any actual SAST invocation; this is a bounded rule set, not a comprehensive security certification.

Raw ampersands in two existing admin JSX files are encoded as `&amp;`, preserving their rendered text while allowing Semgrep's JSX parser to analyze the whole files. No rendering exclusion or parser-error waiver was added.

## Why

`docs/SECURITY/11-SECURITY-TESTING.md` requires SAST over backend/frontend code, and `docs/DEVOPS/01-CI-CD.md` requires security scanning before merging. P5-14 and the global Definition of Done still lacked an executable local SAST gate while hosted CI remains deferred by ADR-028. Parent work exposes `pnpm check:sast` and invokes the runner from full `scripts/verify.sh`.

## How

The runner snapshots only the rule fixtures and application source with the operating system's `tar` executable into an OS temporary directory. Docker mounts that archive read-only and extracts it into the container filesystem. This preserves path-labelled findings while avoiding Docker Desktop's very slow Windows bind-mount metadata traversal. The archive is deleted on normal Node exit; external termination can leave a `wi-sast-*` directory in the OS temp folder.

The container has no network, no login credentials, no registry configuration and no cloud analysis. Metrics/version checks are disabled. Rule suppression comments are disabled, no accepted-finding baseline exists, and two worker jobs bound scanner concurrency. The first image pull requires network access to download the digest-pinned image; source scanning itself runs offline.

Source scope is `backend/api/src`, `backend/worker/src`, both frontend `src` trees, `admin/src`, and every existing `packages/*/src`. Dependencies, generated output, test files and other tooling are excluded. The runner deliberately does not claim tests/tooling coverage. Existing repository security guards continue to cover their documented policies separately.

## Files and Components Touched

| Path | Change |
|---|---|
| `scripts/check-sast.mjs` | Source snapshot, pinned networkless Docker execution, rule tests, strict JSON report and fail-closed exit |
| `security/semgrep/typescript-security.yaml` | Seven JavaScript/TypeScript AST and intra-procedural taint rules |
| `security/semgrep-tests/typescript-security.ts` | Positive and negative rule cases, including the SQL-callee false-positive regression |
| `security/README.md` | Commands, prerequisites, scope, limits, privacy and image-update discipline |
| `admin/src/components/templates/ThemeEditor.tsx` | Encode JSX text ampersands; displayed labels preserved |
| `admin/src/pages/OrdersPage.tsx` | Encode JSX text/attribute ampersands; displayed labels preserved |
| This record | Evidence, unsuccessful attempts and limits |

Parent owns root manifest/verifier integration, ADR-108, lint fixture exclusion, progress board, phase card, memory index and changelog. Existing changes in the two admin files predate this lane and were preserved.

## Decisions Made

Use Semgrep's local rules and Docker rather than adding a Python installation or sending source to a hosted analysis service. Pin the actual pulled current image by digest. Use a source-only archive instead of traversing a Windows repository mount. Focus taint sinks on the supplied data argument, so calling a database's `.query` method is not itself mistaken for untrusted query data. ADR-108 records the tooling choice together with the parent's lint/coverage/verifier work.

## Deviations from docs/

None. SAST tools are examples, freely chosen by the team in SECURITY/11. Hosted CI remains deferred and independent reviewer approval remains required. No product, endpoint, database, ownership or payment contract changed.

## Tests Added and Run

| Layer / command | Actual result |
|---|---|
| Semgrep rule fixtures, final pinned image | 7/7 rule suites passed; positive detections and negative cases retained |
| Final `rtk proxy node scripts/check-sast.mjs` after JSX formatting | Passed: 425 files scanned, 0 findings, 0 analysis errors |
| Scanner JavaScript syntax | `node --check scripts/check-sast.mjs` passed |
| Focused Prettier | Runner, YAML, fixtures and README passed; Prettier then wrapped changed JSX labels and the final strict scan passed afterward |
| Verifier shell syntax | `bash -n scripts/verify.sh` inside the pinned Docker image passed, exit 0 |
| Admin typecheck/build/lint | Parent reports final passing runs after JSX entity changes; parent record owns exact commands and totals |
| Full unit, SQL, browser, dependency, coverage gates | Parent and other lanes own them; not claimed as this lane's executed evidence |

No new unit/integration/E2E application behavior was introduced. The rule fixtures are executable security tests, not production source; their intentional malicious/unbound expressions are excluded only from ordinary lint.

## Security Verification

| Control | Named rule fixture evidence and limit |
|---|---|
| Dynamic JavaScript execution | `dynamic-code-execution`: eval/new Function flagged; JSON.parse allowed |
| Shell command-string API | `shell-command-string`: aliased exec import and namespace exec flagged; fixed execFile argument list allowed |
| TLS certificate verification | `disabled-tls-verification`: false option/environment bypass flagged; true option allowed |
| JWT signing | `unsigned-jwt`: unsigned algorithm config flagged; RS256 config allowed; this does not verify live token validation |
| Weak digest | `weak-md5-digest`: MD5 flagged; SHA-256 allowed; does not certify every KDF parameter |
| SQL injection patterns | `request-data-to-raw-sql`: request-query concatenation into sql.raw flagged; constant SELECT 1 and parameter-bound pool.query allowed |
| DOM HTML injection patterns | `request-data-to-dom-html`: request-body innerHTML, location hash document.write and raw `__html` value flagged; textContent allowed |
| Object ownership, payment source, upload pipeline, stored sanitization | No source control changed. These require existing named runtime/SQL/browser tests; the scanner does not prove them |

Taint rules are intra-procedural and recognize request/body/query/params and location sources; they do not trace arbitrary Nest DTO fields across methods. Reviewed static HTML and escaped JSON-LD remain analyzable without blanket file suppressions.

## Abuse Cases Covered

The seven named fixture suites detect the dangerous constructs above and verify safe counterexamples. The SQL regression catches the initial false positive caused by including the `.query` callee in the sink. No new endpoint, accepted field, stored free text, role bypass or payment-state writer exists; IDOR/mass-assignment/upload application abuse cases therefore remain in their existing feature tests rather than invented tests for this tool change.

## Definition of Done Verification

This scoped tool change has real rule tests, a passing full in-scope scan, parser-error handling, documentation and this record. New-endpoint IDOR, response-envelope, lifecycle-audit, request whitelisting and text-storage requirements are not applicable because no application contract or storage path changed. The runner prints finding locations/messages, not source content or credentials. Source snapshots contain application source and must be treated like the checkout.

No global DoD item was waived: full combined verification, reviewer approval and overall phase acceptance remain parent-owned. Parent updates the board, phase file, memory index and changelog alongside this record. A zero-finding bounded SAST scan does not authorize production release or mark Phase 5 complete.

## What Did Not Work

No graph/JevGraph tools were exposed, so discovery used bounded local reads after parent catalog inspection. Semgrep was not installed natively. A bootstrap image 1.100.0 was downloaded before the current 1.186.0 image became available; the final runner and evidence use only the latter pinned digest. The initial YAML JSX sink syntax failed rule parsing and was corrected before acceptance. Matching an `__html` property also covers raw React HTML without relying on unsupported JSX ellipsis syntax.

Direct Windows repository mounts left Semgrep's core process in `p9_client_rpc` disk sleep for minutes. Those exploratory scans were stopped and are not passing evidence. The source archive approach completed the final complete rule-test/scan invocation successfully. Its first attempt used `mkdir /src`, but the image already contains that work directory; `mkdir -p` corrected this.

The first completed scan returned three false positives and two parser errors. Focusing the SQL sink on its argument and adding safe pool.query fixtures removed the false positives. Encoding raw JSX ampersands removed all parser errors without suppressing files. Prettier was run after entity encoding and the final strict scan repeated successfully.

## Follow-Ups and Open Questions

Keep the image digest and local rules under review as part of P0-17/Phase 6 security work. Full repository test/tooling scanning, broader rule coverage, inter-procedural dataflow and manual pre-launch review remain outside this bounded gate. Parent board/backlog retains remaining global gate and phase-review work; no product question was introduced.

## What to Watch

Future syntax unsupported by the parser will fail this gate, so resolve syntax compatibility or deliberately upgrade the pinned analyzer rather than ignoring errors. New source roots outside the documented locations must be added to the runner. Interrupted scans can leave a source archive in OS temp; remove that specific temporary directory when no runner uses it. Docker/tar availability failures must stay visible failures rather than successful skips.
