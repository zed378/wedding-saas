# Changelog

Chronological summary of changes at a coarser grain than the individual records in [`records/`](./records/). If you want to know what happened and roughly when, read this. If you want to know why it was done that way, follow the link to the record.

This is the **internal** changelog. It is not the product's user-facing release notes, and it may describe work that has not shipped.

Format follows Keep a Changelog conventions, grouped by release once releases exist. Before the first release, entries are grouped by date.

---

## Unreleased

### 2026-09-10 — the template catalog and media

**Added** — four tables ([P0-08](./records/2026-09-10-P0-08-templates-media-schema.md))
- `templates`, `template_versions`, `media`, `template_assets`, matching `docs/DATABASE/03` and the `media` block of `06`.
- **Two delete rules, deliberately opposite.** `template_versions → templates` is `RESTRICT` because BR-3.3 says a version an invitation still renders from is deprecated, never deleted — a cascade would turn a catalog tidy-up into broken wedding pages. `template_assets → template_versions` is `CASCADE`, because an asset has no meaning without its version. They look inconsistent and are not; three tests pin them.
- `sections` and `theme` are JSONB with **no** database-level validation: `docs/DATABASE/03` puts that JSON Schema in application code (`P0-20`), where it can be versioned with the validator.
- `category` and `customizable_theme_keys` are real `varchar(n)[]` arrays, asserted as `ARRAY` rather than assumed — one of the concrete reasons ADR-007 picked Drizzle over Prisma.
- `media.status` defaults to `processing`: a row exists before the `docs/SECURITY/06` pipeline has run, and defaulting to `ready` would make a failed scan invisible.

**Deferred** — `media.invitation_id`'s **foreign key** lands in `P0-09` (ADR-032). `invitations` does not exist yet and `template_assets` needs `media` now, so no ordering satisfies every foreign key in one migration. The column, type, nullability and index are exactly as documented. A test asserts the constraint is currently absent and must be *replaced* when `P0-09` adds it — a test that flips to failing is a louder reminder than a note.

**Worth knowing** — `RESTRICT` raises SQLSTATE **23001** (`restrict_violation`); `NO ACTION` raises **23503** (`foreign_key_violation`). Both occur in this schema. Application code that maps only 23503 to a friendly "still in use" message will return a 500 for the RESTRICT case, which is the more common one.

### 2026-09-10 — the users and auth schema

**Added** — six tables ([P0-07](./records/2026-09-10-P0-07-users-auth-schema.md))
- `users`, `user_notification_preferences`, `refresh_tokens`, `user_tokens`, `user_mfa_factors`, `user_recovery_codes`, matching `docs/DATABASE/02-USERS.md` column for column, with `updated_at` triggers and a down migration.
- **The card named three tables; the document defines six.** The extra three are auth support in the same file, and shipping only three would have left `P1-04` (email verification) and `P5-02` (admin TOTP) adding tables from tasks that are not about schema.
- Only hashed or encrypted material is stored: `password_hash`, `token_hash`, `code_hash`, and `secret_encrypted` as `BYTEA`. A database read must not yield a usable credential.
- Every child table cascades from `users`, so a hard delete cannot leave a refresh token that still authenticates.

**Fixed** — **`docs/DATABASE/02-USERS.md` contradicted itself** and is amended (ADR-031). It declared `email VARCHAR(255) NOT NULL UNIQUE` *and* a partial unique index limited to `deleted_at IS NULL`. A column-level `UNIQUE` covers soft-deleted rows too, making the partial index unreachable and holding a deleted account's address until the hard delete ran a retention period later — the opposite of what `docs/SECURITY/09` and the task's own goal describe. The partial index is now the only uniqueness rule.

**Testing** — `pnpm --filter @wi/api test:integration` runs 22 constraint tests against a real PostgreSQL 18. They **fail rather than skip** when no database is reachable, because a skipped schema suite reports green for constraints nobody checked. Three were mutation-checked — dropping `idx_users_email`, `users_role_check` and the `updated_at` trigger each failed exactly the tests claiming to cover them.

### 2026-09-10 — migrations, and PostgreSQL 18

**Added** — migration tooling ([P0-06](./records/2026-09-10-P0-06-migration-tooling.md))
- `db:generate`, `db:migrate`, `db:rollback`, `db:seed`. Migrations are a deliberate step: nothing in the application imports the migrator, so a rolling deploy cannot have every replica race to alter the schema.
- **Two roles, two URLs.** Migrations connect as the owner; the API connects as a role that cannot alter schema. That split is a precondition for row-level security — an owner connection bypasses every policy silently — and it is verified from the failing side: `CREATE TABLE` as the application role returns `permission denied`.
- **The baseline creates no tables**, only `set_updated_at()`. Almost every table carries `updated_at DEFAULT NOW()`, and a default fires only on INSERT — without the trigger the column records creation time forever and lies on every edited row. The `WHEN (OLD.* IS DISTINCT FROM NEW.*)` clause keeps a no-op UPDATE from bumping it; both directions verified.
- **No `CREATE EXTENSION`.** `gen_random_uuid()` has been core since PostgreSQL 13, and `CREATE EXTENSION` needs superuser — a privilege the migration role now never has to hold.
- **Expand-contract is enforced, not documented.** A migration containing `DROP TABLE`/`DROP COLUMN`/`TRUNCATE` fails unless the file carries a `CONTRACT-PHASE:` justification. Drizzle emits `DROP COLUMN` for a simple rename, and that reads as routine in a diff.
- Drizzle generates no down migrations (ADR-030), so they are written by hand and a gate fails when one is missing — or when one is orphaned by a deleted migration. **`db:rollback` is a development tool, not production recovery**: reversing schema over live data is lossy, and `docs/DEVOPS/08` relies on expand-contract instead.
- `pnpm db:roundtrip` proves up → down → up against a real container, 9 assertions.

**Changed** — **PostgreSQL 16 → 18** (ADR-029), at the owner's request.
- The compose volume mount moved with it. PG18's image relocated `PGDATA` to `/var/lib/postgresql/18/docker` and declares `VOLUME /var/lib/postgresql`; the previous mount would **not** have errored — it would have mounted an empty named volume, written the real data to an anonymous one, and lost it on the first `docker compose down`, leaving a volume that still looked correct. Fix verified by writing a row, cycling the stack, and reading it back.
- Any existing local volume holds a version-16 cluster an 18 server will refuse. `docker compose -f deploy/docker-compose.yml down -v` clears it — free today, which is the argument for doing this now rather than at `P0-23`.

### 2026-09-10 — CI deferred, and the one gate that could not go with it

**Changed** — `P0-17` is **deferred**, not done ([record](./records/2026-09-10-P0-17-ci-deferred-local-gates.md), ADR-028)
- No GitHub Actions workflow was written. The project merges locally, so a `pull_request` pipeline would have triggered on nothing while sitting in the repository looking like a control.
- **`.githooks/pre-push` now blocks** a push that adds an `:id` endpoint without touching a test. `scripts/check-id-endpoint-tests.mjs` was built in `P0-03` to enforce the zero-tolerance rule in `docs/SECURITY/05`, and the pipeline was going to be its only caller — deferring CI without moving it would have returned the project's most important security rule to being a checklist item. Tested both directions: refused on a diff with no test, passed once a test was added.
- **`scripts/verify.sh`** runs what the pipeline would have run — format, lint, typecheck, test, the `:id` gate, the Helm chart, build. Run it before merging to `main`. Its output ends by listing what it does *not* cover, so a green run cannot be read as "CI passed".

**Not running anywhere until `P0-17` is picked up** — integration tests against real Postgres and Redis, the 80% service-layer coverage floor, SAST, dependency CVE scanning, and required reviewer approval. Local hooks are also bypassable with `--no-verify` and absent on a fresh clone until `pnpm install`. **Revisit before Phase 3**: `docs/SECURITY/07` and `P3-16` assume a pipeline that can reject a change to payment code.

**Fixed** — prettier was parsing Helm templates as YAML and failing `format:check` repository-wide. This shipped in `P0-26` because I ran lint, typecheck and test before committing but not `format:check`; the new `scripts/verify.sh` caught it on its first run, which is the argument for it existing.

### 2026-09-10 — the Kubernetes path exists on paper, and it lints

**Added** — `deploy/helm/` ([P0-26](./records/2026-09-10-P0-26-helm-charts.md))
- A chart deploying the API and the three worker pools (`media`, `general`, `cron`), with an ingress that keeps the public invitation origin separate from the authenticated application (ADR-024).
- **This is not the MVP deployment path.** ADR-015 stands: the MVP runs on one VPS with Docker Compose. The chart exists so that leaving a single host — risk R14 — is a deployment change rather than a project.
- **Two configurations the chart refuses to render.** A missing `image.tag`, because "roll back to the previous image" is the whole recovery plan and a moving tag makes that sentence meaningless. And `workers.pools.cron.replicaCount > 1`, because a second cron instance runs every scheduled job twice — two reminder emails to a real couple, silently, not an error in a log. Both were triggered deliberately and both fired.
- Every workload runs non-root with a read-only root filesystem, `seccompProfile: RuntimeDefault`, all capabilities dropped and resource limits set — asserted across all four rendered Deployments, not assumed from the helper.
- No credential is in the chart. Secrets come from a Secret that already exists in the namespace, via `envFrom` (`P0-18`).

**Known gap** — Kubernetes **schema** validation was not performed: `kubectl apply --dry-run` needs a reachable API server and there is no cluster here. The manifests are known to render and to be well-formed; they are not known to be accepted by a real Kubernetes version. `P0-23` owns that check.

### 2026-09-10 — the local stack runs

**Added** — `deploy/` and the local environment ([P0-05](./records/2026-09-10-P0-05-local-environment.md))
- `docker compose -f deploy/docker-compose.yml up -d` brings up PostgreSQL, Redis, MinIO, Mailpit and the API. The API waits for its dependencies to report **healthy**, not merely started.
- Multi-stage API image: non-root runtime with no package manager, no source and no dev dependencies. Healthcheck runs the app's own runtime rather than adding curl to the image.
- **Two things set up before there is anything to protect.** The application connects as a role that does not own its tables and has neither `SUPERUSER` nor `BYPASSRLS` — the moment row-level policies exist, an owner connection would bypass every one of them and no test would fail. Both storage buckets are created private; an unauthenticated GET returns 403, verified.
- ClamAV sits behind a compose profile: it holds about a gigabyte and nothing needs it before `P1-18`. A stack that is slow to start is a stack people stop starting.
- Host ports are overridable — forced by three real collisions (1025, 8025, 6379) on the development machine. A hardcoded host port turns "something else uses 6379" into "the stack will not start".
- A minimal `/health` (liveness only) was added ahead of `P0-13`, because the container healthcheck needs one. `P0-13` still owns readiness.

**Fixed** — `.dockerignore` was beside the `Dockerfile`, where Docker never reads it. Every image builds from the repository root, so it belongs there; until it was moved, host `node_modules` was copied into the image and overwrote pnpm's symlink farm, failing as `MODULE_NOT_FOUND` on `tsc`.

### 2026-09-10 — surfaces separated

**Changed** — repository layout ([P0-25](./records/2026-09-10-P0-25-surface-directories.md), [ADR-027](./DECISIONS.md))
- `apps/` replaced by **`backend/{api,worker}`**, **`frontend/{web-app,public-invite}`** and **`admin/`**, alongside the unchanged `packages/`.
- `admin/` sits beside `frontend/` rather than inside it because `docs/SECURITY/02` puts it behind its own trust boundary, on its own hostname, with its own session. The layout should argue for the architecture, not against it.
- Moved with `git mv`, so `git log --follow` still traces every file.
- **A knowing divergence**: `docs/FRONTEND/00` § Project Structure still describes `apps/` and was left unamended at the project owner's instruction. `CLAUDE.md` and `AGENTS.md` now state both the real layout and the fact that the document disagrees, so a session reading them first is not misled.

### 2026-09-10 — the API runs

**Added** — backend service skeleton ([P0-04](./records/2026-09-10-P0-04-backend-service-skeleton.md))
- `apps/api` is a running NestJS service: environment validated before anything is constructed, the three surfaces from `docs/ARCHITECTURE/01` mounted separately (`/api/v1`, `/public`, `/api/webhooks`), the middleware chain documented as an ordering with positions 6-8 reserved for rate limiting (`P1-07`), authentication (`P1-06`) and the error mapper (`P0-13`).
- **Configuration fails loudly**: a missing variable stops the service with exit 78 and names *every* offending variable at once — reporting one per restart is how people end up commenting out validation. Reserved variables are listed with the task that makes each required.
- **Bounded drain on shutdown**: idle keep-alive sockets released, in-flight requests left to finish, capped so a stuck request cannot hang a rollout.
- **The shared-package boundary is proven, not assumed.** The API imports from `@wi/schema` and a test asserts the value arrives over HTTP. ADR-004 chose one language on the strength of that boundary; if it breaks, `P0-20` would be the expensive place to find out.
- 16 tests. Runtime behaviour also exercised by hand against the built output: all three surfaces answered, `X-Frame-Options: DENY` (helmet defaults to SAMEORIGIN; `docs/SECURITY/08` asks for DENY), and a configuration-less start exited 78.

**Fixed** — a build that reported success and emitted nothing
- `tsc`'s incremental state lived beside the config, so `rm -rf dist` left it behind and the next build concluded there was nothing to do. `tsBuildInfoFile` now lives inside `dist/`. Invisible from CI, because a clean checkout has no stale state — and its symptom was a *green* build.

**Changed**
- `packages/*` compile to CommonJS in `dist/` with declarations, so the CommonJS NestJS app can consume them.
- Install scripts are denied by default through pnpm's `allowBuilds` policy; each package is decided one at a time rather than the protection being switched off.
- `CLAUDE.md` and `AGENTS.md`: real setup commands, and the Node version corrected to 24 to match ADR-004 as amended.

### 2026-09-09 — implementation begins

**Added** — repository structure ([P0-02, P0-03](./records/2026-09-09-P0-02-P0-03-repo-scaffolding-and-conventions.md))
- pnpm + Turborepo monorepo: `apps/{api,worker,web-app,public-invite,admin}` and `packages/{schema,template-renderer,ui,api-client,config}`. The API carries the twelve domain modules, five shared concerns and four infra adapters from `docs/ARCHITECTURE/01` as real directories; the worker carries its three pools.
- The workspace graph is real rather than declared: `@wi/template-renderer` resolves from both `web-app` and `public-invite`, which is the property `docs/FRONTEND/04` depends on.
- Node pinned to **24 LTS** — ADR-004 named 22, which is now in maintenance. A version correction inside an accepted decision.

**Added** — traceability gates
- `commit-msg` hook rejecting any subject without a task ID, verified by execution.
- PR template requiring the task, the specification sections, test layers, the security review flag and the IDOR test for any new `:id` endpoint; `CODEOWNERS` marking `docs/SECURITY/`, `docs/DATABASE/` and `docs/API/` for explicit review.
- **The `:id` guard**: CI fails any diff that adds a route taking a path parameter without touching a test file, and its message names `docs/SECURITY/05` and the helper that makes the test a one-liner. `docs/SECURITY/05` has zero tolerance, and a convention people are asked to remember is one that gets skipped invisibly.
- `.gitattributes` forcing LF — unplanned, and added because git was rewriting shell hooks to CRLF, which fails in a Linux container far from where it was introduced.

**Changed** — branching strategy ([ADR-026](./DECISIONS.md))
- **One branch per phase** rather than per task: all of a phase lands on `feat/phase-<n>-<slug>`, which merges to `main` only when the phase's acceptance task is `DONE`. `main` carries no in-progress development code. Documentation-only changes still go to `main` directly.
- Phase 0 work moved to `feat/phase-0-foundation` before anything was committed, so `main` still holds only the four specification commits.

**Not done yet** — branch protection is not enabled on the GitHub repository, so `CODEOWNERS` and the CI checks are advisory until it is. That is a repository settings change.

### 2026-09-09 — gift account numbers reclassified

**Changed** — data classification and the encryption decision ([record](./records/2026-09-09-gift-account-data-reframing.md), [ADR-025](./DECISIONS.md))
- `invitation_bank_accounts.account_number` is **sensitive personal data the couple enters in order to publish**, so a guest who cannot attend can send a gift directly to their bank. It is **not a platform payment credential** — nothing in the system moves money with it. `docs/SECURITY/00` had grouped it with password hashes and tokens; that row is now split into "Critical — secrets" and "Critical — sensitive personal data".
- **`OQ-10` answered: no column-level encryption.** It would protect only the subset that is not already public — drafts and gift-disabled invitations — inside a database holding names, addresses, coordinates and full guest lists in plaintext beside it. Storage-level encryption of the whole store is the proportionate control, and column encryption would foreclose a genuine fraud query.

**Added** — the risk the reframing exposed
- **R16**: gift account tampering. An attacker who changes the number on a live invitation collects every guest's gift, and the couple finds out after the wedding. Confidentiality was never the property under threat here; integrity is, and no risk in the register had covered it.
- Bank account writes now carry an audit trail, and a **non-optional email** notifies the owner whenever gift details change on a published invitation — the way a bank confirms a payee change (`docs/PLAN/13`).
- `payments.raw_callback_payload` scoped separately and also left unencrypted: it is retained precisely so a signature can be re-verified in an investigation, which redaction would defeat.

### 2026-09-09 — pricing and publishing address decided

**Decided** — commercial model ([record](./records/2026-09-09-pricing-and-publishing-address.md), [ADR-023](./DECISIONS.md))
- **One package: Rp 139,000 for 12 months**, 200 photos at 10 MB, no watermark. The Basic/Premium split is gone — a single price means a single tier.
- **Free tier is one draft**: an account may hold at most one invitation that has never reached `paid`. A paid invitation stops counting, so a wedding organizer with five paid invitations can still start a sixth draft (new BR-1.4).
- Renewal is another Rp 139,000 for another 12 months. `addons` ships with **no active rows** — `custom_domain` waits for Phase 2, `extended_validity` is redundant beside a 12-month package.
- Read as a 12-month validity with manual renewal, **not** recurring billing; that interpretation is stated in the ADR rather than assumed.
- Knock-on effects: checkout stops being a comparison page (`docs/UI-UX/13`), media limits collapse to one row (`docs/PLAN/11`), and the watermark narrows to free drafts and previews only — no published invitation carries one (`docs/UI-UX/14`).

**Changed** — publishing addresses ([record](./records/2026-09-09-pricing-and-publishing-address.md), [ADR-024](./DECISIONS.md))
- Invitations are published at **`invitation.zedth.my.id/{slug}`** — path-based on a fixed hostname. **No wildcard DNS record and no wildcard certificate**, because programmatic DNS management is not in place yet.
- Three fixed hostnames, added as each surface is built: `invitation.zedth.my.id` (public invitations, previews, proxied public API), `app.zedth.my.id` (application and API, from `P0-23`), `admin.zedth.my.id` (admin, from `P5-01`).
- The public surface stays on **its own origin** rather than sharing one with the application. Guest-submitted content renders there, and a shared origin would let a stored XSS act against the authenticated app — a containment the wildcard design provided for free.
- Slug resolution is now **strategy-driven** (`docs/BACKEND/06`): path today, subdomain later, one implementation. Migration is configuration plus DNS, with published path URLs redirecting permanently and indefinitely.
- Per-invitation subdomains merge into `P7-01` alongside custom domains — the same programmatic-DNS capability serves both.
- New risk **R15**: an unreserved application route could shadow a published invitation. Closed by construction — that host serves only invitations, and CI fails on a route not present in `slug_blocklist`.
- 20 documents amended; `maindomain.com` placeholders replaced with the real hostnames throughout.

**Status** — `TASKS/PROGRESS.md` now shows **no blocked tasks**. Five open questions remain and none stops work.

### 2026-09-09 — stack decided, specification gaps closed

**Decided** — the technology stack ([P0-01](./records/2026-09-09-P0-01-stack-decision.md), ADR-004 through ADR-017)
- TypeScript on Node 22 with NestJS; pnpm + Turborepo monorepo; Next.js for the app and the public invitation, Vite for admin; Drizzle ORM; Zod as the single validation vocabulary; BullMQ on Redis; sharp with ClamAV in an isolated worker.
- Cloudflare R2 for object storage with Cloudflare CDN, DNS and Turnstile at the edge; Midtrans for payments; Resend for transactional email; MapLibre in the editor with no map SDK at all on the public page; a single VPS running Docker Compose behind Caddy.
- Vitest, Testcontainers and Playwright for tests; GitHub Actions, Semgrep and OWASP ZAP for CI; Pino, OpenTelemetry, Prometheus and Sentry for observability.
- Six open questions closed (`OQ-01`, `OQ-02`, `OQ-03`, `OQ-04`, `OQ-06`, `OQ-09`). Blocked tasks dropped from seven to two — only pricing (`OQ-05`) and the domain name (`OQ-08`) remain, and both are answers only the project owner can give.

**Changed** — all 17 specification gaps resolved, `docs/` amended ([record](./records/2026-09-09-specification-gap-remediation.md), ADR-018 through ADR-022)
- **The two contradictions.** A resource that exists but is not yours now returns **404** everywhere, never 403 — `docs/API/00` had documented both, and a differentiating status code is an enumeration oracle (ADR-018). A **refund returns the invitation to `draft`**, not `paid` — `docs/PLAN/02` and `docs/BACKEND/05` disagreed, and the difference was whether a refunded customer keeps the ability to republish for free (ADR-019).
- **Five tables added** (ADR-020): `user_tokens`, `user_mfa_factors`, `user_recovery_codes`, `invitation_preview_tokens`, `invitation_view_counts`, `slug_blocklist` — every credential-shaped value stored hashed or encrypted. Two new files: `docs/DATABASE/11-ANALYTICS.md` and `docs/DATABASE/12-PLATFORM-CONFIG.md`.
- **Six endpoints added** (ADR-021): single-media read, owner-side RSVP management with CSV export, owner-side guestbook moderation, template version upgrade, the public watermark flag, and a guest report endpoint that gives the admin moderation queue an actual source.
- **Five documentation corrections** (ADR-022): where settings fields physically live, addon availability at MVP, who performs the `pending_payment` transition, where demo data lives, and three tables `docs/ARCHITECTURE/04` listed that do not exist.
- `docs/PLAN/18-RISK-REGISTER.md` gained **R13** (one vendor carries storage, CDN, DNS and CAPTCHA) and **R14** (single-host deployment, no redundancy at MVP), both consequences of the hosting decision rather than oversights.
- `docs/` grew from 121 to 123 files; 24 documents were amended.

### 2026-09-09 — earlier

**Added** — the execution layer ([P0-24](./records/2026-09-09-P0-24-tasks-and-memory-scaffolding.md), [ADR-003](./DECISIONS.md))
- `TASKS/` — task conventions with an 11-item global Definition of Done, eight phase files covering **133 tasks**, a progress board, and a backlog. Every task names the specification documents it implements, its dependencies, and — where relevant — the abuse cases it must have automated tests for.
- Phase boundaries follow `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` exactly, so the plan and the roadmap cannot drift. The roadmap's two prose-stated critical dependencies are now encoded as task dependencies: the template system before editor work (`P0-20`, `P0-21` → `P1-22`, `P1-23`), and the payment security review before production (`P3-16`).
- The tenant-scoped repository layer became a Phase 0 task (`P0-11`) rather than an implicit expectation of Phase 1, so that `docs/SECURITY/05`'s zero-tolerance rule is a property of the data layer instead of a review checklist.

**Changed** — the record layer ([P0-24](./records/2026-09-09-P0-24-tasks-and-memory-scaffolding.md))
- `MEMORY/` restructured to the record format: `MEMORY-INDEX.md`, `CHANGELOG.md`, `DECISIONS.md`, `records/`, `specs/`, `templates/`.
- `MEMORY/LOG/` → `MEMORY/records/`, existing entry migrated unchanged.
- `MEMORY/STATE.md` **removed**; `TASKS/PROGRESS.md` is now the single status board. Two snapshots drift, and then neither is trusted.
- `MEMORY/DECISIONS.md` rewritten in ADR format. The two existing decisions are preserved as ADR-001 (single canonical documentation language) and ADR-002 (stack not yet chosen); ADR-003 records the establishment of `TASKS/` and `MEMORY/`; a pending-decisions table lists the 16 decisions `TASKS/` expects to need.
- `CLAUDE.md` and `AGENTS.md` amended: their MEMORY sections describe the new structure, and their documentation maps and workflows now include `TASKS/`. They previously instructed agents to write to `MEMORY/STATE.md` and `MEMORY/LOG/`, which no longer exist.

**Found** — while writing the plan against the specification ([`TASKS/BACKLOG.md`](../TASKS/BACKLOG.md))
- **Two contradictions between documents**, both of which would have become bugs:
  - `PG-01` — `docs/API/00-API-STANDARDS.md` documents *both* 403 and 404 for "the resource exists but is not yours", while `docs/SECURITY/04`, `docs/SECURITY/05`, `docs/TESTING/04` and `CLAUDE.md` all require 404. `docs/API/05` then specifies 403 for that case.
  - `PG-14` — a refund sends the invitation to `draft` per `docs/PLAN/02` BR-5.4 and to `paid` per `docs/BACKEND/05` § Refund. The difference decides whether a refunded customer keeps the ability to republish for free.
- **Fifteen further specification gaps**, most of them a table or endpoint the specification requires functionally but never models: verification and reset tokens (`PG-06`), share-preview tokens (`PG-04`), page view counts (`PG-12`), admin 2FA factors (`PG-13`), the slug blocklist (`PG-15`), owner-side RSVP endpoints (`PG-10`), owner-side guestbook moderation (`PG-11`), a single-media read endpoint the frontend polls (`PG-03`), and the watermark flag the public renderer needs but never receives (`PG-09`).
- **Thirteen open questions** needing a decision from the project owner — stack, payment provider, hosting, email provider, pricing, maps provider, domain, CAPTCHA vendor, encryption at rest, account deletion semantics, team size, watermark design, and the language of these two folders. Seven block a specific task; `OQ-01` blocks all of Phase 0.
- **Fourteen `docs/` amendments** are now owed by the tasks that resolve these gaps, tracked in `TASKS/PROGRESS.md` § Specification Amendments Owed.

### 2026-09-09 — earlier

**Added** — the specification ([record](./records/2026-09-09-documentation-set-and-agent-instructions.md))
- `docs/` — 121 documents across PLAN, ARCHITECTURE, API, DATABASE, SECURITY, UI-UX, FRONTEND, BACKEND, DEVOPS and TESTING, expanded from a rough outline into full content: SQL schemas with real types and constraints, endpoint contracts with request and response examples, the template section and theme schema, the invitation lifecycle state machine, a STRIDE threat model, and a per-layer test strategy.
- `CLAUDE.md` and `AGENTS.md` — agent operating instructions, including the non-negotiable rules that govern implementation: templates are data not code, invitation data is independent of the template, object-level authorization on every `:id` endpoint, payment status server-decided only, prices recalculated server-side, all free text sanitized, uploads through the full validation pipeline, state transitions logged.
- `MEMORY/` — initialized with a state snapshot, a decision log and the first log entry.

**Changed**
- The Indonesian `docs/` was deleted and `docs-en/` renamed to `docs/`, leaving one canonical English documentation set ([ADR-001](./DECISIONS.md)). User-facing product copy remains Bahasa Indonesia.
