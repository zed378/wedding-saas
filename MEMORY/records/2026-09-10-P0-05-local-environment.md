# P0-05 — Local environment via Docker Compose

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-05 |
| **Phase** | Phase 0 |
| **Surface** | infra |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-05-local-environment` |
| **Status** | Completed |

---

## What Changed

`deploy/` now holds the local stack: PostgreSQL, Redis, MinIO, Mailpit and the API, brought up with one command. The API image is a multi-stage build producing a non-root runtime with no package manager, no source and no dev dependencies. Both object storage buckets are created private on first start, and the API waits for its dependencies to report healthy rather than merely started.

A minimal `/health` endpoint was added because the container healthcheck and compose gating both need one. `P0-13` still owns the full liveness/readiness split.

## Why

`P0-05` is next on the critical path, and the project owner asked for a `deploy/` directory holding the compose stack and Helm charts. This record covers the compose half; Helm is `P0-26`.

## How

**Verified by running it, not by reading it.** The whole stack was built and started, and every Definition of Done item was checked against the running system: `/health` answered `{"status":"ok"}` from the host, the API container reported `healthy` (which is the Docker healthcheck hitting `/health` from inside), `id` in the container returned `node`/`1000`, both buckets listed as `private`, and an unauthenticated `GET` against each returned **403**.

**Two things the stack does deliberately, before there is anything to protect.**

The application connects as `wedding_app`, a role that does not own its tables and has neither `SUPERUSER` nor `BYPASSRLS`. That has no visible effect today. It matters the moment row-level policies exist: a superuser or table-owner connection bypasses every policy silently, and no test fails. Getting the role right now costs one SQL file; getting it wrong later means discovering that isolation was never enforced.

Both buckets are created private and stay private. `docs/SECURITY/06` § Storage isolation and `docs/ARCHITECTURE/05` § Access Control both require that public reads go only through a CDN with origin access control — a bucket readable directly by URL makes every uploaded photo enumerable.

**ClamAV is behind a compose profile.** It downloads a signature database on first start and holds around a gigabyte. Nothing needs it before `P1-18`, and a stack that takes minutes to come up is a stack people stop starting — at which point the whole "one command" property is gone.

**Host ports are overridable.** This was not planned; it was forced by the machine. Three ports (1025, 8025, 6379) were already held by other software, and each one stopped the stack dead. A hardcoded host port turns "something else uses 6379" into "the stack will not start", which is the opposite of what this file exists for. Container ports stay fixed; only the host side moves.

## Files and Components Touched

| Path | Change |
|---|---|
| `deploy/docker-compose.yml` | The stack: postgres, redis, minio, minio-init, mailpit, clamav (profiled), api |
| `deploy/postgres/init/01-app-role.sql` | Unprivileged application role, separate from the owner |
| `deploy/README.md` | How to run it, what the ports are, and the two deliberate choices above |
| `backend/api/Dockerfile` | Multi-stage build, non-root runtime, healthcheck without adding curl |
| `.dockerignore` | At the **context root**, which is the only place Docker reads it |
| `backend/api/src/http/health.controller.ts` | Liveness only — touches no dependency |
| `backend/api/src/app.module.ts` | Registers the health controller |
| `backend/api/test/health.spec.ts` | Two tests |
| `CLAUDE.md`, `AGENTS.md` | Real compose commands |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Minimal `/health` added here rather than waiting for `P0-13` | The container healthcheck and compose gating need one; `P0-13` still adds readiness and the dependency checks | — |
| Liveness touches no dependency | A liveness probe that checks the database restarts a healthy service during a database blip, turning one outage into two | — |
| ClamAV behind a profile | Fast default start; nothing needs it until `P1-18` | — |
| Host ports overridable, container ports fixed | Forced by three real collisions on this machine | — |
| Redis started with `appendonly yes` | It carries the job queue as well as the cache (ADR-009); losing the queue on restart loses enqueued media processing and notifications | — |
| `pnpm deploy --legacy` | The alternative, `inject-workspace-packages=true`, would copy workspace packages into consumers during ordinary local installs too — a stale-copy failure mode in development, traded for a flag in a Dockerfile | — |

## Deviations from `docs/`

None in substance. `docs/DEVOPS/02-CONTAINERIZATION.md`'s illustrative compose snippet still names `./apps/api`, which `P0-25` moved to `backend/api`; the document was left unamended under ADR-027 and this is a second instance of that known divergence, not a new one.

The worker service is not in the compose file yet. `P0-05`'s step 1 lists it, but there are no jobs to run until `P0-15` and a container that starts and idles would be noise. The compose file names the gap explicitly rather than leaving it to be noticed.

## Tests Added

| Layer | What it covers |
|---|---|
| Integration | `/health` returns exactly `{status: "ok"}`; the response contains no other key, because an unauthenticated probe that names versions or hosts is free reconnaissance |

18 tests total, all passing.

**The verification that matters here was not a unit test.** The stack was built and run, and each DoD item checked against it:

| Claim | How it was checked | Result |
|---|---|---|
| `docker compose up` yields an API answering `/health` | `curl` from the host; container status | `{"status":"ok"}`, container `healthy` |
| Runtime container is non-root | `docker compose exec api id` | `node`, uid 1000 |
| Buckets exist and are private | `mc ls`, `mc anonymous get` | both present, both `private` |
| Unauthenticated bucket read refused | `curl` against both bucket URLs | HTTP 403 |
| Startup gated on real readiness | `depends_on: service_healthy` | API started only after postgres and redis were healthy |

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| Storage not publicly readable | `docs/ARCHITECTURE/05` § Access Control, `docs/SECURITY/06` | 403 on unauthenticated GET against both buckets |
| Container runs unprivileged | `docs/DEVOPS/02` § Container Security Principles | `id` in the running container |
| Database role cannot bypass row-level policies | `docs/SECURITY/05` (precondition) | Role created `NOSUPERUSER NOBYPASSRLS` and not the table owner |
| No secret in a committed file | `docs/DEVOPS/00` | Only local-development credentials, labelled as such in the compose header and `deploy/README.md`; real values come from the secret store (`P0-18`) |
| Image carries no build tooling or source | `docs/DEVOPS/02` | Runtime stage copies only `dist`, `node_modules` and `package.json` |

## Definition of Done Verification

- [x] `docker compose up` from a clean checkout yields an API answering `/health`
- [x] Runtime containers run as a non-root user
- [x] No secret value appears in any committed file — only local-development placeholders, explicitly labelled
- [x] Both storage buckets exist and are private; an unauthenticated GET is refused (403)
- [x] `AGENTS.md` § Dev environment documents the real command

Step 1 of the card also lists the worker; deferred to `P0-15` with the reason stated above.

## What Did Not Work

**`.dockerignore` in the wrong place, failing silently.** It was written next to the `Dockerfile`, which is where it looks like it belongs. Docker reads `.dockerignore` from the **root of the build context**, and every image here builds from the repository root because the build needs the workspace. The file was therefore ignored entirely, host `node_modules` was copied into the image, and it overwrote the symlink farm pnpm had created inside — producing `MODULE_NOT_FOUND` on `tsc`, which points nowhere near the actual cause.

**`pnpm deploy` refused to run.** pnpm 10+ requires `inject-workspace-packages=true` unless given `--legacy`. Taking the flag rather than enabling injection was deliberate: injection would change ordinary local installs, and a development-time staleness bug is worse than a flag in a Dockerfile.

**Three port collisions in a row.** 1025, then 8025, then 6379 — each one stopping the stack with a networking error. Fixing them one at a time would have been the wrong move; parameterising every host port was the fix, and the collisions are the reason it now exists.

**A silent `replace` that did nothing.** Registering the health controller used a string replacement without an assertion, the anchor did not match because prettier had rewritten the file to double quotes, and the import was never added. The test failure said `HealthController is not defined`. Every patch in this repository should assert its anchor — a replacement that silently does nothing is worse than one that fails.

## Follow-Ups and Open Questions

- **The worker has no compose service** until `P0-15`.
- **`P0-13` still owns readiness.** `/readyz` checks PostgreSQL and Redis and is what a load balancer should use; `/health` answers only "should I be restarted". The compose healthcheck currently uses liveness, which is correct for a container restart policy but is not a traffic-routing signal.
- **`DATABASE_URL` and `REDIS_URL` are commented out** in the compose environment block, with the task that turns them on named beside each. The stack runs them; the API does not connect yet.
- The image was built for this machine's architecture only. Multi-architecture builds matter when `P0-23` provisions a VPS that may not be `amd64`.

## What to Watch

**The healthcheck is liveness, and compose gates dependent services on it.** That is fine while the API has no dependencies to be un-ready for. Once `P0-06` connects PostgreSQL, a container that is *up* but cannot reach its database will still report healthy, and compose will happily start whatever waits on it. `P0-13`'s readiness endpoint is what closes that, and the compose gate should move to it then — not doing so is the kind of gap that only shows up when a dependency is slow.

**Committed development credentials.** They are labelled, and they are correct for local use. The failure mode is not the file; it is someone copying `docker-compose.yml` as the starting point for a deployment. `P0-23` and the Helm chart should make it obvious that their values come from a secret store, not from this file.
