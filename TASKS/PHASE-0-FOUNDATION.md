# Phase 0 — Foundation

**Goal**: turn a documentation-only repository into a working engineering environment — a running service skeleton, the complete database schema from `docs/DATABASE/`, a data-access layer that makes cross-tenant queries structurally hard to write, a CI pipeline that can reject bad code, and one reference template that proves the data-driven template system works — without implementing a single product feature yet.

**Why this phase exists separately**: every Phase 1 task assumes it can run a migration, write a structured log, emit an audit row, enqueue a job, and be tested against a real Postgres. Building those foundations *while* building authentication and the invitation editor is how security-critical code ends up untested. `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` also states a hard ordering constraint: the template system must be finalized in design before serious editor work begins, because the editor is schema-driven. That is why the reference template is a Phase 0 deliverable, not a Phase 2 one.

**Exit criteria**: `docker compose up` produces an API that answers `/health`, connects to Postgres, Redis and object storage, has every table in `docs/DATABASE/02` through `10` applied by migration, emits structured JSON logs with a `request_id` and redaction, and runs a worker against a queue. A push runs lint, type check, unit and integration tests, dependency audit and SAST. One reference template exists as `template_versions` data with a matching component set, renderable with demo seed data.

**Roadmap reference**: `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` § Phase 0 (Week 1-2).

---

## Task Summary

| ID | Task | Surface | Size | Depends on |
|---|---|---|---|---|
| P0-01 | Confirm and freeze the tech stack (ADRs) | docs | S | — |
| P0-02 | Initialize the monorepo structure | infra | S | P0-01 |
| P0-03 | Git conventions, branch strategy, PR template, CODEOWNERS | infra | S | P0-02 |
| P0-04 | Backend service skeleton (modules, config, middleware chain) | backend | M | P0-02 |
| P0-05 | Local environment via Docker Compose | infra | M | P0-04 |
| P0-06 | Migration tooling and the baseline migration | backend | S | P0-05 |
| P0-07 | Schema 1/4 — users, auth support tables | backend | M | P0-06 |
| P0-08 | Schema 2/4 — templates, template versions, assets, media | backend | M | P0-07 |
| P0-09 | Schema 3/4 — invitations and every child table | backend | L | P0-08 |
| P0-10 | Schema 4/4 — packages, addons, orders, payments, audit logs | backend | M | P0-09 |
| P0-11 | Tenant-scoped repository layer and ownership helpers | backend | L | P0-09 |
| P0-12 | Structured logging with redaction and request correlation | backend | M | P0-04 |
| P0-13 | Response envelope, error mapping, health endpoints | backend | M | P0-04 |
| P0-14 | Audit log and status history writers | backend | M | P0-10, P0-12 |
| P0-15 | Queue and worker skeleton with idempotency and DLQ | worker | M | P0-05, P0-12 |
| P0-16 | Object storage abstraction (`StoragePort`) | backend | M | P0-05 |
| P0-17 | CI pipeline: lint, types, tests, SAST, dependency scan | infra | M | P0-04 |
| P0-18 | Secrets and configuration conventions | infra | S | P0-04 |
| P0-19 | Test harness: testcontainers, factories, E2E skeleton | backend, web-app | M | P0-05 |
| P0-20 | Template schema definition and validator | backend | L | P0-08 |
| P0-21 | Reference template v1.0.0 and demo seed data | backend, web-app | L | P0-20 |
| P0-22 | Frontend skeletons and the design system package | web-app, public-invite, admin | L | P0-02 |
| P0-23 | Staging environment, wildcard DNS and TLS | infra | L | P0-17 |
| P0-24 | Adopt the TASKS/MEMORY working discipline | docs | S | — |
| P0-25 | Separate surfaces into backend/frontend/admin | infra | S | P0-02 |

**Suggested parallel tracks** once `P0-02` lands: backend (`P0-04` → `P0-05` → `P0-06` → `P0-07`…`P0-11`), platform (`P0-17` → `P0-18` → `P0-23`), frontend (`P0-22`), and template (`P0-20` → `P0-21`, which needs `P0-08` only).

---

## P0-01 — Confirm and Freeze the Tech Stack

| | |
|---|---|
| **Status** | DONE — 2026-09-09 |
| **Depends on** | — |
| **Spec refs** | `docs/ARCHITECTURE/03-BACKEND-ARCHITECTURE.md`, `docs/ARCHITECTURE/02-FRONTEND-ARCHITECTURE.md`, `docs/BACKEND/00-BACKEND-STANDARDS.md`, `docs/FRONTEND/00-FRONTEND-STANDARDS.md`, `MEMORY/DECISIONS.md` ADR-002 |
| **Spec required** | No |
| **Surface** | docs |

**Goal** — Convert the deliberately framework-agnostic architecture documents into concrete, recorded decisions, so no later task has to re-litigate them.

**Steps**
1. Choose the backend framework and language. `docs/BACKEND/00` names NestJS (TypeScript), Laravel (PHP) and Django-DRF (Python) as acceptable. Evaluate against what later phases actually need: a DI/service layer (`docs/ARCHITECTURE/03`), schema validation with strict unknown-field rejection (`docs/BACKEND/03`), a queue library with retry/backoff and a dead-letter queue (`docs/ARCHITECTURE/07`), and an image pipeline binding (libvips/sharp equivalent, `docs/BACKEND/04`).
2. Choose the ORM and migration tool. Constraint from `docs/ARCHITECTURE/08`: migrations run as a **separate step before rollout**, never on service startup, and must support the expand-contract pattern (`docs/DEVOPS/08-ROLLBACK.md`).
3. Choose the frontend framework. `docs/FRONTEND/07-PUBLIC-INVITATION.md` requires server-side rendering with on-demand cache invalidation and per-invitation `generateMetadata`-style dynamic meta tags; a pure SPA is explicitly ruled out for the public surface.
4. Decide monorepo versus separate repositories. `docs/FRONTEND/00` § Project Structure assumes shared packages (`ui`, `template-renderer`, `api-client`, `schema`) — the renderer in particular is shared between the editor preview and the public page (`docs/FRONTEND/04`), so a monorepo is the path of least resistance.
5. Choose the queue technology, the cache client, and the object storage SDK, consistent with `docs/ARCHITECTURE/05`, `06`, `07`.
6. Choose the payment provider for the MVP — Midtrans or Xendit (`OQ-02`). This is a Phase 3 dependency but a Phase 0 decision, because `docs/BACKEND/05` and `docs/SECURITY/07` describe provider-specific signature verification.
7. Choose hosting, object storage, email provider, maps provider and CAPTCHA vendor (`OQ-03`, `OQ-04`, `OQ-06`, `OQ-09`) — each is a dependency of a later phase and cheapest to decide once, here.
8. Write one ADR per decision in `MEMORY/DECISIONS.md`, each naming at least one rejected alternative and why.

**Definition of Done**
- [x] ADRs exist for backend language and framework, ORM and migration tool, frontend frameworks, repository layout, queue, storage, image library and payment provider — ADR-004 through ADR-017, which also cover email, maps, hosting, testing and observability.
- [x] Each ADR names a rejected alternative and the specific reason.
- [x] The ORM ADR confirms migrations run as a separate pre-rollout step and support expand-contract (ADR-007).
- [x] The frontend ADR confirms per-request SSR with on-demand revalidation for the public invitation surface (ADR-006).
- [x] `CLAUDE.md` and `AGENTS.md` § Dev environment carry the full stack table, replacing the placeholder text. The install and run **commands** land with `P0-02` and `P0-05` — there is nothing to install until the repository is scaffolded, and that limitation is stated in both files rather than left as an empty promise.
- [x] `MEMORY/DECISIONS.md` ADR-002 is marked superseded, with a forward pointer.

**Notes** — This is the one task where choosing differently is cheap. Every later phase makes it more expensive.

---

## P0-02 — Initialize the Monorepo Structure

| | |
|---|---|
| **Status** | DONE — 2026-09-09 |
| **Depends on** | P0-01 |
| **Spec refs** | `docs/ARCHITECTURE/01-APPLICATION-ARCHITECTURE.md`, `docs/FRONTEND/00-FRONTEND-STANDARDS.md` § Project Structure, `AGENTS.md` § Dev environment |
| **Spec required** | No |
| **Surface** | infra |

**Goal** — Create the directory layout the architecture documents already prescribe, so no later task has to invent one or put code in the wrong place.

**Steps**
1. Create the backend layout from `docs/ARCHITECTURE/01`, as real but empty modules so Phase 1 code lands correctly:
   ```
   app/modules/{auth,user,invitation,template,media,order,payment,publishing,rsvp,guestbook,notification,admin}/
   app/shared/{auth-middleware,validation,audit-log,rate-limit,sanitizer}/
   app/infra/{db,cache,storage,queue}/
   ```
2. Create the frontend layout from `docs/FRONTEND/00`: `apps/web-app`, `apps/public-invite`, `apps/admin`, and `packages/{ui,template-renderer,api-client,schema}`.
   *(Superseded by `P0-25`: these now live at `frontend/web-app`, `frontend/public-invite` and `admin/`.)*
3. Add the workspace tooling chosen in `P0-01` (workspace file, task runner, shared TypeScript config), with one root command each for lint, type check, test, and build.
4. Add a root `.gitignore` covering build output, `node_modules`/vendor, every `.env*` variant except `.env.example`, and local upload staging directories.
5. Add a per-surface `README.md` stating what lives there and which specification document governs it.
6. Leave `docs/` untouched — it is reference material, amended only through the deviation protocol.

**Definition of Done**
- [x] The backend module list matches `docs/ARCHITECTURE/01` exactly — same names, same nesting.
- [x] `packages/template-renderer` exists and is importable from both the web app and the public invitation app; verified by the workspace symlinks after `pnpm install`. *(Paths moved in `P0-25`.)*
- [x] `.gitignore` makes committing any `.env` file impossible — verified with `git check-ignore` on `.env` and `.env.production`, with `.env.example` still tracked.
- [x] The root `README.md` describes the repository and points at `docs/`, `TASKS/`, and `MEMORY/`.

---

## P0-03 — Git Conventions, Branch Strategy, PR Template, CODEOWNERS

| | |
|---|---|
| **Status** | DONE — 2026-09-09 |
| **Depends on** | P0-02 |
| **Spec refs** | `AGENTS.md` § PR / change instructions, `docs/DEVOPS/01-CI-CD.md` § Branch Strategy, `TASKS/00-TASK-CONVENTIONS.md` |
| **Spec required** | No |
| **Surface** | infra |

**Goal** — Make the traceability rules structurally enforced rather than merely remembered.

**Steps**
1. Initialize the git repository if it is not one yet; the first commit is the existing documentation.
2. Define branches per `docs/DEVOPS/01`: `main` (production-ready), `develop`, feature branches named `<type>/<task-id>-<slug>`.
3. Add `.github/pull_request_template.md` requiring: task ID, specification documents implemented, test layers added and run, the security review flag from `00-TASK-CONVENTIONS.md`, IDOR test confirmation for any new `:id` endpoint, and a deviation statement with its ADR link or "none".
4. Add `CODEOWNERS` marking `docs/SECURITY/`, `docs/DATABASE/`, and `docs/API/` as requiring explicit review — these three change only deliberately.
5. Add a commit-message check rejecting subjects that do not start with a valid task ID.
6. Add a CI check that fails a PR touching a route file with an `:id` parameter unless the diff also touches a test file — crude, but it converts `docs/SECURITY/05`'s checklist item from a habit into a gate.

**Definition of Done**
- [~] A PR cannot be opened without the task ID and specification references filled in — the template asks, and a CI job **fails** a PR whose body names neither a task nor a `docs/` section. GitHub cannot block the opening of a PR; failing its checks is the available enforcement.
- [x] A commit without a task ID prefix is rejected before it reaches `main` — `.githooks/commit-msg`, verified by execution, plus a CI check over every commit in the PR.
- [~] Editing `docs/SECURITY/`, `docs/DATABASE/`, or `docs/API/` requires a code-owner review — `CODEOWNERS` is written and correct, but takes effect only once branch protection is enabled in the GitHub repository settings, which cannot be done from here. **Not yet enabled.**
- [x] The `:id`-without-test check runs on every PR and its failure message names `docs/SECURITY/05` — `scripts/check-id-endpoint-tests.mjs`, detection logic self-tested over six cases.

**Note on existing history** — the repository already had four commits in Conventional Commits style when this task ran. The hook applies going forward; history is not rewritten for a convention introduced after it.

---

## P0-04 — Backend Service Skeleton

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
| **Depends on** | P0-02 |
| **Spec refs** | `docs/ARCHITECTURE/03-BACKEND-ARCHITECTURE.md`, `docs/ARCHITECTURE/01` § Layering, `docs/API/00-API-STANDARDS.md` |
| **Spec required** | No |
| **Surface** | backend |

**Goal** — A single service that starts, validates its configuration, serves HTTP with a documented middleware chain, and shuts down gracefully — with the `Controller → Service → Repository` layering already visible in the code.

**Steps**
1. Bootstrap the framework chosen in `P0-01`; pin the runtime version; commit the lockfile.
2. Implement a configuration loader that fails fast and loudly on a missing required value. A service that boots without a JWT signing secret or a payment webhook secret is worse than one that refuses to boot.
3. Establish the middleware chain, with the positions later tasks will slot into reserved and documented in code:
   `request ID → structured logging → CORS → security headers → body parsing with size limits → rate limiting (P1-07) → authentication (P1-06) → route handler → error mapper (P0-13)`.
4. Split the router into three mounted surfaces, per `docs/ARCHITECTURE/01` § Public vs Authenticated Surface and `docs/API/00`: `/api/v1/*` (authenticated), `/public/*` (anonymous), `/api/webhooks/*` (provider signature only, no user auth). They differ in rate limiting, caching, and authentication, so they are separated at the routing layer rather than by convention.
5. Add one example module wired end to end (`Controller → Service → Repository`) with no business logic, as the shape every Phase 1 module copies.
6. Implement graceful shutdown: stop accepting connections, drain in-flight requests within a bounded timeout, close DB and queue connections, exit.

**Definition of Done**
- [x] Build and test commands pass on a clean checkout — verified by deleting every `dist/` and the turbo cache and rebuilding. This is also where a real bug was found: a stale `.tsbuildinfo` made the build report success while emitting nothing (see the record).
- [x] The service starts, serves its port, and drains in-flight requests on shutdown — proven by `graceful-shutdown.spec.ts`. **Qualified**: Windows does not deliver POSIX signals, so signal *delivery* is not tested here; the drain behaviour it triggers is. Delivery is exercised by the container stop in `P0-05`.
- [x] Starting without a required config value fails at startup naming the variable — exit 78, every missing variable listed at once.
- [x] The three route surfaces are mounted separately and a request to each is covered by a test.
- [x] The middleware chain is documented in code with the reserved positions named after the tasks that fill them.

**Beyond the card** — the `@wi/schema` import is asserted end to end rather than assumed, because ADR-004 chose one language on the strength of that boundary working. If it breaks, `P0-20` would be the expensive place to discover it.

---

## P0-05 — Local Environment via Docker Compose

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
| **Depends on** | P0-04 |
| **Spec refs** | `docs/DEVOPS/02-CONTAINERIZATION.md`, `docs/DEVOPS/00-ENVIRONMENTS.md`, `docs/ARCHITECTURE/05-STORAGE-ARCHITECTURE.md` |
| **Spec required** | No |
| **Surface** | infra |

**Goal** — One command brings up the entire local stack, so "works on my machine" never becomes a debugging variable.

**Steps**
1. Write `docker-compose.yml` with: the API, the worker, PostgreSQL, Redis, MinIO (local S3-compatible storage, per `docs/DEVOPS/02`), and a mail catcher — Phase 1 sends verification emails and they need somewhere to land.
2. Create the two buckets from `docs/ARCHITECTURE/05` at startup: `user-media` and `template-assets`, both private.
3. Write a multi-stage `Dockerfile` per surface producing a minimal non-root runtime image, per `docs/DEVOPS/02` § Container Security Principles.
4. Pin every image version — never `:latest`.
5. Write `.env.example` documenting every variable with safe placeholders; the real `.env` stays git-ignored.
6. Gate startup ordering on health checks, so the API waits for Postgres and Redis to be genuinely ready rather than merely started.

**Definition of Done** — each item checked against the running stack, not read off the file.
- [x] `docker compose up` yields an API answering `/health` — `{"status":"ok"}` from the host, container reporting `healthy`.
- [x] Runtime containers run as a non-root user — `node`, uid 1000.
- [x] No secret value appears in any committed file — only local-development credentials, labelled as such in the compose header and `deploy/README.md`.
- [x] Both storage buckets exist and are private — both listed `private`; unauthenticated GET returns **403**.
- [x] `AGENTS.md` § Dev environment documents the real command.

**Deferred from step 1**: the worker has no compose service until `P0-15` — there are no jobs to run, and a container that starts and idles is noise. Named in the compose file rather than left to be noticed.

**Borrowed from `P0-13`**: a minimal `/health` (liveness only, touches no dependency) was added here because the container healthcheck needs one. `P0-13` still owns readiness, and the compose gate should move to it then.

---

## P0-06 — Migration Tooling and the Baseline Migration

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-05 |
| **Spec refs** | `docs/ARCHITECTURE/04-DATABASE-ARCHITECTURE.md` § Migration Strategy, `docs/DEVOPS/08-ROLLBACK.md` |
| **Spec required** | No |
| **Surface** | backend |

**Goal** — Schema changes are versioned files that run as a deliberate step, never as a side effect of a deploy.

**Steps**
1. Wire the migration tool chosen in `P0-01` as a command separate from service startup.
2. Write the baseline migration: extensions (`pgcrypto`/`gen_random_uuid()` — every table in `docs/DATABASE/` defaults its primary key to it), and the `updated_at` trigger function, since almost every table carries `updated_at`.
3. Document the expand-contract rule from `docs/DEVOPS/08` in the migrations README, with the four phases spelled out.
4. Add a CI check that a migration containing `DROP COLUMN` or `DROP TABLE` fails unless its file carries an explicit justification comment.
5. Verify a round trip: migrate up from empty, migrate down, migrate up again, on a clean container.

**Definition of Done**
- [ ] Migrations run as their own command and never on service startup.
- [ ] The up/down/up round trip passes in CI against a fresh database.
- [ ] A destructive migration without justification fails CI.
- [ ] Seed data and schema migration are separate commands — production runs migrations without seeds.

---

## P0-07 — Schema 1/4: Users and Auth Support Tables

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-06 |
| **Spec refs** | `docs/DATABASE/02-USERS.md`, `docs/DATABASE/00-DATA-MODEL.md` § Principles |
| **Spec required** | Yes — data model |
| **Surface** | backend |

**Goal** — `users`, `user_notification_preferences` and `refresh_tokens` exist exactly as specified, including the partial unique index that makes soft-deleted accounts free their email.

**Steps**
1. Translate the three `CREATE TABLE` statements in `docs/DATABASE/02` into migrations, column for column, constraint for constraint.
2. Include both indexes: `idx_users_email` (unique, `WHERE deleted_at IS NULL`) and `idx_users_oauth` (partial, `WHERE oauth_provider IS NOT NULL`).
3. Add the `updated_at` trigger where the table has that column.
4. Write integration tests that prove the constraints exist rather than assuming the migration ran: a duplicate active email is rejected; the same email is accepted once the first row is soft-deleted; a `role` outside the CHECK list is rejected; a `refresh_tokens` row cascades away with its user.

**Definition of Done**
- [ ] Columns, types, defaults, CHECK constraints and indexes match `docs/DATABASE/02` exactly.
- [ ] `password_hash` is nullable, since OAuth-only users have none.
- [ ] Constraint behaviour is proven by integration tests, not by reading the migration.
- [ ] Any deviation is recorded as an ADR **and** `docs/DATABASE/02` is amended in the same change.

---

## P0-08 — Schema 2/4: Templates, Versions, Assets, Media

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-07 |
| **Spec refs** | `docs/DATABASE/03-TEMPLATES.md`, `docs/DATABASE/06-MEDIA.md`, `docs/DATABASE/01-ERD.md` |
| **Spec required** | Yes — data model |
| **Surface** | backend |

**Goal** — The template catalog and the media table exist, with the referential rules that protect already-published invitations.

**Steps**
1. Create `templates`, `template_versions` (with `sections` and `theme` as JSONB and `customizable_theme_keys` as an array), and `template_assets`.
2. Create `media` with a nullable `invitation_id` — null is how a template asset is distinguished from user media (`docs/DATABASE/00`).
3. Enforce `ON DELETE RESTRICT` from `template_versions` to anything referencing it, per `docs/DATABASE/01` § Key Cardinalities: a version an invitation still points at cannot be deleted, only deprecated (BR-3.3).
4. Add `UNIQUE (template_id, version)` and `idx_template_versions_template`.
5. Note the ordering dependency: `template_assets.media_id` references `media`, so `media` is created first in the same migration.

**Definition of Done**
- [ ] `docs/DATABASE/03` and `06` are reproduced exactly for these four tables.
- [ ] A test proves a `template_versions` row referenced by an invitation cannot be deleted (once `P0-09` lands, added there if ordering requires).
- [ ] A test proves a duplicate `(template_id, version)` is rejected.
- [ ] `media.invitation_id` accepts null and the `idx_media_invitation` index exists.

---

## P0-09 — Schema 3/4: Invitations and Every Child Table

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-08 |
| **Spec refs** | `docs/DATABASE/04-INVITATIONS.md`, `docs/DATABASE/05-EVENTS.md`, `docs/DATABASE/06-MEDIA.md`, `docs/DATABASE/09-GUESTS.md`, `docs/PLAN/06-INVITATION-LIFECYCLE.md` |
| **Spec required** | Yes — data model |
| **Surface** | backend |

**Goal** — The invitation aggregate exists in full: the parent, its eight children, and the status history table that makes the lifecycle auditable.

**Steps**
1. Create `invitations` with the status CHECK from `docs/DATABASE/04` (`draft`, `pending_payment`, `paid`, `published`, `expired`, `soft_deleted`), the partial unique slug index, and the owner/status indexes.
2. Create `invitation_settings` (including `seo_indexable` defaulting to **false**, the privacy default from `docs/PLAN/15-SEO.md`), `invitation_status_history`, `invitation_people` with `UNIQUE (invitation_id, role)`, `invitation_events`, `invitation_gallery`, `invitation_bank_accounts`, `invitation_quote`, `invitation_guests`, `invitation_guestbook`.
3. Apply the cascade rules from `docs/DATABASE/01`: children cascade from `invitations`; `invitations.owner_id` is `ON DELETE RESTRICT`; `template_version_id` is `ON DELETE RESTRICT`.
4. Add `idx_guestbook_invitation` as the composite `(invitation_id, status)` — `docs/ARCHITECTURE/04` § Indexing names it explicitly because the moderation queue filters on both.
5. Create `invitation_custom_domains` now even though the feature is Phase 7 (`docs/DATABASE/04` § Custom Domain). Creating the table early costs nothing and keeps the schema matching the document.
6. Write integration tests for the constraints that encode business rules: a third `invitation_people` row for one invitation is rejected; `guest_count` outside 1..10 is rejected; deleting an invitation cascades its children; two live invitations cannot share a slug but a soft-deleted one frees it.

**Definition of Done**
- [ ] Every table, column, constraint and index in `docs/DATABASE/04`, `05`, `06` (invitation children) and `09` exists.
- [ ] `invitation_settings.seo_indexable` defaults to `false`.
- [ ] The constraint tests above pass.
- [ ] `invitation_status_history` accepts a null `changed_by`, since system jobs change status with no acting user.

---

## P0-10 — Schema 4/4: Packages, Addons, Orders, Payments, Audit Logs

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-09 |
| **Spec refs** | `docs/DATABASE/07-ORDERS.md`, `docs/DATABASE/08-PAYMENTS.md`, `docs/DATABASE/10-AUDIT-LOGS.md`, `docs/SECURITY/07-PAYMENT-SECURITY.md` |
| **Spec required** | Yes — data model, payment |
| **Surface** | backend |

**Goal** — The commercial tables exist, including the unique index that is the whole idempotency story for payment webhooks.

**Steps**
1. Create `packages` and `addons` as master price tables — `docs/SECURITY/07` § Pricing makes these the only source of an order's amount.
2. Create `orders` with the status and `order_type` CHECKs and the three indexes.
3. Create `payments` with `UNIQUE (provider, provider_reference_id)`. Per `docs/DATABASE/08`, this constraint is the primary defence against a replayed webhook, at the level where it cannot be forgotten by application code.
4. Include `signature_valid` on `payments`: a forged callback is recorded rather than discarded, because a spike in invalid signatures is an alerting condition (`docs/DEVOPS/07-ALERTING.md`).
5. Create `audit_logs` with its three indexes, and revoke `UPDATE`/`DELETE` on it from the application database role — `docs/DATABASE/10` § Policy asks for append-only enforcement at the permission level where possible.
6. Seed `packages` and `addons` as a **seed**, not a migration, with the values from `OQ-05`. Until pricing is answered, seed the shape from `docs/PLAN/09` § Packages with placeholder amounts and mark them clearly. Seed `custom_domain` with `is_active = false` (ADR-022) — it is not sellable until `P7-01` ships the feature.
7. Write tests: inserting a duplicate `(provider, provider_reference_id)` is rejected; an `UPDATE` on `audit_logs` from the application role fails; an order cannot reference a non-existent package.

**Definition of Done**
- [ ] All five tables match `docs/DATABASE/07`, `08` and `10`.
- [ ] The payments uniqueness constraint is proven by a test that attempts the duplicate insert.
- [ ] The application database role cannot update or delete `audit_logs`, proven by a test.
- [ ] Package and addon prices live in seed data, and no price appears as a constant in application code.

**Abuse cases to test**
| Abuse case | Source | Expectation |
|---|---|---|
| Replayed webhook creates a second payment row | `docs/SECURITY/07` § Idempotency | Unique violation, no second row |
| Application tampers with an audit row | `docs/DATABASE/10` § Policy | Permission denied |

---

## P0-11 — Tenant-Scoped Repository Layer and Ownership Helpers

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-09 |
| **Spec refs** | `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md`, `docs/SECURITY/04-AUTHORIZATION-RBAC.md`, `docs/BACKEND/02-SERVICE-LAYER.md` |
| **Spec required** | Yes — authorization |
| **Surface** | backend |

**Goal** — Make the correct query the easy one: a repository API where fetching an invitation without an owner filter is not something a developer can do by accident.

**Why this is a Phase 0 task** — `docs/SECURITY/05` is the project's stated number-one security priority with zero tolerance for regressions, and `docs/PLAN/18` R1 rates it very high impact. Every `:id` endpoint in Phases 1 through 5 is built on this layer. Adding it after the endpoints exist means auditing them all instead of never writing them wrong.

**Steps**
1. Implement `findOwned(invitationId, userId)` returning null when the row exists but belongs to someone else — the query carries `WHERE owner_id = :userId`, so the two cases are indistinguishable at the data layer, which is exactly what `docs/SECURITY/04` § Example Pseudocode asks for.
2. Implement a scoped child-resource accessor: given a parent invitation already proven owned, fetch a child by id **and** `invitation_id`, closing the cross-tenant sub-resource hole in `docs/SECURITY/05` § Attack Surfaces 6 and 7. A bank account id belonging to another invitation must not be reachable through your own invitation's path.
3. Implement `findOwnedList(userId, filters)` for list endpoints, with the owner filter applied in SQL — `docs/SECURITY/05` § 5 names response-level filtering as the wrong answer.
4. Implement `adminFind*` as **separately named** functions that intentionally bypass the owner filter, per `docs/SECURITY/05` § Special Case. Every call site writes an audit row (`P0-14`).
5. Make unscoped access hard to reach: no exported repository function returns an invitation or a child by id alone without either a `userId` or the explicit `admin` naming.
6. Add a lint rule or CI grep failing a build where a route handler queries an invitation table directly instead of going through this layer.
7. Write the test matrix now, before there are endpoints to test: owner reads own (found), non-owner reads (null), admin path reads (found, audit row written), child of another invitation via own parent (null), list returns only own rows when the database holds two users' data.

**Definition of Done**
- [ ] No exported function can fetch a tenant-owned row without a user scope or an explicit `admin` prefix.
- [ ] Non-owner access returns null at the repository layer, so the service cannot accidentally return a 403 that confirms existence.
- [ ] The cross-tenant sub-resource case is covered by a test.
- [ ] The CI guard against direct table access from route handlers is in place and fails on a deliberately introduced violation.
- [ ] `adminFind*` call sites write an audit row; a test asserts this.

**Abuse cases to test**
| Abuse case | Source | Expectation |
|---|---|---|
| IDOR on a parent resource | `docs/SECURITY/05` § 1 | Repository returns null → 404 |
| Cross-tenant child via an owned parent | `docs/SECURITY/05` § 6, 7 | Repository returns null → 404 |
| List endpoint leaks other tenants' rows | `docs/SECURITY/05` § 5 | Query-level filter, test with two seeded users |
| Admin bypass unlogged | `docs/SECURITY/05` § Special Case | Audit row exists for every bypass |

---

## P0-12 — Structured Logging with Redaction and Request Correlation

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-04 |
| **Spec refs** | `docs/DEVOPS/06-LOGGING.md`, `docs/SECURITY/09-PRIVACY-DATA-PROTECTION.md`, `docs/BACKEND/00-BACKEND-STANDARDS.md` § Logging |
| **Spec required** | No |
| **Surface** | backend, worker |

**Goal** — JSON logs with a request ID that propagates into background jobs, and redaction enforced by the logger rather than by developer discipline.

**Steps**
1. Configure a structured JSON logger with the standard fields from `docs/DEVOPS/06`: `timestamp`, `level`, `service`, `request_id`, `message`, `context`.
2. Generate a `request_id` in the first middleware, expose it on the response, and include it in every log line for that request.
3. Implement redaction **inside the logger**, keyed on field names: password, any token or secret, `account_number` (masked to the last four digits), `raw_callback_payload`, signature headers, and authorization headers. `docs/DEVOPS/06` is explicit that this cannot rely on each developer remembering.
4. Propagate `request_id` into job payloads so an upload can be traced from the HTTP request through worker processing (`docs/DEVOPS/05` § Distributed Tracing).
5. Route security events — failed logins, invalid webhook signatures, admin bypasses — to a separately retained stream, per `docs/DEVOPS/06` § Log Retention (1 year, versus 90 days for application logs).
6. Write a test that logs an object containing every sensitive key name and asserts none of the values appear in the output.

**Definition of Done**
- [ ] Every log line is JSON and carries `request_id` where one exists.
- [ ] The redaction test passes for all sensitive key names listed in `docs/DEVOPS/06`.
- [ ] A worker job logs the `request_id` of the request that enqueued it.
- [ ] Security events are separable from application logs by a field, so retention can differ.

---

## P0-13 — Response Envelope, Error Mapping, Health Endpoints

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-04 |
| **Spec refs** | `docs/API/00-API-STANDARDS.md`, `docs/SECURITY/08-API-SECURITY.md` § Error Handling, `docs/DEVOPS/05-MONITORING.md` § Health Check |
| **Spec required** | No |
| **Surface** | backend |

**Goal** — One envelope and one error mapper for the whole API, so no endpoint invents a response shape and no error leaks internals.

**Steps**
1. Implement the success and error envelopes from `docs/API/00` verbatim, including `meta` for paginated responses.
2. Implement a global exception mapper: validation → 400 `VALIDATION_ERROR` with `details[]` of `{field, message}`; unauthenticated → 401; not found or not yours → 404; conflict → 409; business rule violation → 422; rate limited → 429; anything else → 500 with a generic message and the detail in logs only.
3. Return **404** for a resource that exists but is not the caller's, never 403. `PG-01` — where `docs/API/00` contradicted itself — is resolved by ADR-018, and that document now carries a dedicated section: 403 is reserved for a role the caller lacks or an action gated on `email_verified`, where no resource identity is revealed.
4. Implement pagination helpers with the defaults from `docs/API/00` (`per_page` default 20, max 100) so every list endpoint behaves identically.
5. Add `/health` per `docs/DEVOPS/05`: a liveness answer that does not touch dependencies, and a readiness answer that checks Postgres and Redis connectivity without heavy work, and discloses no infrastructure detail in its body.
6. Add security headers from `docs/SECURITY/08`: `X-Content-Type-Options`, `Strict-Transport-Security`, a CSP baseline, and a frame policy that is `DENY` for the app while leaving the public invitation surface configurable.
7. Configure CORS with an explicit origin allowlist — never `*` on authenticated endpoints.

**Definition of Done**
- [ ] Every response, success or error, matches `docs/API/00`, asserted by a shared integration test helper used across all later endpoint tests.
- [ ] A thrown internal error produces a generic 500 body with no stack trace, path, or SQL, proven by a test.
- [ ] Readiness fails when Postgres is down and the body still discloses nothing about the infrastructure.
- [ ] The 403-versus-404 decision is recorded as an ADR and `docs/API/00` is amended.

---

## P0-14 — Audit Log and Status History Writers

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-10, P0-12 |
| **Spec refs** | `docs/DATABASE/10-AUDIT-LOGS.md`, `docs/DATABASE/04-INVITATIONS.md` § Notes, `docs/PLAN/06-INVITATION-LIFECYCLE.md` § Transition Rules |
| **Spec required** | Yes — audit |
| **Surface** | backend |

**Goal** — Two small services that make "log the transition, do not just mutate it" the default rather than an act of memory.

**Steps**
1. Implement `AuditLogService.record({admin_id, action, resource_type, resource_id, reason, before_state, after_state, ip_address})`, writing inside the same transaction as the change it records — an audit row that commits when the action rolls back is a lie.
2. Trim `before_state`/`after_state` to the relevant fields, per `docs/DATABASE/10` § Policy: no duplicating bank account numbers into the audit table.
3. Implement `StatusHistoryService.record(invitationId, from, to, changedBy, reason)` and make it the only path that writes `invitations.status`, so a status change without a history row is not expressible. `docs/DATABASE/04` § Notes requires this at the service layer rather than a database trigger, so `changed_by` and `reason` can carry application context.
4. Allow a null `changed_by` for system transitions (the expiry job, the payment webhook), with a `reason` string identifying the actor instead.
5. Write tests: a status change inside a rolled-back transaction leaves no history row; a status change through the service always writes exactly one row; audit `before_state` excludes sensitive fields.

**Definition of Done**
- [ ] `invitations.status` cannot be written except through the status history service; a CI grep enforces this.
- [ ] Audit and history rows commit atomically with the change they describe, proven by a rollback test.
- [ ] Sensitive fields never reach `before_state`/`after_state`.

---

## P0-15 — Queue and Worker Skeleton with Idempotency and DLQ

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-05, P0-12 |
| **Spec refs** | `docs/ARCHITECTURE/07-QUEUE-WORKER-ARCHITECTURE.md`, `docs/BACKEND/08-JOBS-WORKERS.md` |
| **Spec required** | No |
| **Surface** | worker, infra |

**Goal** — A worker process, separate from the API, that runs registered jobs with per-job retry policies, an idempotency guard, a dead-letter queue, and a cron runner.

**Steps**
1. Stand up the queue chosen in `P0-01`, and a worker entry point separate from the API process — `docs/ARCHITECTURE/07` requires independent scaling, and `docs/BACKEND/08` splits pools: `worker-media` (CPU-heavy, resource-capped), `worker-general`, `worker-cron`.
2. Implement the idempotency wrapper from `docs/BACKEND/08` § Idempotency Pattern: check a key, no-op if already processed, mark on success.
3. Configure per-job retry and backoff from the table in `docs/ARCHITECTURE/07`, and a dead-letter queue that a permanently failed high/medium job lands in — never a silent drop.
4. Implement the cron runner with leader election, so a multi-instance deployment does not run the daily expiry job twice.
5. Log per-job observability fields from `docs/BACKEND/08`: `job_name`, `started_at`, `finished_at`, `status`, `related_id`, `error_message`.
6. Register a no-op example job end to end, and a test that a failing job retries the configured number of times and then lands in the DLQ.

**Definition of Done**
- [ ] The worker runs as its own process and can be scaled without the API.
- [ ] A job replayed with the same idempotency key does its work once, proven by a test.
- [ ] A permanently failing job reaches the DLQ, and the DLQ depth is exposed as a metric for `docs/DEVOPS/07`'s alert.
- [ ] Two cron runner instances execute a scheduled job once, not twice.
- [ ] The media worker pool has CPU and memory limits, per `docs/BACKEND/04` § Resource Isolation.

---

## P0-16 — Object Storage Abstraction

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-05 |
| **Spec refs** | `docs/ARCHITECTURE/05-STORAGE-ARCHITECTURE.md`, `docs/BACKEND/02-SERVICE-LAYER.md` § Principles |
| **Spec required** | No |
| **Surface** | backend, worker |

**Goal** — A `StoragePort` interface with an S3-compatible implementation, so `docs/ARCHITECTURE/05`'s path structure is applied in one place and provider swap stays cheap.

**Steps**
1. Define `StoragePort`: put, get, delete, exists, and a path builder. `docs/BACKEND/02` requires external I/O behind a port for testability and swappability.
2. Implement the path scheme from `docs/ARCHITECTURE/05` in the port itself, not at call sites: `user-media/invitations/{invitation_id}/media/{media_id}/{variant}.webp` and `template-assets/templates/{template_id}/versions/{version}/assets/{asset_name}`. Path construction is a tenant isolation control, so it belongs where it cannot be bypassed.
3. Add a separate staging area for uploads not yet validated, not publicly reachable, per `docs/BACKEND/04` Stage 1 step 5.
4. Keep buckets private; access is via the CDN with origin access control, never a public bucket URL (`docs/ARCHITECTURE/05` § Access Control).
5. Implement an in-memory fake of the port for unit tests.

**Definition of Done**
- [ ] The path scheme matches `docs/ARCHITECTURE/05` exactly and is unit tested.
- [ ] Callers cannot construct a storage path themselves — only the port can.
- [ ] A direct request to a bucket object URL is denied.
- [ ] The staging area is separate and not publicly reachable.

---

## P0-17 — CI Pipeline

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-04 |
| **Spec refs** | `docs/DEVOPS/01-CI-CD.md`, `docs/SECURITY/11-SECURITY-TESTING.md`, `docs/BACKEND/09-TESTING.md` § Coverage Target |
| **Spec required** | No |
| **Surface** | infra |

**Goal** — A pipeline that runs the seven per-PR steps in `docs/DEVOPS/01` and can actually reject bad code.

**Steps**
1. Implement the PR pipeline in order, fail-fast: lint and format → unit tests → type check → build → integration tests with a database container → dependency audit and SAST.
2. Run integration tests against real Postgres and Redis containers, per `docs/TESTING/02-INTEGRATION-TESTING.md` — mock only external services.
3. Add the coverage gate from `docs/BACKEND/09`: 80% line coverage on the service layer, and a check that coverage of a business-critical module has not dropped from baseline.
4. Add SAST and dependency scanning per `docs/SECURITY/11` § Test Types.
5. Pin third-party CI actions by digest — a supply-chain control.
6. Require at least one reviewer approval before merge, per `docs/DEVOPS/01`.
7. Add the staging deploy pipeline shape now (build → migrate → deploy → E2E → notify) even if `P0-23` fills in the target later.

**Definition of Done**
- [ ] All seven PR steps run and each can fail the build, demonstrated once per step.
- [ ] Integration tests run against real Postgres and Redis in CI.
- [ ] The coverage gate fails a PR that drops service-layer coverage below the threshold.
- [ ] A dependency with a known critical CVE fails the build.

---

## P0-18 — Secrets and Configuration Conventions

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-04 |
| **Spec refs** | `docs/DEVOPS/00-ENVIRONMENTS.md`, `docs/DEVOPS/01-CI-CD.md` § Secrets, `docs/SECURITY/03-AUTHENTICATION-SECURITY.md` § Tokens |
| **Spec required** | No |
| **Surface** | infra |

**Goal** — Every secret has one documented home per environment, and none of them is the repository.

**Steps**
1. Enumerate every secret the system will need: database credentials, Redis, the JWT signing key, the refresh token pepper, the payment provider server key and webhook secret, the email provider key, object storage credentials, the maps API key, the CAPTCHA secret.
2. Choose the secret store per environment and record it as an ADR; scope secrets per environment so a staging key can never reach production.
3. Enforce the sandbox/live split from `docs/DEVOPS/00`: staging uses the payment provider's sandbox credentials, production uses live, and the two are never interchangeable by configuration mistake — the service refuses to start if a live payment key is present outside production.
4. Document rotation for each secret: who rotates it, how, and what breaks during rotation.
5. Add secret scanning to CI, and a pre-commit hook.

**Definition of Done**
- [ ] `.env.example` lists every variable with a placeholder, and no real value.
- [ ] The service refuses to start with a live payment key outside production.
- [ ] Secret scanning runs in CI and on commit.
- [ ] A rotation runbook exists for each secret, naming the blast radius.

---

## P0-19 — Test Harness

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-05 |
| **Spec refs** | `docs/TESTING/00-TEST-STRATEGY.md`, `docs/TESTING/02-INTEGRATION-TESTING.md`, `docs/BACKEND/09-TESTING.md`, `docs/FRONTEND/10-TESTING.md` |
| **Spec required** | No |
| **Surface** | backend, web-app |

**Goal** — All four test layers exist with a real test in each, and the data factories that make multi-tenant test scenarios cheap enough that nobody skips them.

**Steps**
1. Wire the unit test runner with the shared configuration.
2. Wire integration tests against containerized Postgres and Redis, with migrations applied automatically and per-test isolation (transaction rollback or truncation), per `docs/TESTING/02` § Test Pattern.
3. Build the factories `docs/TESTING/02` § Test Data Factory asks for: `createTestUser()`, `createTestInvitation({owner})`, `createTestTemplateVersion()`, `createTestOrder()`, `createTestMedia()`.
4. Add a purpose-built helper: `createTwoTenants()`, returning two users each with a full invitation. Every IDOR test in Phases 1 through 5 starts from this, and making it a one-liner is the difference between the tests being written and being skipped.
5. Wire the E2E runner with the browser matrix skeleton, and mock the payment gateway and email provider at the HTTP boundary.
6. Add accessibility assertions to the frontend harness (`docs/UI-UX/17` § Testing).
7. Prove the harness cannot pass vacuously: assert that the integration suite fails loudly when no database is reachable rather than skipping its tests.

**Definition of Done**
- [ ] Each of unit, integration, E2E and accessibility has at least one real passing test.
- [ ] `createTwoTenants()` exists and is used by a demonstration IDOR test against the `P0-11` repository layer.
- [ ] The integration suite fails, not skips, when its database is unavailable.
- [ ] Test data is isolated per test; a run repeated twice gives the same result.

---

## P0-20 — Template Schema Definition and Validator

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-08 |
| **Spec refs** | `docs/PLAN/07-TEMPLATE-SYSTEM.md`, `docs/DATABASE/03-TEMPLATES.md` § Schema Validation, `docs/PLAN/08-INVITATION-DATA-MODEL.md` |
| **Spec required** | Yes — data model |
| **Surface** | backend, web-app |

**Goal** — A formal, machine-checkable schema for `template_versions.sections` and `theme`, plus the dot-notation field resolver both the backend and the frontend depend on.

**Why it matters** — `docs/PLAN/07` is named as the most critical architectural document in the product, and `docs/PLAN/16` § Critical Dependencies makes it a hard prerequisite for editor work. Everything downstream — the editor's dynamic form, the renderer, publish validation — reads this schema. A loose schema here becomes a class of bugs everywhere else.

**Steps**
1. Write the JSON Schema for a section entry: `section_key`, `component`, `enabled_by_default`, `configurable`, `max_items`, `required_fields`, `optional_fields`, `layout_variant`, `layout_options` (`docs/PLAN/07` § Section System).
2. Write the JSON Schema for `theme`: colors, typography, spacing, border radius, and `customizable_theme_keys` (`docs/PLAN/07` § Theme Variables).
3. Define the canonical field-path vocabulary from `docs/PLAN/08` — `couple.groom.nickname`, `events.*.date`, `gallery.photos`, and the rest — as a single enumerated registry. Validation rejects a `required_fields` entry that is not in it, so a typo in a template definition fails at authoring time rather than silently rendering an empty section.
4. Implement the dot-notation resolver used by publish validation (`docs/BACKEND/03` § Validating Completeness) and by the renderer (`docs/FRONTEND/04` step 4), including the `*` wildcard for collections. Put it in the shared `packages/schema` so the backend and frontend cannot drift apart.
5. Validate `sections` and `theme` against these schemas before any write to `template_versions`, per `docs/DATABASE/03`.
6. Enforce the component-registry contract: a `component` value that no registered renderer component provides is rejected at validation, closing R5 in `docs/PLAN/18` at the earliest point.
7. Unit test the resolver against the shapes in `docs/PLAN/08`: present, absent, empty string, empty array, wildcard over multiple events, and a path into a section the user has disabled.

**Definition of Done**
- [ ] A section definition with an unknown field path is rejected with a message naming the path.
- [ ] A section definition naming an unregistered component is rejected.
- [ ] The resolver lives in one shared package imported by both the API and the frontend.
- [ ] The resolver's "is this field empty" semantics are explicit and tested — empty string, empty array, and null all count as missing for publish validation (BR-4.2).

---

## P0-21 — Reference Template v1.0.0 and Demo Seed Data

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-20 |
| **Spec refs** | `docs/PLAN/07-TEMPLATE-SYSTEM.md`, `docs/UI-UX/14-PUBLIC-INVITATION-UX.md` § Section Order, `docs/PLAN/16` § Phase 0 |
| **Spec required** | No |
| **Surface** | backend, web-app |

**Goal** — One complete template that exists as data, proving the "templates are data, not code" rule before any code depends on it.

**Steps**
1. Author the section list for the reference template covering the default order in `docs/UI-UX/14`: hero, quote, couple, event, gallery, maps, gift, rsvp, guestbook, closing.
2. Set `configurable` per section: hero and event are not user-disableable (an invitation without event details is not an invitation); gallery, maps, gift, rsvp, guestbook, quote are.
3. Author the theme block and `customizable_theme_keys` — start with `colors.primary` only, per `docs/PLAN/07` § Theme Variables.
4. Seed it as a `templates` row plus a `template_versions` row at `1.0.0`, status `published`, through the seed command from `P0-06`.
5. Author demo invitation data for the catalog's live demo (`docs/UI-UX/11` § Template Detail Page) and for admin preview (`docs/PLAN/07` § Demo Data). Per ADR-022 this is a **seeded invitation owned by a system account**, not a fixture format, so the demo renders through the production renderer reading the production API shape with no second code path to drift. It is never publicly listed and is excluded from admin dashboard counts.
6. Write a fixture test asserting the reference template validates against `P0-20`'s schema, so a later schema change that breaks it fails CI.

**Definition of Done**
- [ ] The reference template exists as seed data, not as code.
- [ ] It validates against the `P0-20` schema in a CI-run test.
- [ ] Its `required_fields` reference only paths in the canonical registry.
- [ ] Demo data renders the template end to end once `P2-02` exists — noted as a follow-up assertion on that task.

---

## P0-22 — Frontend Skeletons and the Design System Package

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-02 |
| **Spec refs** | `docs/UI-UX/06-DESIGN-SYSTEM.md`, `docs/UI-UX/07-TYPOGRAPHY.md`, `docs/UI-UX/08-COLOR-SYSTEM.md`, `docs/UI-UX/09-SPACING-GRID.md`, `docs/FRONTEND/00-FRONTEND-STANDARDS.md` |
| **Spec required** | No |
| **Surface** | web-app, public-invite, admin |

**Goal** — Three application shells and one token-driven component library, so no Phase 1 screen invents a button.

**Steps**
1. Scaffold `apps/web-app` (marketing, auth, dashboard, editor, checkout), `apps/public-invite` (SSR renderer), and `apps/admin`, per `docs/ARCHITECTURE/02` § Logically Separate Applications. The admin app is separate because `docs/SECURITY/02` puts it behind a different trust boundary with its own session.
2. Implement the design tokens from `docs/UI-UX/06`, `07`, `08` and `09` as the single source of colours, type scale, spacing, radii and shadows. `docs/UI-UX/08` notes that dark mode is not an MVP requirement but must not be foreclosed — tokens make that true.
3. Build the core component set from `docs/UI-UX/06` § Core Components: Button, Input/Textarea, Select, Modal, Toast, Card, Tabs, Badge, Table, Stepper, Skeleton, Dropzone, Avatar. Each carries every state listed there: default, hover, focus, active, disabled, loading, error.
4. Implement the invitation status badge colour map from `docs/UI-UX/08` once, in the design system, and never as a per-screen conditional.
5. Enforce the accessibility floor from `docs/UI-UX/17` in the components themselves: visible focus rings, label association, 44px minimum touch target, contrast-checked token pairs.
6. Set up the API client package with the interceptor behaviour from `docs/FRONTEND/08` § Global Fetch Error Handling: 401 triggers refresh or redirect, 5xx shows a generic toast, network failure shows an offline indicator.
7. Store the access token in memory only, never in `localStorage`, per `docs/FRONTEND/02` § Auth Token Storage — a rule easiest to honour if the storage helper simply has no persistent branch.
8. Add a component workbench (Storybook or equivalent) with an axe check per story.

**Definition of Done**
- [ ] Three apps build and serve a page.
- [ ] No colour, font size or spacing value is hard-coded in an app; a lint rule enforces token use.
- [ ] Every core component has all states and passes an automated accessibility check.
- [ ] The API client has no code path that writes an access token to persistent storage.
- [ ] The status badge map exists in exactly one place.

---

## P0-23 — Staging Environment, Wildcard DNS and TLS

| | |
|---|---|
| **Status** | TODO — domain and address strategy decided (ADR-024) |
| **Depends on** | P0-17 |
| **Spec refs** | `docs/DEVOPS/00-ENVIRONMENTS.md`, `docs/ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md`, `docs/DEVOPS/03-REVERSE-PROXY.md`, `docs/PLAN/10-DOMAIN-PUBLISHING.md` |
| **Spec required** | No |
| **Surface** | infra |

**Goal** — A staging environment that mirrors production's topology, including the host and path routing the product's publishing model depends on.

**Why addressing belongs in Phase 0** — `docs/PLAN/10` (as amended by ADR-024) publishes invitations at `invitation.zedth.my.id/{slug}`, with the application on `app.zedth.my.id`. If routing and certificates are only set up in Phase 3 alongside publishing, the first time anyone discovers a DNS or TLS problem is the week publishing is supposed to ship.

**Steps**
1. Provision staging with the topology from `docs/ARCHITECTURE/08` on the target chosen in ADR-015 — a single VPS running Docker Compose behind Caddy, Cloudflare in front, R2 for object storage: reverse proxy, API, worker pools, web app, public-invite, admin static files, Postgres, Redis, ClamAV.
2. Configure routing per `docs/DEVOPS/03`: `invitation.zedth.my.id` → public-invite (`/{slug}`, `/preview/{token}`, `/public/*` proxied to the API), `app.zedth.my.id` → web app plus `/api/*`. The admin host follows in `P5-01`. **No wildcard record** — that is deliberate (ADR-024), and the two hosts are separate so guest-submitted content never shares an origin with the authenticated application.
3. Let Caddy issue and renew a certificate per hostname; verify renewal actually happens rather than assuming it.
4. Apply the environment separation rules from `docs/DEVOPS/00`: sandbox payment credentials, seeded data rather than a production copy, internal access restriction.
5. Wire the staging deploy pipeline from `P0-17`: migrate, deploy, smoke test, notify.
6. Add synthetic uptime checks from outside the infrastructure (`docs/DEVOPS/05` § Synthetic Monitoring).
7. Deploy a placeholder and confirm end to end that `invitation.zedth.my.id/some-slug` resolves, terminates TLS, and reaches the public-invite app with the slug available to the handler — and that `invitation.zedth.my.id/dashboard` does **not** reach the application, because that host serves only invitations.

**Definition of Done**
- [ ] `invitation.zedth.my.id/{slug}` reaches the public-invite app over HTTPS with the slug available to the handler, and nothing else on that host reaches any other app.
- [ ] No wildcard DNS record or wildcard certificate exists — the MVP does not need one (ADR-024).
- [ ] The application host is served separately from the public invitation host, with distinct cookie scopes; the admin host follows at `P5-01`.
- [ ] Staging carries no production data and no live payment credentials.
- [ ] A merge to the integration branch reaches staging without a manual step, and the smoke test result is visible.

---

## P0-25 — Separate Surfaces into `backend/`, `frontend/`, `admin/`

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
| **Depends on** | P0-02 |
| **Spec refs** | `docs/ARCHITECTURE/02-FRONTEND-ARCHITECTURE.md` § Logically Separate Applications, `docs/SECURITY/02-TRUST-BOUNDARIES.md`, `MEMORY/DECISIONS.md` ADR-027 |
| **Spec required** | No |
| **Surface** | infra |

**Goal** — Replace the single `apps/` directory with three top-level groups, so the layout shows the trust boundaries instead of hiding them.

**Why it exists** — Requested by the project owner. `P0-02` built `apps/{api,worker,web-app,public-invite,admin}` because `docs/FRONTEND/00` § Project Structure specifies it. The owner asked for the three surfaces to be separated, and for `docs/` to be left unamended. That makes this a **recorded deviation** rather than a specification change (ADR-027).

**Steps**
1. `git mv` each surface so history follows the files: `backend/{api,worker}`, `frontend/{web-app,public-invite}`, `admin/`.
2. Update the workspace globs in `pnpm-workspace.yaml`.
3. Fix relative link depth where a surface changed nesting level — `admin/` rose by one.
4. Update every path reference in `README.md`, `packages/README.md`, `CLAUDE.md`, `AGENTS.md` and the task cards. `docs/` is deliberately untouched.
5. Verify the whole pipeline from a cleared cache: nothing may depend on the old paths.

**Definition of Done**
- [x] `apps/` no longer exists; the five surfaces resolve as workspace projects from the new locations.
- [x] `git status` shows renames, not delete-plus-add, so `git log --follow` still works on every moved file.
- [x] Build, typecheck, test and format all pass from a cleared turbo cache and deleted `dist/`.
- [x] `CLAUDE.md` and `AGENTS.md` state the real layout **and** that `docs/FRONTEND/00` deliberately disagrees, so the next reader is not misled by either.
- [x] The deviation is recorded as an ADR.

---

## P0-24 — Adopt the TASKS/MEMORY Working Discipline

| | |
|---|---|
| **Status** | DONE — 2026-09-09 |
| **Depends on** | — |
| **Spec refs** | `TASKS/00-TASK-CONVENTIONS.md`, `MEMORY/README.md`, `CLAUDE.md` § MEMORY, `AGENTS.md` § MEMORY |
| **Spec required** | No |
| **Surface** | docs |

**Goal** — The execution and record layers exist and the agent instruction files point at them, so the working discipline is discoverable rather than remembered.

**Steps**
1. Create `TASKS/` with conventions, phase files, progress board and backlog.
2. Restructure `MEMORY/` into the record format: `README.md`, `MEMORY-INDEX.md`, `CHANGELOG.md`, `DECISIONS.md`, `records/`, `specs/`, `templates/`.
3. Migrate the existing `MEMORY/LOG/` entry into `records/`, and retire `MEMORY/STATE.md` in favour of `TASKS/PROGRESS.md` as the single status board.
4. Update `CLAUDE.md` and `AGENTS.md` so their MEMORY sections describe the new structure and their documentation maps include `TASKS/`.
5. Record every specification gap and open question found while writing the plan in `BACKLOG.md`.

**Definition of Done**
- [x] `TASKS/` contains conventions, eight phase files, a progress board and a backlog.
- [x] `MEMORY/` follows the record format with an index, changelog, decision log and templates.
- [x] `CLAUDE.md` and `AGENTS.md` describe the current structure, with no reference to `MEMORY/STATE.md` or `MEMORY/LOG/`.
- [x] Gaps and open questions found while writing are recorded with the task each one blocks.

## P0-26 — Helm Charts for the Kubernetes Path

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
| **Depends on** | P0-05 |
| **Spec refs** | `docs/DEVOPS/02-CONTAINERIZATION.md`, `docs/DEVOPS/08-ROLLBACK.md`, `docs/BACKEND/08-JOBS-WORKERS.md`, `docs/SECURITY/06-FILE-UPLOAD-SECURITY.md`, ADR-015, ADR-024 |
| **Spec required** | No |
| **Surface** | infra |

**Goal** — `deploy/helm/` holds a chart that deploys the API and the three worker pools to a cluster, so the escape from the single-host risk (**R14**) is a deployment change rather than a project. Not the MVP path — ADR-015 keeps the MVP on one VPS.

**Steps**
1. Chart scaffold: `Chart.yaml`, `values.yaml`, `.helmignore`, `templates/_helpers.tpl`.
2. API Deployment (rolling update with `maxUnavailable: 0`), Service, optional HPA.
3. One Deployment per worker pool — `media`, `general`, `cron` — with the resource profile each needs.
4. Ingress splitting the application host (`/api`) from the public invitation host (`/public` only).
5. Guard rails that refuse to render a dangerous configuration.
6. `deploy/helm/verify.sh` — every check that is possible without a cluster, executable, so the chart does not rot while nothing deploys it.
7. `deploy/helm/README.md`, including an honest account of what was *not* verified.

**Definition of Done**
- [x] `helm lint --set image.tag=...` passes. A **bare** `helm lint` fails on purpose — the chart has a required value; see the record for why lint reports it badly.
- [x] `helm template` renders the full set — 6 resources — with an explicit tag.
- [x] Every workload runs `runAsNonRoot`, `readOnlyRootFilesystem`, `seccompProfile: RuntimeDefault`, all capabilities dropped, and carries resource limits — asserted across all 4 Deployments in the rendered output.
- [x] No secret value in the chart; credentials come from an existing Secret via `envFrom` (`P0-18`).
- [x] Rendering fails without `image.tag`, and fails if `workers.pools.cron.replicaCount > 1` — both triggered deliberately.
- [x] The public invitation host routes only `/public`; nothing authenticated is reachable on that origin (ADR-024) — asserted in the render, and the assertion itself negative-tested.
- [x] `deploy/helm/verify.sh` runs all twelve checks green.

**Not done, and named rather than left to be found**: Kubernetes **schema** validation. `kubectl apply --dry-run` needs a reachable API server for the OpenAPI schema and there is no cluster here. The manifests render and are well-formed; they are not proven acceptable to a real Kubernetes version. That check moves to `P0-23`.

**Deferred to `P0-23`**: `NetworkPolicy` and `PodDisruptionBudget`. PostgreSQL and Redis are deliberately not subcharts — a datastore whose lifecycle is bound to the application release can be destroyed by `helm uninstall`.
