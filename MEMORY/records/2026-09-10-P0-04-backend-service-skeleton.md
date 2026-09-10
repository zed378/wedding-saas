# P0-04 — Backend service skeleton

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-04 |
| **Phase** | Phase 0 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-04-backend-skeleton` |
| **Status** | Completed |

---

## What Changed

`apps/api` is a running NestJS service. It validates its environment before constructing anything, serves the three HTTP surfaces from `docs/ARCHITECTURE/01` at separate mount points, applies the middleware chain with the positions later tasks fill reserved and named in code, and drains in-flight requests on shutdown within a bounded window.

Two things landed that the card did not ask for and that matter more than the skeleton itself: the shared-package boundary is now **proven** rather than assumed, and a build that reported success while emitting nothing was found and fixed.

## Why

`P0-04` is the critical path — `P0-05`, `P0-12`, `P0-13`, `P0-17` and `P0-18` all depend on it, and every Phase 1 module copies its shape.

## How

**Module format had to be settled first.** NestJS runs CommonJS; `packages/*` were ESM with `main: ./src/index.ts`, which the API could not have imported. Rather than defer, the packages now compile to CommonJS in `dist/` with declarations. Deferring would have meant discovering the incompatibility at `P0-20`, when the schema package is load-bearing for publish validation and the editor.

**The shared boundary is asserted, not assumed.** `ReferenceService` imports `SCHEMA_CONTRACT_VERSION` from `@wi/schema` and returns it, and a test asserts the value arrives over HTTP. ADR-004 chose one language for the whole stack on the strength of one argument — that the field-path registry is a shared package rather than two implementations kept in step by discipline. If that import ever stops resolving, the argument is broken, and this is the cheap place to find out.

**Configuration fails loudly and completely.** `loadEnv` validates with Zod, reports **every** offending variable at once, and exits `78` (`EX_CONFIG`). Reporting one at a time means a restart per mistake, which is how people end up commenting out validation. The schema also lists the reserved variables — `DATABASE_URL` (P0-06), `JWT_SIGNING_KEY` (P1-03), `MIDTRANS_WEBHOOK_SECRET` (P3-05) and the rest — each naming the task that makes it required, so an absent variable reads as "not built yet" rather than "someone forgot".

**The middleware chain is documented as an ordering, because the order is a security property.** Rate limiting before authentication means an unauthenticated flood is cheap to absorb; the error mapper last means nothing escapes it. Positions 6, 7 and 8 are reserved with the task that fills them.

**Shutdown releases idle keep-alive sockets but not busy ones.** `server.close()` alone waits on any open connection, so a browser tab holding a keep-alive socket would block a rollout until its own timeout. `closeIdleConnections()` releases exactly those. The timeout is a bound rather than a target: a deploy that hangs because one request will not finish is worse than one that drops it.

## Files and Components Touched

| Path | Change |
|---|---|
| `apps/api/src/main.ts` | Bootstrap, CORS allowlist, helmet, body limits, signal handling |
| `apps/api/src/app.module.ts` | Root module; the middleware chain documented as an ordering |
| `apps/api/src/config/env.schema.ts` | Zod environment contract, `loadEnv`, `ConfigValidationError` |
| `apps/api/src/config/config.module.ts` | Global provider for the frozen, validated environment |
| `apps/api/src/http/surfaces.ts` | The three surface prefixes in one place |
| `apps/api/src/http/request-id.middleware.ts` | Correlation id on every request and response |
| `apps/api/src/http/graceful-shutdown.ts` | Bounded drain |
| `apps/api/src/modules/_reference/` | Controller → Service → Repository, one controller per surface, plus a README |
| `apps/api/{tsconfig.json,tsconfig.build.json,vitest.config.mts}` | Split typecheck and build configs; SWC for decorator metadata |
| `apps/api/test/*.spec.ts` | 16 tests |
| `packages/*/package.json`, `packages/*/tsconfig.json` | CommonJS output to `dist/` with declarations |
| `packages/schema/src/index.ts` | `SCHEMA_CONTRACT_VERSION`, the cross-package assertion |
| `tsconfig.base.json` | `tsBuildInfoFile` moved into `dist/` |
| `pnpm-workspace.yaml` | `allowBuilds` policy for install scripts |
| `.env.example` | Every variable, with the reserved ones commented and attributed |
| `CLAUDE.md`, `AGENTS.md` | Real setup commands; Node version drift corrected |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| CommonJS for `apps/api`, and `packages/*` compiled to CJS | NestJS DI depends on `emitDecoratorMetadata` and the ecosystem assumes CJS; fighting it in the skeleton buys nothing | — |
| Reference module registered only outside production | A reference endpoint on a live public host is an unnecessary surface, however harmless its payload | — |
| `X-Frame-Options: DENY` on the API | helmet defaults to `SAMEORIGIN`; nothing should embed the API, and `docs/SECURITY/08` asks for DENY | — |
| Vitest with SWC rather than esbuild | esbuild does not emit decorator metadata, so Nest DI resolves to `undefined` with an unhelpful error | ADR-016 |
| `tsBuildInfoFile` inside `dist/` | See "What Did Not Work" — this one was a real bug | — |
| Install scripts denied by default via `allowBuilds` | A postinstall is arbitrary code execution at install time, in a repository that will hold payment secrets | — |

## Deviations from `docs/`

None. `docs/ARCHITECTURE/01` § Layering and § Public vs Authenticated Surface, `docs/ARCHITECTURE/03` and `docs/SECURITY/08` are implemented as written.

Two documentation corrections, not deviations: `CLAUDE.md` and `AGENTS.md` still said Node 22 after ADR-004 was corrected to 24 in the `P0-02` record, and their "Setup commands" placeholder was stale now that there is something to install.

## Tests Added

| Layer | What it covers |
|---|---|
| Unit | Configuration: valid environment coerces types; a missing variable throws naming it; **all** offending variables reported at once; malformed values rejected rather than coerced; the returned object is frozen |
| Unit | `gracefulShutdown`: an in-flight request finishes before the promise resolves; new connections refused once draining starts; the timeout bounds a request that never finishes |
| Integration | All three surfaces respond and report their own prefix; the prefixes are distinct; `@wi/schema` resolves across the workspace boundary; a request id is present and unique per request; an unmounted path is 404 |

16 tests, all passing. Runtime behaviour was also exercised by hand against the built output, not only through the test harness: the service started, all three surfaces answered, `Strict-Transport-Security`, `X-Content-Type-Options` and `X-Frame-Options: DENY` were present, and starting with no configuration printed the three missing variables and exited 78.

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| CORS is an explicit allowlist, never `*` | `docs/SECURITY/08` § CORS | Origins come from required, validated configuration — `config.spec.ts` proves the service refuses to start without them |
| Security headers present | `docs/SECURITY/08` § Security Headers | Verified against the running service; `X-Frame-Options: DENY` confirmed by response inspection |
| Surfaces separated at the routing layer | `docs/ARCHITECTURE/01`, `docs/SECURITY/02` | `surfaces.spec.ts` — each surface reachable and reporting its own prefix |
| Request correlation for later redaction and tracing | `docs/DEVOPS/06` § Request Correlation | `surfaces.spec.ts` — id present, unique per request |

No `:id` endpoint exists yet, so global DoD item 2 does not apply. The `:id` guard from `P0-03` was run against this diff and reported no new route with a path parameter — correctly, since the reference controllers take none.

## Definition of Done Verification

- [x] Build and test commands pass on a clean checkout — verified by deleting every `dist/` and the turbo cache, then rebuilding
- [x] The service starts, serves its port, and exits cleanly with in-flight requests completed — the drain behaviour is proven by `graceful-shutdown.spec.ts`; see the note below on signals
- [x] Starting without a required config value fails at startup naming the variable — exit 78, all three missing origins listed
- [x] The three route surfaces are mounted separately and a request to each is covered by a test
- [x] The middleware chain is documented in code with reserved positions named after the tasks that fill them

**One qualification, stated rather than glossed.** The DoD says "exits cleanly on `SIGTERM`". Windows does not deliver POSIX signals — `process.kill(pid, 'SIGTERM')` terminates without running handlers — so a signal-based test would pass in CI and prove nothing on the machine this was written on. What the DoD is actually claiming is a property of `gracefulShutdown`, and that is what the tests assert directly. Signal *delivery* is exercised where it is real: the container stop in `P0-05`.

## What Did Not Work

**A build that succeeded and produced nothing.** After `rm -rf dist`, `pnpm build` reported all tasks successful and emitted no files, and the API then failed to resolve `@wi/schema`. TypeScript's `incremental: true` writes a `.tsbuildinfo` beside the config; deleting `dist` left that state behind, so `tsc` concluded the output was current and did nothing.

This is worth recording because of how it fails. A clean CI checkout has no `.tsbuildinfo` and would have worked, so the bug was invisible from CI and reproducible only locally — and its symptom was a *green* build. Fixed by moving `tsBuildInfoFile` inside `dist/`, so removing the output removes the state that describes it. Verified by deleting `dist` and rebuilding twice.

**Three smaller ones.** pnpm 11 ignores `onlyBuiltDependencies`/`ignoredBuiltDependencies` in `pnpm-workspace.yaml` and uses an `allowBuilds` map instead, written by `pnpm approve-builds`; the unresolved warning made `pnpm install` exit 1, which broke every filtered script through pnpm's pre-run dependency check. TypeScript 7 has removed `moduleResolution: node10`, which the packages did not need anyway — a `package.json` without `"type"` already emits CommonJS under NodeNext. And `rootDir: src` in a config that also included `test/**` made `tsc --noEmit` fail, which is why typecheck and build now use separate configs.

Also: the test environment initially set `PORT=0`, which the schema rejected. The schema is right — a service bound to an ephemeral port in production is unreachable — so the test was fixed, not the constraint. Worth noting as the correct direction: when a test and a constraint disagree, the constraint is usually the thing that was thought about.

## Follow-Ups and Open Questions

- **The reference module is scaffolding and should be deleted** once a real module exists on each surface. Its README says so; the risk is that it quietly becomes furniture.
- **Placeholder build scripts remain** in `worker`, `web-app`, `public-invite` and `admin` — they echo the task that wires them. `pnpm build` therefore still succeeds while building four of six surfaces not at all.
- **The CI workflow still only triggers on `pull_request`.** Raised at the end of `P0-03` and not yet answered: merging locally and pushing `main` runs none of the gates. A `push:` trigger is one line; branch protection is the stricter alternative.
- `@nestjs/config` and `@nestjs/cli` were installed and are unused — the configuration provider is hand-rolled so that validation happens before Nest constructs anything, and the build is plain `tsc`. They should be removed in `P0-17` if nothing has claimed them by then.

## What to Watch

**The `dist/`-and-incremental-state coupling.** The fix works, but the class of bug returns whenever a new package sets its own `outDir` without inheriting `tsBuildInfoFile`, and its symptom is a green build with no artifact. If a deploy ever ships a stale or empty bundle, look here first.

**The shutdown timeout.** It is currently a fixed 10 seconds and nothing observes it. `P0-12` should log the timeout path, and a rising rate of it means requests are outliving what a rollout can wait for — which surfaces as failed deploys or dropped requests long before anyone thinks to look at shutdown.
