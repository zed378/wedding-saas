# P0-19 — Test harness

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-19 |
| **Phase** | Phase 0 |
| **Surface** | backend, web-app |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-19-test-harness` |
| **Status** | Completed |

---

## What Changed

Four test layers, each with a real passing test: unit (existing), integration with automatic migrations and a containerised fallback, E2E over HTTP, and accessibility with axe. Plus the factories — `createTwoTenants()` chief among them — and a demonstration IDOR test.

**It found two real bugs, one of which was a crash on startup.** Details below; they are the most valuable part of this record.

## Why

`docs/SECURITY/05` requires an IDOR test for **every** `:id` endpoint with zero tolerance for regressions. What decides whether those get written is not diligence — it is whether the setup is one line or twenty. The card says so outright, and `createTwoTenants()` exists for exactly that reason.

## How

**The harness prefers an existing database and falls back to a container.** A five-second container start on every `test:integration` is precisely the friction that stops people running them. Migrations are applied automatically, so a suite can never run one revision behind — a failure mode that produces errors looking like bugs in the code under test, and an hour spent in the wrong file.

**It fails rather than skips.** Verified: with nothing reachable and Docker unavailable, `vitest` exits **1**. Worth noting the output says "15 skipped" because `beforeAll` threw — the run fails, but a human scanning the summary could misread it. The exit code is what `verify.sh` and CI act on.

**Factories name the parties `alice` and `mallory`** — the cryptography convention for the honest party and the active attacker. A test reading `findOwned(alice.invitation.id, mallory.user.scope)` states the attack in its own arguments, with no comment needed.

**Each tenant gets their own template version.** Sharing one would be cheaper and would hide a real bug class: a query filtering by template rather than owner passes a shared-template test and leaks in production.

**The accessibility layer has a negative control.** An axe suite that only ever sees a correct page proves nothing — it reports zero violations whether it is working or doing nothing at all. A deliberately broken fixture, with the expected violations named rather than counted, is what makes the passing test meaningful.

**Providers are mocked at the HTTP boundary with an abort-by-default catch-all.** Anything to a third party that is not explicitly routed is refused. A test that quietly reaches a real provider because nobody wrote a route for it is the failure this prevents — and a sandbox charge is still a charge someone reconciles.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/test/support/harness.ts` | Container-or-existing database, auto-migrate, auto-seed |
| `backend/api/test/support/factories.ts` | Six factories including `createTwoTenants` |
| `backend/api/test/integration/harness.itest.ts` | 15 tests |
| `e2e/` | New package: Playwright, provider mocks, two suites, two fixtures |
| `backend/api/src/shared/logging/logger.ts` | **Crash fix** — see below |
| `backend/worker/src/logger.ts` | Same fix |
| `backend/api/Dockerfile` | **Stale-image fix** — two workspace members were missing |
| `pnpm-workspace.yaml` | `e2e` added; three optional native builds decided |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Prefer an existing database over a container | A container start per run is the friction that stops people running tests | — |
| Migrations applied by the harness, every time | A suite one revision behind fails in the wrong file | — |
| `alice` / `mallory` naming | The test states the attack in its arguments | — |
| A template version per tenant | A shared one hides owner-vs-template filter bugs | — |
| A deliberately broken accessibility fixture | Otherwise the passing test proves nothing | — |
| Provider mocks abort by default | An unrouted third-party call must not silently succeed | — |
| Browser matrix behind `E2E_FULL_MATRIX` | Three browsers per change costs 3× wall clock for a signal that rarely differs | — |

## Deviations from `docs/`

None. Two scope limits are stated rather than hidden: `P0-22` builds the frontends, so E2E exercises the API over HTTP rather than a page, and the accessibility suite audits fixtures rather than real pages. Both are real tests that would fail if the runner were misconfigured — but neither is auditing something a user will see, and the config says so at the top.

## Tests Added

15 integration + 7 E2E; 184 integration and 113 unit across the API.

| Group | Cases |
|---|---|
| Harness | every journal migration applied; master price tables seeded; **two deliberately identical isolation tests** |
| Factories | scope pre-built; unique emails; user-or-id accepted; template auto-created; JSONB round trip; orders and media attach |
| `createTwoTenants` | two users, two invitations, **separate template versions**; **Mallory cannot read Alice's invitation**; her list excludes it; **she cannot reach Alice's child rows through her own parent** |
| E2E | liveness; request-id header; **security headers actually delivered**; error envelope over the wire; readiness names its dependency without leaking why |
| Accessibility | no violations on a correct page; **violations on a broken one — the negative control** |

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| IDOR is cheap to test | `docs/SECURITY/05` | `createTwoTenants()` is one line; three IDOR tests written on top of it |
| Security headers reach the client | `docs/SECURITY/08` | Asserted over real HTTP — closing the gap the `P0-13` record named |
| Errors leak nothing over the wire | `docs/SECURITY/08` | Envelope asserted from a real response |
| Readiness discloses no infrastructure | `docs/DEVOPS/05` | `ECONNREFUSED` asserted absent from a live response |
| Tests cannot reach a real provider | — | Abort-by-default catch-all route |

## What Did Not Work

Two real bugs, both found by running against the built artefact rather than the source. Neither was visible to any existing test.

**1. The API crashed on startup in the container.**

`pino-pretty` is a devDependency, so `pnpm deploy --prod` strips it from the runtime image. `deploy/docker-compose.yml` runs that image with `NODE_ENV=development`, because it is a local stack. The logger chose its transport on `NODE_ENV`, so it tried to load a module that was not there and **pino threw during module initialisation** — the process exited before serving a request.

`NODE_ENV` was the wrong signal entirely. The right question is whether `pino-pretty` can be resolved, which is now what it asks. Structured JSON is the fallback, which is what production wants anyway — degrading is strictly better than refusing to start.

This existed from `P0-12` and nothing caught it, because every test until now ran against source.

**2. `backend/api/Dockerfile` was two workspace members out of date.**

It lists each member's `package.json` by hand so the dependency layer caches on manifests alone. `P0-16` added `packages/storage` and this task added `e2e`; neither was added to the list. The result was not an error — the image built, and the running container was whatever the cache last produced. The E2E suite found it by asking the API for `/readyz`, a route that had existed since `P0-13`, and getting a 404.

The cost of the hand-maintained list is now written in the Dockerfile beside it, because the failure mode is silence.

**A smaller one:** Playwright's default `testMatch` is `*.spec.ts` / `*.test.ts`. These files are `*.e2e.ts` to distinguish them from the vitest suites, so `playwright test` reported **"No tests found"** — a green-looking way to run nothing. Fixed with an explicit `testMatch`.

## Follow-Ups and Open Questions

- **Per-test isolation is still truncation, not a transaction.** `docs/TESTING/02` allows either. Truncation is why `fileParallelism: false` remains necessary. A transaction-per-test would be faster and allow parallelism, but requires the code under test to receive the transaction handle — worth revisiting once services exist to pass it to.
- **The shared logging package is still not extracted.** The `P0-15` record said it belonged here. The crash fix above had to be applied **twice**, once per logger, which is the duplication that record predicted. Genuinely deferred again, and now with a concrete cost attached.
- **E2E has no frontend to test.** `P0-22`.
- **`playwright install` is a manual step.** The browsers are a ~115MB download; nothing prompts for it.
- **Nothing runs E2E automatically.** `verify.sh` deliberately does not — it must work with nothing started. With CI deferred (ADR-028), E2E runs only when someone runs it.

## What to Watch

**The Dockerfile's hand-maintained package list will go stale again.** It is the third such list in the repository (with `check-tenant-scope`'s allowlist and the redactor's key set), and all three fail silently. A build that quietly serves last week's code is the worst of them, because everything downstream looks healthy.

**`createTwoTenants()` will be copied and modified.** Someone will want three tenants, or a tenant with no invitation, and will edit this one rather than adding a variant. Every existing IDOR test depends on its exact shape.

**The accessibility negative control is the load-bearing half.** If the broken fixture is ever "fixed" — and it looks like a bug — the remaining test passes on a harness that does nothing.
