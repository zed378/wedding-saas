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
7. Choose hosting, object storage, email provider, maps provider and CAPTCHA vendor (`OQ-03`, `OQ-04`, `OQ-06`, `OQ-15`) — each is a dependency of a later phase and cheapest to decide once, here.
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
| **Status** | DONE — 2026-09-10 |
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
- [x] Migrations run as their own command and never on service startup — `src/main.ts` does not call the migrator and nothing in the application imports it.
- [x] The up/down/up round trip passes against a fresh database — `scripts/db-roundtrip.sh`, 9 assertions, run against a real PostgreSQL 18 container. **Not in CI**: `P0-17` is deferred (ADR-028), so this is a script a person runs.
- [x] A destructive migration without justification fails — `scripts/check-destructive-migration.mjs`, blocking in `pre-push` and in `scripts/verify.sh`. Verified four ways: unjustified `DROP COLUMN` fails, the same statement with a `CONTRACT-PHASE:` comment passes, a `DROP TABLE` written inside a comment does not trip it, and a clean tree passes.
- [x] Seed and migration are separate commands — `db:seed` refuses `NODE_ENV=production` and refuses any non-local database URL without an explicit override. Both guards triggered on purpose.

**Two DoD items said "in CI", which no longer exists.** `P0-17` is deferred, so they run as local gates instead: the destructive check blocks on push, and the round trip is `pnpm db:roundtrip` against a running container. That is weaker — a bypass with `--no-verify` skips it, and nothing runs on a clean checkout. Recorded rather than quietly re-scoped.

**Deviation from step 2**: no `CREATE EXTENSION`. The card expected `pgcrypto` for `gen_random_uuid()`, which was correct for PostgreSQL 12 and earlier; it has been core since 13. Verified on the image — it works with `pg_extension` holding nothing but `plpgsql`. Skipping it is better than equivalent, because `CREATE EXTENSION` needs superuser and the migration role should not keep a privilege for nothing.

**Added beyond the card**: `scripts/check-migration-pairs.mjs`, because Drizzle generates no down migrations (ADR-030) and a missing one is invisible until someone tries to roll back.

---

## P0-07 — Schema 1/4: Users and Auth Support Tables

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
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
- [x] Columns, types, defaults, CHECK constraints and indexes match `docs/DATABASE/02` exactly — one deliberate difference, ADR-031.
- [x] `password_hash` is nullable — asserted, not assumed.
- [x] Constraint behaviour proven by 22 integration tests. Three were **mutation-checked**: dropping `idx_users_email`, `users_role_check` and the `updated_at` trigger each failed exactly the tests that claim to cover them, then were restored.
- [x] The deviation is an ADR **and** `docs/DATABASE/02-USERS.md` is amended in the same change.

**A contradiction in the spec, found and resolved (ADR-031).** `docs/DATABASE/02` defined email uniqueness twice and incompatibly: `email VARCHAR(255) NOT NULL UNIQUE` *and* `CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL`. A column-level `UNIQUE` covers soft-deleted rows, which makes the partial index unreachable and holds a deleted account's address until the hard delete runs — contradicting this card's own goal and the retention model in `docs/SECURITY/09`. The partial index wins; the column constraint is gone.

**Six tables, not three.** Step 1 names three; `docs/DATABASE/02` also defines `user_tokens`, `user_mfa_factors` and `user_recovery_codes` under auth support, and the DoD requires matching the document. Shipping three would leave `P1-04` and `P5-02` adding tables from tasks that are not about schema.

**Integration tests run separately** (`pnpm --filter @wi/api test:integration`) against a running container, and **fail rather than skip** when none is reachable. They are deliberately **not** in `scripts/verify.sh`, which must work with nothing started — so nothing forces them to run. `P0-19` should close that when Testcontainers removes the precondition.

---

## P0-08 — Schema 2/4: Templates, Versions, Assets, Media

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
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
- [x] `docs/DATABASE/03` and `06` reproduced exactly for these four tables — one ordering deviation, ADR-032.
- [x] A test proves a `template_versions` row cannot be deleted while referenced — `refuses to delete a template that still has versions`, mutation-checked by flipping RESTRICT to CASCADE. The invitation-side half of this rule moves to `P0-09` as the card allows.
- [x] A duplicate `(template_id, version)` is rejected — plus a companion test that the same version string **is** allowed under a different template, which guards the wrong fix.
- [x] `media.invitation_id` accepts null and `idx_media_invitation` exists — both asserted.

**Ordering deviation (ADR-032)**: `media.invitation_id`'s **foreign key** is added by `P0-09`, because `invitations` does not exist yet and `template_assets` needs `media` now. The column, type, nullability and index are exactly as documented; only the constraint arrives one migration later. A test asserts the constraint is currently **absent** and says it must be replaced, not deleted, when `P0-09` lands.

**A real distinction found while testing**: `RESTRICT` raises SQLSTATE **23001** (`restrict_violation`), while `NO ACTION` raises **23503** (`foreign_key_violation`). Both appear in this schema and the tests assert each exactly. Application code that maps only 23503 to a friendly "still in use" message would return a 500 for the RESTRICT case.

---

## P0-09 — Schema 3/4: Invitations and Every Child Table

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
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
6. **Add the deferred foreign key from `P0-08` (ADR-032)**: `ALTER TABLE media ADD CONSTRAINT media_invitation_id_invitations_id_fk FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE`. The column and its index already exist; only the constraint is missing, because `invitations` did not exist when `media` was created.
7. Write integration tests for the constraints that encode business rules: a third `invitation_people` row for one invitation is rejected; `guest_count` outside 1..10 is rejected; deleting an invitation cascades its children; two live invitations cannot share a slug but a soft-deleted one frees it.

**Definition of Done**
- [x] Every table, column, constraint and index in `docs/DATABASE/04`, `05`, `06` (invitation children) and `09` exists — **and `11`**, see below.
- [x] `invitation_settings.seo_indexable` defaults to `false` — mutation-checked by flipping the default to `true`.
- [x] The constraint tests pass — 51 new, 93 across the three schema suites.
- [x] `invitation_status_history` accepts a null `changed_by`, and a null `from_status` for the first transition.
- [x] **`media.invitation_id` has its foreign key** (ADR-032); the `P0-08` test was **replaced**, not deleted. Dropping the constraint fails 3 tests.

**Thirteen tables, not the ten the card lists.** `docs/DATABASE/04` also defines `invitation_preview_tokens`, and `docs/DATABASE/11` defines `invitation_view_counts` — which `docs/DATABASE/00` lists as an invitation child. No other schema task owns either (`P0-10` is the commercial tables), so without them `P2-*` and `P4-09` would each add a table from a task about endpoints.

**A contradiction, the same one as `P0-07` (ADR-033).** `docs/DATABASE/04` declared `slug VARCHAR(50) UNIQUE` and then stated in its own Notes that a slug can be reused after the old invitation is truly deleted. A column-level `UNIQUE` covers soft-deleted rows and makes that sentence false. The partial index wins; `docs/DATABASE/04` is amended. Two files have now needed this correction — the specification used `UNIQUE` as a reflex without accounting for soft delete. `users` and `invitations` are the complete set; `media` is the only other soft-deleted table and has no unique column.

**A sweep test worth keeping**: `every table with updated_at has a trigger maintaining it` queries `information_schema` rather than naming tables, so it also covers tables that do not exist yet. It catches the mistake this project is most likely to repeat.

---

## P0-10 — Schema 4/4: Packages, Addons, Orders, Payments, Audit Logs

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
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

**Done — 30 tests, 123 across four suites.** Both load-bearing constraints were mutation-checked: granting `UPDATE`/`DELETE` back on `audit_logs` failed 2 tests, and narrowing the payments unique index to the reference alone failed 2 more.

**The append-only tests connect as `wedding_app`, not the owner.** A permission test run as the owner passes whether or not the `REVOKE` ever happened — which would make it worse than no test. `applicationPool()` in `test/integration/helpers.ts` exists for this.

**The `REVOKE` is guarded on the role existing** and raises a `NOTICE` either way, so a deployment whose application role has a different name does not fail the migration but also does not pass silently. `P0-23` must check for that notice.

**`scripts/db-roundtrip.sh` now reseeds.** The `0004` down migration drops `packages`, so a round trip used to leave the orders suite failing on a missing `standard` package — which looks like a schema bug and is not. The script also asserts the append-only grant survived a migration from empty.

**Phase 0's schema is complete: 28 tables.** The next schema change is a real migration against real data, where expand-contract and the destructive-migration gate start to matter. Everything so far has been `CREATE`.

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
| **Status** | DONE — 2026-09-10 |
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
- [x] No exported function fetches a tenant-owned row without a `TenantScope` or an explicit `admin` name. The scope is a **branded type**, so a bare string does not type-check.
- [x] Non-owner access returns `null`. Non-owner, soft-deleted and non-existent are all the same answer, so the service physically cannot leak existence through a status code (ADR-018).
- [x] The cross-tenant sub-resource case is covered from **three** angles: another invitation's child, another owner's parent, and a mismatched parent within one owner.
- [x] The guard is in place, **blocking** in `pre-push` and `scripts/verify.sh`, and was tested both ways.
- [x] The admin path writes its own audit row **inside the read's transaction** — there is no way to obtain the data without leaving the trail — and **fails closed** if the audit write fails.

**Mutation-checked four times**, because this is the layer where a passing test proves least: removing the owner filter from `findOwned`, the parent-id condition from `findOwnedChild`, the owner condition from `findOwnedChild`, and the audit insert from the admin path each failed exactly the tests claiming to cover them.

**Every test seeds two users.** A single-user fixture proves nothing about isolation — every query returns that user's rows whether or not the filter exists.

**A note for whoever reads this next**: the load-bearing part is `scripts/check-tenant-scope.mjs`, not the repository. The repository is correct and will stay correct; the risk is a handler that never calls it. With CI deferred (ADR-028) that guard runs only on push and in `verify.sh`, so `--no-verify` skips the project's number-one security control.

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
| **Status** | DONE — 2026-09-10 |
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
- [x] Every log line is JSON with the documented field names, and carries `request_id` where one exists — asserted in both directions, and verified through the **compiled production path**, not only the test harness.
- [x] The redaction test passes for every sensitive key name in `docs/DEVOPS/06`, plus an independent backstop list and value-level scrubbing of bearer tokens and JWTs under innocent keys.
- [x] A worker job carries the enqueuing request's `request_id` — **the mechanism is proven across a JSON round trip; there is no queue until `P0-15`**, which is the honest limit of what can be claimed here.
- [x] Security events are tagged `log_type: "security"`, so retention can differ. `P0-23` configures the retention itself.

**Redaction is a key-name walk, not a path list.** Pino's built-in `redact` needs a path per shape and misses anything nested or renamed. This decides by key name at any depth, normalised so `access_token`, `accessToken` and `Access-Token` are one key. The trade is false positives, which is the right direction to be wrong in.

**A flaw in my own test, found by mutation.** The main redaction test builds its payload from the redactor's own exported key list, so deleting `"password"` from the set deletes it from both sides and the test still passes. An independent backstop list — taken from `docs/DEVOPS/06`, not from the source — now fails with a name that says what happened. **A test generated from the code it tests verifies consistency, never correctness.**

**One deliberate inconsistency**: the logger reads `process.env` directly, which `config.module.ts` otherwise forbids. It has to exist before the DI container, because the most important line it ever writes is that container failing to start. The three variables change a label, a level or a format; redaction is not configurable.

---

## P0-13 — Response Envelope, Error Mapping, Health Endpoints

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
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
- [x] Every response matches `docs/API/00`, asserted by `test/support/envelope-assertions.ts` — the shared helper later endpoint tests are meant to use. It checks the key set exactly, so an extra top-level field is a failure too.
- [x] A thrown internal error produces a generic 500 with nothing internal — proven with three shapes that realistically leak: a pg foreign-key error naming a table and constraint, a `TypeError` carrying file paths, and a **thrown string containing a connection URL with a password**.
- [x] Readiness fails when Postgres is down and the body discloses nothing — proven against a real unreachable port, not a mock.
- [x] The 403-versus-404 decision is ADR-018, and `docs/API/00` already carries the section. Verified rather than assumed.

**The mapper works from an allowlist.** Only our own `AppError` subclasses and Nest's `HttpException` contribute anything to a response, and from the latter only the status. Everything else gets a fixed message. A pg error message contains the failing SQL and the constraint name; no amount of care at the call site fixes that, only refusing to forward unrecognised errors does.

**There is no `ForbiddenError` for someone else's resource, by construction.** It accepts only `FORBIDDEN` and `EMAIL_NOT_VERIFIED` — the two cases revealing no resource identity. A class that cannot express the wrong answer cannot be misused to produce it. A test also asserts an unknown route and a not-yours resource return **byte-identical** bodies, because a difference there is the same oracle arriving through a message instead of a status code.

**Found by running it, not by reading it**: readiness returned a correct 503 and logged `error: ""`. `pg` throws an `AggregateError` with an **empty message**, putting the cause in `.code` and `.errors[]`. Nothing failed — an operator would have had a 503 with no reason and correct-looking code to re-read.

---

## P0-14 — Audit Log and Status History Writers

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
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
- [x] `invitations.status` is written only by `InvitationStatusService`. `scripts/check-status-writes.mjs` fails the build on a Drizzle `.set({ status })` or raw `UPDATE invitations SET status` anywhere else — blocking in `pre-push` and `verify.sh`, tested both ways.
- [x] Audit and history rows commit atomically with their change — three rollback tests against a real database, because "both or neither" is a claim about a transaction that a mock cannot verify.
- [x] Sensitive fields never reach `before_state`/`after_state`. The trimming reuses `P0-12`'s redactor rather than a second list: a value that must not sit in a 90-day log certainly must not sit in one with **2-year** retention, and two lists would drift within a phase.

**The state machine is an allowlist**, covering `docs/PLAN/06` plus the refund edge from ADR-019 and the `DELETE /invitations/:id` soft-delete from `docs/API/04`. Anything absent is rejected, so a transition nobody designed cannot happen by accident.

**`pending_payment → paid` is SYSTEM-only, admins included.** `docs/PLAN/06` allows it solely through validated webhook processing and `docs/SECURITY/07` makes payment status server-decided. An admin who can mark an order paid by hand can grant a free product — a fraud path wearing a helpful hat. Both refusals are tested and mutation-checked.

**A shadowing bug the test loop caught.** The first lookup took the first matching rule, so from `expired` the SYSTEM 90-day sweep shadowed the user's own delete — a user could delete an invitation in every state **except** `expired`, the one they most want gone. A single-state test would have passed. One edge can legitimately have several rules, because it happens for several reasons.

---

## P0-15 — Queue and Worker Skeleton with Idempotency and DLQ

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
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
- [x] The worker is its own binary, its own Dockerfile and three compose services — one per pool.
- [x] A job replayed with the same idempotency key does its work once, proven end to end against a real Redis.
- [x] A permanently failing job reaches the DLQ with its payload and error preserved; `deadLetterDepth()` exposes the depth for `docs/DEVOPS/07`. **Exposing it to Prometheus is `P0-23`** — a function is not yet a metric.
- [x] Three cron instances elect one leader; leadership passes cleanly on shutdown.
- [x] The media pool has CPU and memory limits in compose, and already had them in the Helm chart.

**The documented idempotency pattern is racy, and the implementation does not copy it.** `docs/BACKEND/08` shows check-then-mark as two operations; two workers can both pass the check before either marks, which for a payment webhook credits an order twice. `SET key value NX EX` makes it one operation. The document was not amended — its pseudocode is illustrative and its intent is right.

**A failed attempt releases its claim.** Without that, "retry 3 times" becomes "try once, then no-op twice, then dead-letter" — producing exactly the same log lines as three genuine failures. I noticed while reviewing that the original retry test used no idempotency key, so this path was never exercised; the added test is the only one a mutation catches.

**Leader election is a lease, not consensus.** Under a Redis failover two instances can briefly both lead. What makes that safe is idempotency, not the lock — so a future job that is not idempotent would silently depend on a guarantee this does not provide.

**Handlers are deliberately not stubbed.** `media.process` is `P1-17`, `payment.webhook_process` is `P3-05`, `notification.send` is `P4-06`. A no-op stub reports success while doing nothing; an unregistered job stays visibly queued.

**A real limitation**: the worker's logger does **not** redact — `P0-12`'s redactor lives in `@wi/api` and cannot be imported across the package boundary yet. The worker logs only fields it constructs, never a whole payload, which is a discipline rather than a mechanism. Extracting a shared logging package is `P0-19`.

---

## P0-16 — Object Storage Abstraction

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
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
- [x] The path scheme matches `docs/ARCHITECTURE/05` exactly, unit tested — including the traversal cases, of which `{valid-uuid}/../../other` is the one a naive `startsWith` check would pass.
- [x] Callers cannot construct a storage path. `StorageKey` is a **branded type** only `@wi/storage` can produce, so the compiler stops it rather than a reviewer; `scripts/check-storage-paths.mjs` catches the cast that would bypass that in one word.
- [x] A direct request to a bucket object URL is denied — **403 against real MinIO**, on an object that genuinely exists.
- [x] The staging area is its own bucket with its own key shape, and is equally denied.

**A new package, `@wi/storage`, rather than a folder in the API.** Both surfaces touch storage: the API receives an upload into staging (`docs/BACKEND/04` Stage 1), the worker writes the variants (Stage 2). The `P0-15` record flagged duplicating the logger across those two packages as a known problem, and doing the same thing one task later would have been choosing it twice.

**There is no `getPublicUrl` on the port.** `docs/ARCHITECTURE/05` § Access Control says files "must never be accessible directly via the bucket URL"; a method returning one would be used. `presignGet` exists instead, five minutes by default.

**A contradiction found and deliberately not resolved.** `docs/ARCHITECTURE/05` lists variants as `original | large | thumbnail`; `docs/BACKEND/04` step 6 generates `thumbnail | medium | large`. Neither is a superset. The builder accepts all four, because the filename is the CDN cache key — guessing wrong means rewriting every stored object, not changing a constant. `P1-17` decides. Raised as `OQ-19`.

**One test earns its place specifically**: the signed-URL check. Without it, all three 403 assertions would also pass against a MinIO that was simply down.

---

## P0-17 — CI Pipeline

| | |
|---|---|
| **Status** | DEFERRED — 2026-09-10, ADR-028. Gates moved to `scripts/verify.sh` and `.githooks/pre-push`. |
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

**Definition of Done** — unchanged, and none of it is met. This task is deferred, not done.
- [ ] All seven PR steps run and each can fail the build, demonstrated once per step.
- [ ] Integration tests run against real Postgres and Redis in CI.
- [ ] The coverage gate fails a PR that drops service-layer coverage below the threshold.
- [ ] A dependency with a known critical CVE fails the build.

---

**Deferred 2026-09-10 at the project owner's request** (ADR-028). The project merges locally, so a `pull_request` workflow would have run on nothing while looking like a control — and that appearance is worse than an absence.

**What moved, rather than being dropped**: `scripts/check-id-endpoint-tests.mjs` was built in `P0-03` to enforce the zero-tolerance rule in `docs/SECURITY/05`, and was going to run in this pipeline. It now **blocks** in `.githooks/pre-push`, verified both ways: a diff adding an `:id` route with no test is refused, and the same diff plus a test passes. `scripts/verify.sh` runs the rest of what the pipeline would have run.

**What is simply gone until this task is picked up** — integration tests against real Postgres and Redis, the 80% service-layer coverage floor, SAST, dependency CVE scanning, and required reviewer approval. Local hooks are also bypassable with `--no-verify`, absent on a fresh clone until `pnpm install`, and never test a clean checkout.

**Revisit before Phase 3.** `docs/SECURITY/07` and `P3-16` assume a pipeline that can reject a change to payment code.

---

## P0-18 — Secrets and Configuration Conventions

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
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
- [x] `.env.example` lists every variable with a placeholder — verified by scanning all 377 tracked files, not by reading it.
- [x] The service refuses to start with a live payment key outside production, **and with a sandbox key inside it**. Exit 78, every violation named at once.
- [x] Secret scanning blocks at commit (`.githooks/pre-commit`) and sweeps the whole tree in `scripts/verify.sh`. **CI is deferred (ADR-028)**, so the hook is the only automated check — consistent with every gate since `P0-17`.
- [x] `deploy/SECRETS.md` gives twelve secrets a rotation procedure **and a blast radius**. The blast radius is the column that matters: a runbook without one tells you how to turn the key but not whether you can do it on a Friday afternoon.

**The rule worth understanding.** A live Midtrans key on staging is a valid string of the right shape and length — every per-field check passes it. Only a rule reading two values at once can tell it is catastrophically wrong, and "catastrophic" is literal: a staging test would charge a real card.

**The reverse is easier to miss and just as bad.** A sandbox key in production means every payment succeeds against the provider's test environment, no money arrives, and the orders look paid. Nothing errors, so nothing alerts. Expect this rule to fire during the first production deploy — by someone copying staging's configuration — and expect it to look like pedantry at exactly that moment.

**Found on the scanner's first run**: it flagged one of our own tests, the fake JWT fixture proving the `P0-12` redactor scrubs JWTs. That is the false-positive class the script's own comments predicted, and the documented escape (a word like `example` on the line) was exercised by accident on day one.

---

## P0-19 — Test Harness

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
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
- [x] All four layers have a real passing test. Two scope limits stated rather than hidden: `P0-22` builds the frontends, so E2E exercises the API over HTTP and the accessibility suite audits fixtures. Both would fail if the runner were misconfigured; neither audits a page a user will see.
- [x] `createTwoTenants()` exists and three IDOR tests are built on it, including the `docs/SECURITY/05` § 7 cross-tenant child case.
- [x] The integration suite **fails** without a database — verified, `vitest` exits **1**. Note the summary reads "15 skipped" because `beforeAll` threw; the exit code is what matters and what `verify.sh` acts on.
- [x] Isolation proven by two **deliberately identical** tests — if it were broken the second would see two users.

**This task found two real bugs, both invisible to every existing test because they only appear in the built artefact.**

1. **The API crashed on startup in the container.** `pino-pretty` is a devDependency stripped by `pnpm deploy --prod`, but compose runs that image with `NODE_ENV=development`. The logger chose its transport on `NODE_ENV`, tried to load a module that was not there, and pino threw during module initialisation — the process exited before serving a request. Present since `P0-12`. `NODE_ENV` was the wrong signal; it now asks whether `pino-pretty` resolves.

2. **The Dockerfile was two workspace members out of date.** It lists each member's `package.json` by hand for layer caching; `P0-16` added `packages/storage` and this task added `e2e`. The result was not an error — the image built and served whatever the cache last produced. E2E found it by asking for `/readyz`, a route that has existed since `P0-13`, and getting a 404.

**A smaller one worth knowing**: Playwright's default `testMatch` is `*.spec.ts`/`*.test.ts`. These are `*.e2e.ts`, so `playwright test` reported **"No tests found"** — a green-looking way to run nothing.

**The accessibility suite has a negative control** — a deliberately broken fixture with its violations named rather than counted. An axe suite that only ever sees a correct page reports zero violations whether it is working or doing nothing at all.

---

## P0-19.1 — Shared Logging Package

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
| **Size** | S |
| **Surface** | backend, packages |
| **Depends on** | P0-12, P0-15, P0-19 |
| **Spec refs** | `docs/DEVOPS/06-LOGGING-STRATEGY.md` |
| **Spec required** | No — an extraction of code `P0-12` already specified |

Extract `@wi/logging` so the API and the worker share one redacting logger.

Raised by `P0-15`, which shipped the worker with a logger carrying the comment "NOTE: this does NOT redact"; deferred by `P0-19`, which then had to apply one crash fix twice, once per copy. `docs/DEVOPS/06` § Mandatory Redaction requires redaction "at the logger middleware level, **not relying on manual developer discipline each time**" — which is precisely what that comment described. Numbered `.1` rather than taking a new task number because it closes debt from `P0-19` rather than adding scope to the phase.

**Definition of Done**
- [x] One package owns redaction, request context and job trace; the API and worker each keep only their service name.
- [x] **The worker redacts**, proven by a test against the factory it calls — not against a hand-built copy of its formatters.
- [x] A mechanism, not a comment, stops the next surface shipping its own logger: `scripts/check-logger-construction.mjs`, blocking in `verify.sh` and `.githooks/pre-push`.
- [x] Both container images build and run — verified, 7/7 E2E green against the rebuilt API and both worker pools starting.

**The inherited test suite could not have caught redaction being deleted.** It builds its own pino instance with a copy of the formatters, so nothing in it calls `createLogger`. Removing `redact()` from the real factory leaves all 39 of its assertions passing. `logger.spec.ts` closes that, and the gap is measured rather than asserted: the same mutation fails exactly two tests there and none in the old file. This is the second time this file has had a test that verified consistency instead of correctness — `P0-12`'s generated payload was the first.

**Two latent build bugs surfaced.** `backend/worker/Dockerfile` built no workspace dependencies at all (`--filter @wi/worker` without the trailing dots); it had been harmless only because the worker had no type-level workspace import until now. And `backend/api/Dockerfile`'s hand-maintained list of workspace manifests — which `P0-19` found two members stale and predicted would go stale again — was about to need a third entry. It is gone: `pnpm fetch` keys the dependency layer on the lockfile alone (ADR-036).

---

## P0-20 — Template Schema Definition and Validator

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
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
- [x] An unknown field path is rejected **naming the path**, and suggesting the near miss — a typo is the realistic cause and there are 39 paths to search by hand.
- [x] An unregistered component is rejected, and so is a **registered** one under the wrong `section_key` — a case the card did not ask for, which passes any name-only check while rendering a hero where the gallery belongs (R5).
- [x] The resolver lives in `@wi/schema`. The API's import is asserted over real HTTP (`test/surfaces.spec.ts`); the frontends are `P0-22`, and nothing in the package is backend-specific — one dependency, `zod`, and no Node-only import.
- [x] Emptiness is a table in `resolve-path.ts` with a case per row. The three carrying the most weight are the ones that must **not** count as empty: `0`, `false` and `"0"` — a `!value` check gets all three wrong and passes every test that only looks at the empty ones.

**Two documents disagreed and neither was amended.** `customizable_theme_keys` is a **column** (`docs/DATABASE/03` and `docs/API/03` against `docs/PLAN/07`'s prose), and `event` is **one** section key whose component renders the collection (`docs/PLAN/07` draws Akad and Reception beneath it; `docs/PLAN/08` says 1..N events).

**`docs/PLAN/07` § Theme Variables is genuinely incomplete** on `border_radius` and `typography.scale` — one example value each, no vocabulary. Enumerated provisionally (ADR-038) and raised as **OQ-20**, rather than accepting any string: an unknown CSS token renders as *nothing*, not as an error, so a typo would mean square corners on every invitation with no signal anywhere.

**A build guard carries the "validate before write" requirement into Phase 5.** `sections` and `theme` are `JSONB`, so the database cannot enforce `docs/DATABASE/03` § Schema Validation — the only thing between a malformed definition and every invitation using the template is that somebody remembered. `scripts/check-template-version-writes.mjs` blocks in `verify.sh` and on push.

**The test factory had been writing definitions nothing could render** — a CSS custom property where the theme belongs, and a section with no `configurable` key. Harmless while nothing read the column; every integration test would have carried invalid data the moment something did.

---

## P0-21 — Reference Template v1.0.0 and Demo Seed Data

| | |
|---|---|
| **Status** | DONE — 2026-09-10 |
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
- [x] `backend/api/src/infra/db/seed-data/reference-template.json` — a JSON file, and the format is the argument. A template in a `.ts` file is a template that *could* import something, and the first one that did would break `docs/PLAN/07` § Core Principles for every template after it.
- [x] `backend/api/test/reference-template.spec.ts` validates it against the `P0-20` schema, reading **the same bytes the seed reads**. A test with its own copy would pass while `db:seed` wrote something else.
- [x] Every referenced path is canonical — asserted directly rather than left to the validator, because that is the requirement the card states.
- [x] End-to-end rendering is `P2-02`'s, and its DoD already carries it: "Rendering the reference template with demo data produces every enabled section, in order, in a test."

**The strongest test is not on the card**: the demo invitation must fill every `required_field` of the template it ships beside, checked with `collectMissingRequiredFields` — twice, once against the seed files and once against the rows in the database. A catalogue demo with a hole in it fails on the one page whose job is setting expectations before a user commits.

**The demo is a real invitation owned by a system account** (`docs/PLAN/07` § Demo Data, ADR-022), not a fixture format — so it renders through the production renderer reading the production public API shape, with no second code path to drift. There is no `is_demo` column: ownership is the marker, which is what the document says. `backend/api/src/shared/demo/demo-account.ts` holds the ids so `P5`'s dashboard has one answer to import rather than a literal to copy.

**The system account cannot be logged into** — no password hash, no OAuth provider, and an address under RFC 2606's reserved `.invalid`. A seeded account with a known id and a usable credential is a back door that ships with the product; an integration test asserts all three.

**The gallery rows exist and the image bytes do not.** The demo page will show broken images until the upload pipeline (`P1-16`) or a template asset fills them. Written into `demo-invitation.json` beside the gallery rather than left to be discovered by whoever opens the page.

**JSON has no comments, so `_`-prefixed keys are annotations** and are stripped before validation. The reasoning behind each section — why gift defaults to off, why parents are optional, why `max_items` is 20 and not the package's 200 — belongs beside the value it explains. The cost is one shape of typo (`_section_key`) that `.strict()` would otherwise have caught.

---

## P0-22 — Frontend Skeletons and the Design System Package

| | |
|---|---|
| **Status** | DONE — 2026-09-11 |
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
- [x] `web-app` prerenders `/` and `/workbench`; `public-invite` **server-renders `/[slug]` on demand**, which is what `docs/FRONTEND/07` requires and not merely what it builds; `admin` builds a 228 kB bundle.
- [x] `scripts/check-design-tokens.mjs`, blocking in `verify.sh` and on push, mutation-verified. A script rather than an ESLint rule because `P0-17` is deferred (ADR-028) — it blocks today and moves later in one edit.
- [x] All thirteen components, audited twice: axe per component in jsdom, and axe per story in a **real browser**, which is the only place `color-contrast` can run at all.
- [x] Proven two ways: the package's own test reads its source with comments stripped and asserts no storage API appears in an executable line, and `scripts/check-token-storage.mjs` extends that to the other 132 files.
- [x] `Badge.tsx`, with a test that every status `docs/DATABASE/04`'s CHECK constraint allows has a presentation — the status list transcribed by hand, not generated from the map it checks.

**The browser pass earned its place immediately.** `Dropzone`'s disabled state used `opacity-60`, which axe blends to 4.49:1 — one hundredth under the 4.5:1 `docs/UI-UX/08` requires. Neither the jsdom axe pass (no layout engine, colour rules disabled) nor the arithmetic token test (nobody declares a blend) could see it. Disabled states now use chosen colours, in `Dropzone` and in `Field`, and both pairs are measured.

**Three token choices failed contrast on the first run**, the worst being `neutral-300` as the control border at **1.48:1** on white — the most common accessibility defect in modern form design, and a WCAG 2.1 § 1.4.11 failure. That is why there are two border tokens: `--color-border` separates things and has no floor; `--color-border-strong` is the boundary of a control and holds 3:1.

**Storybook was not used**, which the card allows ("or equivalent"). The workbench is a route in the real app, so it is compiled by the app's build with the app's tokens and audited by the `P0-19` harness in a real browser (ADR-041). The cost is stated there: a component with no story is a component the browser audit never sees.

**`public-invite` deliberately does not import the design tokens.** `docs/UI-UX/07` and `08` both describe application chrome; an invitation's palette is per-template data (`docs/PLAN/07`). Importing them would give every wedding the dashboard's indigo.

---

## P0-23 — Staging Environment, Wildcard DNS and TLS

| | |
|---|---|
| **Status** | **BLOCKED** — needs infrastructure nobody has provisioned yet (see below); addressing decided (ADR-024) |
| **Depends on** | P0-17 |
| **Spec refs** | `docs/DEVOPS/00-ENVIRONMENTS.md`, `docs/ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md`, `docs/DEVOPS/03-REVERSE-PROXY.md`, `docs/PLAN/10-DOMAIN-PUBLISHING.md` |
| **Spec required** | No |
| **Surface** | infra |

**Goal** — A staging environment that mirrors production's topology, including the host and path routing the product's publishing model depends on.

**What it is blocked on** — not a task, but access. Every step needs something that does not exist in the repository and cannot be created from it: a provisioned VPS in Singapore or Jakarta (ADR-015), control of DNS for `vizunicum.my.id`, and a Cloudflare account for the CDN, DNS and Turnstile. Steps 3 and 7 are specifically about proving TLS issuance and host routing **against the real hostnames**, which is the entire reason the task sits in Phase 0 — a simulation of it would prove nothing and would report green.

Everything that could be built without that infrastructure already has been: `deploy/docker-compose.yml` is the topology (`P0-05`), `deploy/helm/` is the Kubernetes path (`P0-26`), and the three applications it would serve are built (`P0-22`). What remains is provisioning and verification, in that order.

**Unblocking it** takes the VPS, the DNS zone and the Cloudflare credentials. It does **not** wait on `P0-17`: CI is deferred (ADR-028), so step 5 becomes a manual deploy until it is picked up.

**Why addressing belongs in Phase 0** — `docs/PLAN/10` (as amended by ADR-024) publishes invitations at `invitation.vizunicum.my.id/{slug}`, with the application on `app.vizunicum.my.id`. If routing and certificates are only set up in Phase 3 alongside publishing, the first time anyone discovers a DNS or TLS problem is the week publishing is supposed to ship.

**Steps**
1. Provision staging with the topology from `docs/ARCHITECTURE/08` on the target chosen in ADR-015 — a single VPS running Docker Compose behind Caddy, Cloudflare in front, R2 for object storage: reverse proxy, API, worker pools, web app, public-invite, admin static files, Postgres, Redis, ClamAV.
2. Configure routing per `docs/DEVOPS/03`: `invitation.vizunicum.my.id` → public-invite (`/{slug}`, `/preview/{token}`, `/public/*` proxied to the API), `app.vizunicum.my.id` → web app plus `/api/*`. The admin host follows in `P5-01`. **No wildcard record** — that is deliberate (ADR-024), and the two hosts are separate so guest-submitted content never shares an origin with the authenticated application.
3. Let Caddy issue and renew a certificate per hostname; verify renewal actually happens rather than assuming it.
4. Apply the environment separation rules from `docs/DEVOPS/00`: sandbox payment credentials, seeded data rather than a production copy, internal access restriction.
5. Wire the staging deploy pipeline from `P0-17`: migrate, deploy, smoke test, notify.
6. Add synthetic uptime checks from outside the infrastructure (`docs/DEVOPS/05` § Synthetic Monitoring).
7. Deploy a placeholder and confirm end to end that `invitation.vizunicum.my.id/some-slug` resolves, terminates TLS, and reaches the public-invite app with the slug available to the handler — and that `invitation.vizunicum.my.id/dashboard` does **not** reach the application, because that host serves only invitations.

**Definition of Done**
- [ ] `invitation.vizunicum.my.id/{slug}` reaches the public-invite app over HTTPS with the slug available to the handler, and nothing else on that host reaches any other app.
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
