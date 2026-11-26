# P5-14 — Scoped formatting and production dependency gate

| | |
|---|---|
| Date | 2026-11-26 |
| Task / phase | P5-14 acceptance continuation; Phase 5 |
| Surface / author | API/admin test and service formatting; parallel audit agent |
| Commit / PR | Shared uncommitted work; no commit/deployment |
| Status | Scoped formatting complete; global formatting and dependency gates fail |

## What Changed and Why

Prettier corrected four files already touched by the current Phase 5 implementation. P5-14 global acceptance requires actual verification, so the lane checked production dependencies and available lint/SAST tooling without introducing P0-17 infrastructure or upgrading dependencies during another lane's browser build.

## How

The formatter scope was derived from tracked modifications and untracked files under admin, API source/tests and API-client, excluding `admin/src/pages/TemplatesPage.tsx` and all E2E files owned by another lane. All 80 selected files were checked after formatting. Files outside that scope, including pre-existing admin code and agent instruction files, were preserved. Read-only registry lookups established candidate remediation versions.

## Files Touched

| File | Change |
|---|---|
| `backend/api/src/modules/admin/admin-orders.service.ts` | Prettier wrapping only |
| `admin/src/pages/auth-fail-closed.spec.tsx` | Prettier wrapping only |
| `backend/api/test/admin-mfa-session.spec.ts` | Prettier wrapping only |
| `backend/api/test/admin-slug-blocklist.spec.ts` | Prettier wrapping only |
| This record | Gate evidence and limits |

Ignored `tmp/` artifacts contain the formatter runner, selected scope, check/write logs, root formatter output and raw production audit JSON. No manifests, lockfile, dependency versions, endpoints or business logic were changed by this lane.

## Decisions and Deviations

No architecture/product decision or docs deviation. Limit formatting to the current implementation diff so unrelated drift does not bury feature review. P0-17 remains deferred; no new pipeline, scanner or linter was installed. No ADR required for formatter-only changes.

## Verification

| Check | Result |
|---|---|
| Scoped Prettier | 80 files passed; four changed |
| Root `pnpm format:check` | Failed on 95 files, zero in the selected 80-file scope |
| Initial root formatter | 99 files failed during this lane, compared with 100 in the earlier parent record; concurrent feature edits can alter this count |
| Production `pnpm audit --prod --json` | Exit 1: 32 advisories — 4 critical, 10 high, 15 moderate, 3 low |
| Lint availability | API/admin/frontends/config scripts print placeholders; ESLint/Biome absent from PATH and root node_modules/.bin |
| SAST availability | Semgrep absent from PATH and root node_modules/.bin; no configured SAST job found in `.github/workflows/pr.yml` |
| Tests/types/build | Not rerun for formatting-only changes; parent owns feature regression evidence |

Remaining formatter warnings by top-level area: `.agents` 3, `.github` 1, `.kiro` 1, admin 9, backend 47, deploy 4, frontend 27, packages 3. These are outside the selected changed-file scope; the root gate is not certified. Evidence: `tmp/phase5-root-format-20261126.log`, `tmp/phase5-format-scope-20261126.json`, `tmp/phase5-format-check-20261126.log`.

## Dependency Findings and Candidate Remediation

The audit reports dependency advisories, not proof that each vulnerable feature is reachable in this application. No exploitation or broad application compromise claim is made. Raw result: `tmp/phase5-dependency-audit-20261126.json`.

| Critical advisory | Installed | Patched floor reported by audit |
|---|---|---|
| `GHSA-vcvr-r3jv-pc5j` — Next next/og ImageResponse RCE | next 16.3.4 | 16.3.6 |
| `GHSA-jqcg-44mw-7w3h` — proxy-addr IPv4-mapped IPv6 trust subnet IP spoofing | proxy-addr 2.0.7 | 2.0.8 |
| `GHSA-2464-fhr4-w9xw` — Next SVG image optimization RCE | next 16.3.4 | 16.4.1 |
| `GHSA-673q-mjm6-r5xr` — Next use-cache typed-array RCE | next 16.3.4 | 16.4.1 |

High advisories group into multer 2.2.0 (four advisories including async filter and multipart DoS), next 16.3.4 (image SSRF and Server Actions DoS), source-map-js 1.2.1 (indexed map DoS), sharp 0.35.4 (librsvg dependency), zod 4.5.4 (oversized collection memory exhaustion), and body-parser 2.3.0 (compressed-body trailing bytes DoS).

Read-only registry checks confirmed next 16.4.5, zod 4.6.6, sharp 0.35.5, body-parser 2.4.0 and source-map-js 1.2.2 exist. Next 16.4.5 also clears later moderate advisory floors listed in this audit. Nest platform-express 12.6.2 declares multer 2.5.0 and express 5.3.0; express 5.3.0 declares proxy-addr ^2.0.8 and body-parser ^2.3.0, whose refreshed resolution can select 2.4.0. Consistent Nest 12.x updates plus direct Next/Zod/sharp updates and transitive lock refresh are candidates within the chosen major versions. They are recommendations, not executed or validated upgrades. Parent owns dependency decisions and must install/retest actual resolved packages; a lockfile-only update alone cannot establish runtime compatibility.

## Security Verification and Abuse Cases

No authorization, payment, upload, sanitization or public behavior changed by formatter operations. No new security test was added for whitespace changes. Dependency audit establishes known-version findings only; it does not replace named IDOR, webhook-signature, upload-spoofing or stored-XSS regression tests. Those controls remain covered only by the parent-coordinated feature test evidence. No control is newly certified here.

## Definition of Done

Scoped formatter passes. Global format and dependency gates explicitly fail; real lint and SAST remain unavailable. No new endpoint, accepted field, stored text, response contract, status transition or sensitive log was introduced, so feature-specific additions for those controls are not applicable. Shared board/index/backlog and final Phase 5 status remain parent-owned. No requirement waived; this record does not mark P5-14 complete.

## What Did Not Work

Inline Node code through nested PowerShell quoting lost string quotes; a temporary JavaScript file fixed execution. A nested PowerShell pipeline expanded `$_` before the child shell; parsing audit JSON in a temporary Node script avoided shell interpolation. Neither failure changed production files. The full formatter remains red because out-of-scope existing drift was intentionally preserved.

## Follow-Ups and What to Watch

Parent received exact dependency candidates and critical IDs. Resolve and verify production dependencies before declaring the dependency gate passed; ensure updated native sharp binaries and framework outputs are actually installed. Track the 95 remaining formatter warnings and deferred lint/SAST gates explicitly in backlog. No new production runtime risk originates from this lane's formatting-only edits.
