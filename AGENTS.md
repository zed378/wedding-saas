# AGENTS.md

Instructions for any AI coding agent (Claude Code, Codex, Cursor, or similar) working in this repository.

## Project overview

A SaaS platform for creating and publishing digital wedding invitations from versioned, data-driven templates: template catalog → editor with live preview → checkout/payment → publish to a subdomain → public invitation page with RSVP and a guestbook → an admin panel for templates, orders, and moderation.

The full specification lives in `docs/` — product requirements, business rules, system architecture, API contracts, database schema, security requirements, UX flows, and a per-layer testing strategy. This repository may be at the specification stage or partway through implementation — check `TASKS/PROGRESS.md` first to find out which. Treat `docs/` as the source of truth to build against.

## Before making changes

Read, in this order, for any non-trivial task:
1. `TASKS/PROGRESS.md` and the task card you're picking up, then `MEMORY/MEMORY-INDEX.md` and any record relevant to the area you're touching. This is not optional; skipping it is how the same mistake gets made twice.
2. `docs/PLAN/00-PROJECT-OVERVIEW.md` — scope and constraints.
3. `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` — what phase of the build we're in.
4. Every document in the task card's `Spec refs` row — normally the specific `PLAN/`, `API/`, and `DATABASE/` docs for the feature you're touching.
5. `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` and `docs/SECURITY/07-PAYMENT-SECURITY.md` — these apply to nearly everything and are not optional reading.

Don't guess at endpoint shapes, table columns, or business rules — they are already fully specified. If something genuinely isn't covered, say so rather than inventing a convention that conflicts with the rest of the docs.

## TASKS and MEMORY — the working discipline

Two folders sit between the specification and the code. `TASKS/` is forward-looking — what will be built, in what order, and how it is judged done. `MEMORY/` is backward-looking — what was built, what it cost, and what to watch. Both are mandatory, and both are updated in the same commit as the work: a task is not `DONE` until its MEMORY record exists.

### TASKS/

```
TASKS/
├── README.md                How to use the folder, and the phase rule
├── 00-TASK-CONVENTIONS.md   Task IDs, statuses, card anatomy, the global Definition of Done
├── PROGRESS.md              The status board — read first, every session
├── BACKLOG.md               Open questions, specification gaps, deliberate deferrals
└── PHASE-0..7-*.md          133 task cards across eight phases
```

Take the lowest-numbered `TODO` task in the active phase whose dependencies are all `DONE`. Read every document in its `Spec refs` row. If the card says `Spec required`, write the feature spec from `MEMORY/templates/FEATURE-SPEC-TEMPLATE.md` into `MEMORY/specs/` before writing code. Satisfy the card's Definition of Done **and** the 11-item global DoD.

**Never build a Phase N+1 feature while Phase N is incomplete** (`docs/PLAN/16-IMPLEMENTATION-ROADMAP.md`). An unanswered question goes to `TASKS/BACKLOG.md` and gets raised — it is never decided silently while coding.

### MEMORY/

Agents working on this repo do not retain memory across sessions. `MEMORY/` is the only mechanism for continuity, so writing to it is a required part of every task, not an optional summary at the end.

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

There is deliberately no `MEMORY/STATE.md` — `TASKS/PROGRESS.md` is the single status board.

### Required content of a record

One file per completed task: `MEMORY/records/YYYY-MM-DD-<task-id>-<slug>.md`, from `MEMORY/templates/CHANGE-RECORD-TEMPLATE.md`. Write it assuming the reader has no other context at all: what changed, why, how, every file touched, decisions made with their reasoning, deviations from `docs/`, tests added per layer, security verification naming the test for each control, abuse cases covered, DoD verification including anything waived, what did not work, follow-ups, and what to watch in production.

"Not applicable" is a valid answer for a section; blank is not.

**Never record that a security control was verified without naming the test that proves it.** `docs/SECURITY/05` sets zero tolerance for cross-tenant leaks, and an unsupported claim of verification is worse than silence — it stops anyone looking again.

### Session start and end checklist

**Start**: read `TASKS/PROGRESS.md`, then the task card, then `MEMORY/MEMORY-INDEX.md` and any record touching the area you're about to work in.

**End**: write the record, add its index line, add a `CHANGELOG.md` entry if the change is user-visible or operationally significant, add an ADR to `DECISIONS.md` if a decision was made or a document deviated from, update any `docs/` file the implementation deviated from, and update `TASKS/PROGRESS.md` plus the phase file checkbox. Do this for small tasks too.

## Critical constraints

- **Templates are data, not code.** One generic rendering engine reads `template_versions.sections` (JSON) and renders accordingly. Never write template-specific backend logic or per-template frontend components. (`docs/PLAN/07-TEMPLATE-SYSTEM.md`)
- **Object-level authorization on every `:id` endpoint**, enforced at the database query (`WHERE owner_id = :current_user_id`), not by fetching first and checking after. A non-owner requesting another user's resource gets 404, never 403. This is the project's #1 security priority — zero tolerance. (`docs/SECURITY/05-MULTI-TENANCY-SECURITY.md`)
- **Payment status changes only from a signature-verified webhook or a server-side provider query** — never from a client parameter, redirect URL, or request body. (`docs/SECURITY/07-PAYMENT-SECURITY.md`)
- **Prices are always recalculated server-side** from the `packages`/`addons` tables.
- **All free-text input is sanitized before storage** — it renders on public pages.
- **Uploaded files go through the full pipeline** in `docs/SECURITY/06-FILE-UPLOAD-SECURITY.md` before being treated as safe (magic-byte validation, EXIF stripping, malware scan, decompression-bomb protection).
- **Status/lifecycle changes are logged**, not just written: `invitation_status_history` for invitation state, `audit_logs` for admin actions.

## Dev environment

The stack is decided and recorded — ADR-004 through ADR-017 in `MEMORY/DECISIONS.md`. Read the ADR before proposing a change to any row below; each names the alternatives that were rejected and why.

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 22 LTS, TypeScript | One language across API, workers and all three frontends |
| Repo | pnpm workspaces + Turborepo | `apps/{api,worker,web-app,public-invite,admin}`, `packages/{schema,template-renderer,ui,api-client,config}` |
| Backend | NestJS 12 | `Controller → Service → Repository`, constructor injection |
| Database | PostgreSQL 16, Drizzle ORM 0.45.x + drizzle-kit | Migrations are a separate command, never run on startup |
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

**Setup commands** — filled in by `P0-02` and `P0-05` once the repository is scaffolded. Until then there is nothing to install: this repository is still specification, plan and record only.

Target layout, per `docs/ARCHITECTURE/01-APPLICATION-ARCHITECTURE.md`:
```
apps/api/src/modules/{auth,user,invitation,template,media,order,payment,publishing,rsvp,guestbook,notification,admin}/
apps/api/src/shared/{auth-middleware,validation,audit-log,rate-limit,sanitizer}/
apps/api/src/infra/{db,cache,storage,queue}/
```
Layering inside each module: `Controller → Service → Repository → DB`. Business logic lives only in Service, and object-level authorization is enforced there (never only in a controller or a decorator), per `docs/SECURITY/04` § Implementation Principles.

## Testing instructions

Follow `docs/TESTING/00-TEST-STRATEGY.md` and the per-layer docs (`docs/BACKEND/09-TESTING.md`, `docs/FRONTEND/10-TESTING.md`). Minimum bar for any new endpoint or feature:
- A unit test for any new business rule (reference the `BR-x.x` ID from `docs/PLAN/02-BUSINESS-RULES.md` in the test description where applicable).
- For any endpoint accepting a resource `:id`: an explicit test that a different user's request returns 404, not the resource.
- For anything touching payment: a test that an unsigned/invalid webhook payload has no effect on state.
- For anything touching file upload: a test with a spoofed extension/MIME type.

Run the full test suite (once one exists) before considering a task complete. If no test runner is configured yet, note that clearly in the `MEMORY/records/` entry rather than silently skipping tests.

## Code style

- Response envelope, status codes, and error format: follow `docs/API/00-API-STANDARDS.md` exactly — don't introduce a different shape.
- SQL/schema: match `docs/DATABASE/*.md` column names, types, and constraints. If a change is needed, update the doc in the same change.
- Naming: `snake_case` for API fields and DB columns, per the docs; language-appropriate casing for code identifiers.
- No `SELECT *` passed straight to an API response — always an explicit, whitelisted output shape.
- No mass-assignment — every write endpoint whitelists accepted fields; a client can never set `role`, `owner_id`, or any status field by sending it in a body.

## PR / change instructions

- Keep changes scoped to one feature/module where possible, matching the module boundaries in `docs/ARCHITECTURE/01-APPLICATION-ARCHITECTURE.md`.
- If a change requires deviating from a documented schema, endpoint contract, or business rule, update the relevant doc in `docs/` in the same change, with a short note on why, and record it as an ADR in `MEMORY/DECISIONS.md`, per the deviation protocol in `TASKS/00-TASK-CONVENTIONS.md`.
- Call out explicitly in the PR/summary description any place where a security-critical rule from `docs/SECURITY/` was touched (authorization, payment, file upload, input sanitization) so it gets extra review attention.
- Don't merge/finalize a change that adds a new `:id` endpoint without an accompanying ownership check and test.
- Don't close out a task without the corresponding `MEMORY/records/` entry, its index line, and the `TASKS/PROGRESS.md` update.
