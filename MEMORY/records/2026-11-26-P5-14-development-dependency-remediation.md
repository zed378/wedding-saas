# P5-14 — Development dependency gate verification

| | |
|---|---|
| **Date** | 2026-11-26 |
| **Task** | `TASKS/PHASE-5-ADMIN-PANEL.md` § P5-14 |
| **Phase** | Phase 5 |
| **Surface** | Workspace dependency configuration and local verification |
| **Author** | Parallel dependency verification agent |
| **Commits / PR** | Shared uncommitted working tree; no commit, merge, deployment or migration |
| **Status** | Verification completed; overall Phase 5 acceptance remains parent-owned |

## What Changed

Verified the dependency configuration already present at the start of this continuation. Fresh all-dependency and production-only audits both return zero findings, superseding the earlier 43-finding result in `2026-11-26-P5-14-effective-local-gates.md`. This lane made no manifest, override or lockfile change: the updates and scoped overrides were already in the shared working tree, so their authorship and exact installation sequence are not reconstructed here.

Added this record and an ignored local smoke runner/results under `tmp/`. Existing dependency configuration was left intact because it already satisfied the audit gate; no gratuitous update was applied.

## Why

`docs/SECURITY/11-SECURITY-TESTING.md` § Test Types & Cadence requires scanning all dependencies. Global DoD item 9 and ADR-108 make that an actual local verification gate despite the deferred hosted pipeline. The owner requested parallel implementation; this lane investigated the previously recorded gate while other lanes added acceptance tests.

Read the progress board, P5-14 card, memory index, prior production remediation/effective-gate records, project overview/roadmap, task acceptance/E2E specifications and authorization/multi-tenancy/payment security documents. No graph tools were exposed in the available tool catalog; configuration reads and bounded dependency-source reads supplied the evidence.

## How

Ran a fresh audit before changing anything and discovered that the historical finding count no longer represented the current tree. Confirmed installed tool versions, ran an immutable install with lifecycle scripts disabled, repeated audits and exercised the narrow package APIs affected by existing overrides on the selected Node 24 major.

Current installed direct tooling includes Vite 8.3.8, Vitest and coverage-v8 5.1.1, Nest CLI 12.0.15, Nest schematics 12.0.16, Drizzle Kit 0.31.11 and Testcontainers 11.14.0. The checked-in lockfile resolves the already configured scoped overrides to esbuild 0.25.4 for the legacy Drizzle loader, uuid 11.1.1 for Dockerode, glob 14.0.2 for archiver-utils and minimatch 11.0.1 for glob. These are observations of the current graph, not newly chosen versions.

The smoke runner resolves dependencies through each actual consumer rather than resolving an unrelated root copy. It calls the exact legacy `glob.sync` path through `archiver-utils.file.expand`, including an exclusion, checks UUID CommonJS APIs, transforms typed source with the legacy loader's esbuild, creates a real tar archive and pings the local Docker daemon. CLI help/version invocations are read-only; no schema generation or migration runs.

## Files and Components Touched

| Path | Change |
|---|---|
| This record | Current audit/install/runtime evidence, attribution limits and acceptance follow-ups |
| `tmp/p5-development-tooling-smoke-20261126.cjs` (ignored) | Read-only dependency compatibility smoke runner |
| `tmp/p5-development-tooling-smoke-20261126.json` (ignored) | Actual Node 24.18.0 smoke output |

No application source, manifest, lockfile, shared board/index/changelog or production configuration was edited by this lane. The parent coordinates shared metadata so parallel agents do not overwrite each other.

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Leave already passing dependency configuration unchanged | Initial fresh audit was clean; changes solely to demonstrate activity would add risk without fixing a defect | Existing ADR-107/108 policies retained |
| Exercise exact consumer APIs of already present scoped overrides | Overrides cross upstream declared major ranges, so a clean advisory query alone is inadequate compatibility evidence | Parent asked to record the scoped compatibility decision in the next ADR |
| Use available Node 24.18.0 for smoke | Executable version was checked directly; historical records naming 24.22.3 are not evidence of this lane's runtime | No runtime-major deviation |

## Deviations from `docs/`

None introduced by this verification lane. Existing overrides are bounded to the named consumers; no global advisory ignore, severity relaxation, release-age relaxation or install-script policy change was applied. The parent owns the ADR for inherited override choices and must distinguish a bounded API smoke from comprehensive upstream compatibility certification.

## Tests Added and Run

No permanent application test was added because no application behavior changed. The local compatibility assertions exercise dependency APIs rather than mirror application implementation.

| Layer / command | Actual result |
|---|---|
| `rtk pnpm audit --json` | Exit 0; empty advisory map; all severities zero; 905 total dependency entries, including 558 development entries |
| `rtk pnpm audit` repeated | Exit 0; `No known vulnerabilities found` |
| `rtk pnpm audit --prod --json` | Exit 0; empty advisory map; all severities zero; 347 total production/optional dependency entries |
| `rtk pnpm install --frozen-lockfile --ignore-scripts` | Exit 0, no-op; lock/manifests already consistent; parent notified before/after install |
| Recursive `pnpm list ... --depth 0` | Confirms installed direct tooling versions listed above |
| Node 24.18.0 dependency smoke, repeated after adding exact consumer assertion | Exit 0; all seven grouped checks below pass |
| Nest CLI / Drizzle Kit | CLI version 12.0.15 and Drizzle help both load successfully |
| Dockerode uuid | Actual consumer resolves 11.1.1; `v4`, `validate` and `version` work through CommonJS |
| archiver-utils/glob/minimatch | Actual consumer resolves glob 14.0.2 and minimatch 11.0.1; `file.expand` returns only `package.json` with include/exclude patterns; positive and negative minimatch checks pass |
| Legacy Drizzle loader esbuild | Actual consumer resolves 0.25.4; TypeScript transform strips its type annotation and retains the value |
| Testcontainers archive and Docker client | Creates a 3,072-byte tar with the expected member, constructs a container builder and receives actual Docker daemon `OK` ping |
| Application unit, SQL integration, browser E2E, complete build/types | Parent-owned final run after all parallel test edits; no result inferred here |

Audit dependency counts are registry response bookkeeping, not unique package counts. No advisory suppression or audit severity filter was used.

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Known vulnerable dependency gate | `docs/SECURITY/11` § Dependency scanning | Fresh `pnpm audit --json`, repeated plain audit and production audit all exit 0 |
| Immutable dependency installation | Lockfile/tooling policy | `pnpm install --frozen-lockfile --ignore-scripts` exits 0 without manifest/lock changes |
| Object-level authorization / 404 | `docs/SECURITY/05` | No authorization source or new endpoint changed; not newly verified by this lane; parent acceptance tests required |
| Field whitelisting and free-text sanitization | `docs/SECURITY/08` | No input/storage code changed; not established by a package audit |
| Server-authoritative payment state | `docs/SECURITY/07` | No payment code changed; invalid-signature state-invariance remains a parent runtime regression |
| Upload validation pipeline | `docs/SECURITY/06` | No upload policy changed; tar/native-tool smoke does not certify upload validation |

No exploit PoC or dynamic security assessment was run. Zero known-version findings does not prove absence of unknown vulnerabilities or application-level security defects.

## Abuse Cases Covered

P5-14's ordinary-user escalation, role injection, admin invitation-content mutation, MFA bypass, missing step-up and unaudited-write cases are covered by other acceptance lanes. This lane does not claim its audits prove them. The task's dependency-gate continuation is directly covered by the fresh unfiltered all-dependency audit; no new abuse surface was added.

## Definition of Done Verification

1. Appropriate verification layer: registry audit, frozen install and dependency compatibility smoke executed.
2. New `:id` endpoint IDOR tests: not applicable; no endpoint added.
3. Abuse cases: no new input surface; P5-14 runtime abuse tests remain parent-owned.
4. Write-field whitelisting: not applicable to this documentation/verification change.
5. Free-text sanitization: no stored input changed; not newly certified.
6. Response envelope: no response code changed.
7. State-transition logging: no state writer changed.
8. Sensitive logging: runner prints package versions, checks and tar byte count; no secret or connection URL is printed.
9. Dependency gate passes; final lint/types/build/unit/integration/SAST remains parent-owned and is not inferred from these checks.
10. This memory record exists; parent integrates index/changelog and scoped-override ADR.
11. Parent updates progress/phase checklist after coordinated verification. This lane does not mark P5-14 or Phase 5 DONE and waives no unmet item.

## What Did Not Work

The historical 43-finding JSON still exists locally, but using it as the current baseline would have caused unnecessary remediation. A fresh command exposed the stale assumption before mutation. An initial documentation filename probe used `04-AUTHORIZATION.md`; the actual `04-AUTHORIZATION-RBAC.md` was found and read. One optional Dockerode source probe addressed a non-installed version path and returned no content; resolving the package through Testcontainers supplied its real consumer path. None of these failed read probes is treated as passing verification.

## Follow-Ups and Open Questions

Parent must reconcile shared evidence and the remaining acceptance gates, record the inherited scoped override compatibility/risk decision and update the stale progress statement. Existing development-advisory backlog entry can be closed with the measured clean result rather than an expected reduction. Full supported-runtime regression remains necessary after the earlier dependency updates; the bounded smoke does not replace it. No new product question.

## What to Watch

Future consumer or transitive package upgrades may remove or change the APIs exercised here; re-evaluate overrides when refreshing Dockerode/Testcontainers, archiver or Drizzle Kit. Keep audit queries fresh because the advisory database changes. No production deployment occurred, and compatibility on this Windows Node 24 runtime does not establish every platform's native package behavior.
