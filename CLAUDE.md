# CLAUDE.md

Guidance for Claude Code when working in this repository. Read this file first, every session.

## What this project is

A SaaS platform for creating and publishing digital wedding invitations from versioned, data-driven templates. Full product, architecture, API, database, security, UX, and testing specs live in `docs/`. **This repo currently contains specification documents, not yet an implemented codebase** (or is partway through implementation — check `TASKS/PROGRESS.md` before assuming which) — your job is to build the application these documents describe, phase by phase.

## Before writing any code

1. Read `TASKS/PROGRESS.md` first — it is the status board: which phase is active, which tasks are done, which are blocked and on what. Then read the task card you're about to work on in its phase file, and `TASKS/00-TASK-CONVENTIONS.md` if you haven't already this session.
2. Read `MEMORY/MEMORY-INDEX.md` and any record relevant to the area you're touching — it tells you what has already been done and why. Do not re-derive context that's already recorded there.
3. Read `docs/PLAN/00-PROJECT-OVERVIEW.md` and `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` to know what phase we're in and what's in scope.
4. For the feature you're about to touch, read every document listed in the task card's `Spec refs` row — plus the relevant doc in `PLAN/`, `API/`, `DATABASE/`, and `ARCHITECTURE/` — before implementing. The schemas and contracts are already fully specified, don't improvise them.
5. Read `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` and `docs/SECURITY/07-PAYMENT-SECURITY.md` in full at least once. These two documents govern almost every endpoint you'll write.

Do not start writing a feature from memory of "how wedding invitation apps usually work" — this project has specific, deliberate rules (see below) that differ from generic assumptions, and they exist for concrete reasons documented in `PLAN/02-BUSINESS-RULES.md`.

## TASKS and MEMORY — the working discipline

Two folders sit between the specification and the code, and both are mandatory.

`TASKS/` is forward-looking: what will be built, in what order, and how it will be judged done. `MEMORY/` is backward-looking: what was built, what it cost, and what to watch. They are updated in the same commit as the work — a task is not `DONE` until its MEMORY record exists.

### TASKS/

```
TASKS/
├── README.md                How to use the folder, and the phase rule
├── 00-TASK-CONVENTIONS.md   Task IDs, statuses, card anatomy, the global Definition of Done
├── PROGRESS.md              The status board — read this first, every session
├── BACKLOG.md               Open questions, specification gaps, deliberate deferrals
└── PHASE-0..7-*.md          133 task cards across eight phases
```

Pick up work by finding the lowest-numbered `TODO` task in the active phase whose dependencies are all `DONE`. Read its `Spec refs`. If it is marked `Spec required`, write the feature spec from `MEMORY/templates/FEATURE-SPEC-TEMPLATE.md` into `MEMORY/specs/` before writing code. Satisfy the task's own Definition of Done **plus** the 11-item global DoD in `TASKS/00-TASK-CONVENTIONS.md`.

**Never build a Phase N+1 feature while Phase N is incomplete** (`docs/PLAN/16-IMPLEMENTATION-ROADMAP.md`). If a task seems to require it, that is a signal to stop and ask, not to reorder quietly.

If something genuinely isn't answered by `docs/`, it goes in `TASKS/BACKLOG.md` as an open question and gets raised — it does not get decided silently while coding.

### MEMORY/

Claude Code has no memory between sessions unless it is written down. Because this project is built incrementally across many separate sessions, possibly by different people or different agent runs, `MEMORY/` is not optional bookkeeping — it is how continuity happens at all. Treat writing to it as part of the task, not an afterthought.

```
MEMORY/
├── README.md          What gets a record, how to write one, the honesty rules
├── MEMORY-INDEX.md    One line per record, newest first — the entry point
├── CHANGELOG.md       Coarser-grained chronological summary
├── DECISIONS.md       ADRs — every choice docs/ left open, every deviation from it
├── records/           One file per completed task (append-only; never edited to look better)
├── specs/             Feature specs for `Spec required` tasks, written before implementation
└── templates/         Change record, phase summary, and feature spec templates
```

There is deliberately **no** `MEMORY/STATE.md`. `TASKS/PROGRESS.md` is the single status board; a second snapshot would drift and then neither could be trusted.

### What every record must contain

Copy `MEMORY/templates/CHANGE-RECORD-TEMPLATE.md`, name it `records/YYYY-MM-DD-<task-id>-<slug>.md`, and fill in every section. Write it assuming the reader has no other context at all. The template covers what changed, why, how, files touched, decisions made, deviations from `docs/`, tests added, security verification, abuse cases covered, DoD verification, what did not work, follow-ups, and what to watch in production.

"Not applicable" is a valid answer for a section; blank is not.

### Honesty rules

Record what happened, not what was supposed to happen. If a test was skipped, say so. If a DoD item was waived, say which one and who agreed. **Never write that a security control was verified without naming the test that proves it** — `docs/SECURITY/05` sets zero tolerance for cross-tenant leaks, and a record claiming "IDOR tested, all good" with no test name is worse than silence, because it stops anyone looking again.

Record failures too: a load test that missed its target, an approach abandoned after two days. Those are the highest-value records in the folder.

### Start and end of a session

**Start**: read `TASKS/PROGRESS.md`, then the task card, then `MEMORY/MEMORY-INDEX.md` and any record touching the area you're about to work in. Don't skip this because the task "seems simple" — a prior session's undocumented workaround is exactly the kind of thing that causes a repeated mistake.

**End**: write the record in `MEMORY/records/`, add its line to `MEMORY-INDEX.md`, add a `CHANGELOG.md` entry if the change is user-visible or operationally significant, add an ADR to `DECISIONS.md` if a decision was made or a document deviated from, and update `TASKS/PROGRESS.md` and the phase file checkbox. Do this for small tasks too — a brief accurate record beats none.

## Non-negotiable rules

These are load-bearing for the product and are not up for reinterpretation during implementation:

- **Templates are data, not code.** No template-specific backend logic, no per-template React/Vue components. Everything a template needs is expressed in `template_versions.sections` (JSON) and rendered by one generic renderer. See `PLAN/07-TEMPLATE-SYSTEM.md`.
- **Invitation data is independent of the template.** Changing a user's template must never delete data — only change what's displayed. See `PLAN/08-INVITATION-DATA-MODEL.md`.
- **Every `:id` endpoint needs object-level authorization**, checked at the query level (`WHERE owner_id = :current_user_id`), not fetched-then-checked in application code. A non-owner accessing another user's resource must get a 404, not a 403. See `SECURITY/05-MULTI-TENANCY-SECURITY.md` — this is the single highest-priority security concern in the whole project. Zero tolerance for regressions here.
- **Payment status is server-decided only.** Never trust a redirect query parameter or client-submitted status. Status changes only from a signature-verified webhook or a server-initiated provider query. See `SECURITY/07-PAYMENT-SECURITY.md`.
- **Price is always recalculated server-side** from the `packages`/`addons` tables, never accepted from the client.
- **All free-text user input is sanitized before storage** (stored XSS prevention) — names, quotes, guestbook messages, RSVP messages all render on public pages seen by many people.
- **File uploads go through the full validation pipeline** in `SECURITY/06-FILE-UPLOAD-SECURITY.md` (magic-byte check, EXIF stripping, decompression-bomb protection, malware scan) — never trust an extension or `Content-Type` header alone.
- **State transitions are logged**, not just mutated. Every invitation status change writes to `invitation_status_history`; every admin action writes to `audit_logs`.

If a task seems to require breaking one of these, stop and flag it rather than working around it silently.

## Repo/documentation map

```
docs/PLAN/          Product vision, requirements, business rules, roadmap — read first
docs/ARCHITECTURE/   System design, caching, queues, deployment, DR
docs/API/            The full API contract — endpoints, request/response shapes, error codes
docs/DATABASE/       SQL schema, ready to turn into migrations
docs/SECURITY/       Threat model, authz, multi-tenancy, payments, privacy, incident response
docs/UI-UX/          Design system, user flows, editor UX, accessibility
docs/FRONTEND/       Frontend architecture, state management, template rendering, testing
docs/BACKEND/        Backend architecture, service layer, validation, jobs, payment flow
docs/DEVOPS/         CI/CD, environments, monitoring, logging, rollback
docs/TESTING/        Test strategy across all layers, security testing execution detail
TASKS/               The execution plan — 133 tasks across 8 phases; read PROGRESS.md before working
MEMORY/              Session-to-session continuity — read MEMORY-INDEX.md and relevant records before working
```

Every doc cross-references others by path (e.g., "see SECURITY/05"). Follow those references — they are there because the topic genuinely spans documents, not as filler.

## Architecture summary

- Modular monolith for the backend (not microservices) at this stage — see `ARCHITECTURE/01-APPLICATION-ARCHITECTURE.md` for module boundaries (`auth`, `invitation`, `template`, `media`, `order`, `payment`, `publishing`, `rsvp`, `guestbook`, `notification`, `admin`).
- Layering per module: `Controller → Service → Repository → DB`. Business logic belongs in the Service layer only.
- Three logically separate frontend surfaces: the authenticated app (dashboard/editor), the public invitation renderer (SSR/ISR, not a pure SPA — see `FRONTEND/07-PUBLIC-INVITATION.md`), and the admin panel (separate subdomain).
- PostgreSQL is the primary datastore. UUIDs for anything exposed in a URL. See `DATABASE/00-DATA-MODEL.md`.
- Redis for cache, rate-limiting, and session/counter state. See `ARCHITECTURE/06-CACHING-ARCHITECTURE.md`.

## Dev environment

The stack is decided and recorded — ADR-004 through ADR-017 in `MEMORY/DECISIONS.md`. Read the ADR before proposing a change to any row below; each names the alternatives that were rejected and why.

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 24 LTS, TypeScript | One language across API, workers and all three frontends |
| Repo | pnpm workspaces + Turborepo | `backend/{api,worker}`, `frontend/{web-app,public-invite}`, `admin/`, `packages/{schema,template-renderer,ui,api-client,config}` |
| Backend | NestJS 12 | `Controller → Service → Repository`, constructor injection |
| Database | PostgreSQL 18, Drizzle ORM 0.45.x + drizzle-kit | Migrations are a separate command, never run on startup (ADR-029 raised 16 -> 18) |
| Cache & queue | Redis 7, BullMQ 6.3.x | Cache, rate limiting and jobs share one Redis |
| Validation | Zod 4.5.x in `packages/schema` | One schema for API validation, template schema, field registry and client forms |
| Frontend | React 19; Next.js 16 (`web-app`, `public-invite`); Vite 8 (`admin`) | Public invitation is server-rendered — sharing bots do not run JS |
| UI | Tailwind CSS + Radix primitives, tokens as CSS variables | Design tokens from `docs/UI-UX/06`-`09` |
| Client state | TanStack Query 5.x (server state) + Zustand 5.x (editor store) | Per `docs/FRONTEND/02` |
| Media | sharp 0.35.x (libvips) + ClamAV sidecar | Runs only in the resource-capped `worker-media` pool |
| Auth | argon2 0.45.x, JWT access + rotating opaque refresh, google-auth-library, otplib (admin TOTP) | Per `docs/SECURITY/03` |
| Storage & edge | Cloudflare R2 + Cloudflare CDN, DNS and Turnstile; MinIO locally | R2 has no egress fee, which matters for photo-heavy public pages |
| Payment | Midtrans (Snap), behind `PaymentGatewayPort` | Commercial terms still to be confirmed; the port keeps a switch cheap |
| Email | Resend, React Email templates, behind `EmailPort` | SPF/DKIM/DMARC configured before the first real send |
| Maps | MapLibre GL 6.x in the editor; static image + Google Maps deep link on the public page | No map SDK on the public page — JS budget and per-load cost |
| PDF | @react-pdf/renderer 4.x | Invoice generation in the worker |
| Hosting | Single VPS (Singapore/Jakarta), Docker Compose, Caddy origin proxy | Pull-based deploy; accepted single-host risk is R14 |
| Observability | Pino 10.x, OpenTelemetry, Prometheus + Grafana, Sentry | Redaction is enforced by the logger, not by discipline |
| Testing | Vitest 5.x, Testcontainers, Supertest, Playwright 1.63.x, MSW, axe-core, k6 | Integration tests run against real Postgres and Redis |
| CI | GitHub Actions, Semgrep, Renovate, OWASP ZAP | Per `docs/DEVOPS/01` and `docs/SECURITY/11` |

Exact versions are pinned in the lockfile by `P0-02`; the majors above are the decision.

**Setup commands**

```bash
pnpm install            # workspace install; also installs the git hooks
pnpm build              # build every package and app (turbo orders by dependency)
pnpm typecheck          # type check everything
pnpm test               # unit and integration tests
pnpm format             # prettier over code; docs/, TASKS/ and MEMORY/ are prose and excluded
pnpm --filter @wi/api dev    # API in watch mode
pnpm --filter @wi/api start  # API from dist/

pnpm verify             # what CI would run: gates, format, lint, types, tests, build
```

**Database (P0-06)** — migrations never run on startup, and never as the application role.

```bash
pnpm --filter @wi/api db:generate   # diff the schema, emit SQL to review
pnpm --filter @wi/api db:migrate    # apply pending migrations (owner role)
pnpm --filter @wi/api db:rollback   # reverse the latest one -- development only
pnpm --filter @wi/api db:seed       # development data; refuses production
pnpm db:roundtrip                   # up -> down -> up against a running container
```

Two URLs, two roles: `MIGRATION_DATABASE_URL` is the owner and can alter schema;
`DATABASE_URL` is the application role and cannot. That split is a precondition for
row-level security -- an owner connection bypasses every policy silently. See
`backend/api/migrations/README.md` for the expand-contract rule that governs any `DROP`.

Copy `.env.example` to `.env` first. The API validates its environment at startup and exits **78** naming every offending variable rather than failing later on the request that needed it (`backend/api/src/config/env.schema.ts`).

**Local service stack**

```bash
docker compose -f deploy/docker-compose.yml up -d          # postgres, redis, minio, mailpit, api
docker compose -f deploy/docker-compose.yml --profile media up -d   # adds ClamAV (slow first start)
docker compose -f deploy/docker-compose.yml down           # add -v to discard the data volumes
```

Host ports are overridable when something already holds one — `REDIS_PORT=56379 docker compose … up -d`. See `deploy/README.md`.

Repository layout — **`backend/`, `frontend/`, `admin/`, `packages/`**, not `apps/`. `docs/FRONTEND/00` § Project Structure still describes `apps/`; the code deliberately deviates and the document was deliberately left unamended at the project owner's instruction (ADR-027). Trust the layout below.

```
backend/api/         NestJS REST API
backend/worker/      Background job pools
frontend/web-app/    Marketing, auth, dashboard, editor, checkout
frontend/public-invite/  The public invitation, server-rendered
admin/               Admin panel (own hostname, own session, own trust boundary)
packages/            schema, template-renderer, ui, api-client, config
```

Inside the API, per `docs/ARCHITECTURE/01-APPLICATION-ARCHITECTURE.md`:
```
backend/api/src/modules/{auth,user,invitation,template,media,order,payment,publishing,rsvp,guestbook,notification,admin}/
backend/api/src/shared/{auth-middleware,validation,audit-log,rate-limit,sanitizer}/
backend/api/src/infra/{db,cache,storage,queue}/
```
Layering inside each module: `Controller → Service → Repository → DB`. Business logic lives only in Service, and object-level authorization is enforced there (never only in a controller or a decorator), per `docs/SECURITY/04` § Implementation Principles.

## Workflow for implementing a feature

1. Check `TASKS/PROGRESS.md` for current status, open the task card, and read any relevant prior record in `MEMORY/records/`.
2. Locate the feature in `PLAN/04-FEATURE-SPECIFICATION.md` and confirm which roadmap phase it belongs to (`PLAN/16-IMPLEMENTATION-ROADMAP.md`). If the task card says `Spec required`, write the feature spec into `MEMORY/specs/` first.
3. Read the corresponding `API/*.md` for the exact endpoint contract — don't invent request/response shapes.
4. Read the corresponding `DATABASE/*.md` for the schema — migrations should match these tables/columns/constraints exactly unless there's a documented reason to deviate (and if so, update the doc too).
5. Check `SECURITY/*.md` for anything specific to this feature (file upload, payment, public endpoints all have dedicated docs).
6. Implement: Controller (thin) → Service (business rules, referencing the `BR-x.x` rule IDs from `PLAN/02-BUSINESS-RULES.md` in comments where relevant) → Repository.
7. Write tests per `BACKEND/09-TESTING.md` / `FRONTEND/10-TESTING.md` — at minimum, a unit test for any new business rule and an IDOR test for any new `:id` endpoint.
8. If the feature touches the public API, verify against `API/08-PUBLIC-INVITATION-API.md` that no data is exposed beyond what `enabled_sections` and `status=published` allow.
9. Write the `MEMORY/records/` entry from the template, add its index line, and update `TASKS/PROGRESS.md` and the phase file checkbox before finishing (see the TASKS and MEMORY section above).

## When docs and reality disagree

The docs were written before implementation began, so they may need small corrections as real constraints surface (e.g., a library limitation). When that happens: fix the doc in the same task as the code change, and prefer the smallest change that keeps the doc accurate — don't silently let code and docs diverge. Record the deviation in the `MEMORY/records/` entry and, as the deviation protocol in `TASKS/00-TASK-CONVENTIONS.md` requires, as an ADR in `MEMORY/DECISIONS.md`.

## What not to do

- Don't hard-code section/field logic per template in frontend components — that defeats the entire point of the template system.
- Don't add a new payment status source (webhook only).
- Don't skip the ownership check "because it's just an internal admin tool" — admin bypasses are allowed but must go through the explicit, separately-audited admin query path (see `SECURITY/05` § Special Case: Admin Access).
- Don't invent new API response shapes — follow `API/00-API-STANDARDS.md`'s envelope format everywhere.
- Don't finish a session/task without writing to `MEMORY/` and updating `TASKS/PROGRESS.md`.
- Don't decide an open question from `TASKS/BACKLOG.md` silently while coding — raise it.
