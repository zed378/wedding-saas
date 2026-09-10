# Memory Index

Every change record, newest first. One line each: date, task ID, title, and the hook that tells you whether this is the record you need.

Add a line here as part of writing the record — an unindexed record is a record nobody finds.

---

## Records

| Date | Task | Record | Hook |
|---|---|---|---|
| 2026-09-10 | P0-15 | [Queue and worker skeleton](./records/2026-09-10-P0-15-queue-worker-skeleton.md) | The idempotency pattern in `docs/BACKEND/08` is **racy as written** — two workers pass the check before either marks, which credits a payment twice. `SET NX` makes it one operation. A failed attempt must release its claim or "retry 3 times" becomes "try once, no-op twice" with identical logs. Leader election is a lease, not consensus; idempotency is what makes duplicates safe |
| 2026-09-10 | P0-14 | [Audit and status writers](./records/2026-09-10-P0-14-audit-status-writers.md) | `record(tx, …)` takes a transaction it cannot open, so an audit row cannot outlive a failed action. `pending_payment → paid` is SYSTEM-only **including for admins** — an admin who can mark an order paid can grant a free product. A first-match rule lookup let the 90-day sweep shadow a user's own delete, so delete worked in every state except `expired` |
| 2026-09-10 | P0-13 | [Envelope, error mapping, health](./records/2026-09-10-P0-13-envelope-errors-health.md) | The error mapper forwards only recognised error types — a pg message carries SQL, a Node message carries a file path, and no care at the call site fixes that. `ForbiddenError` cannot express "someone else's resource", so ADR-018 is kept by the type system. Readiness returned a correct 503 while logging `error: ""`, because `pg` throws an AggregateError with an empty message |
| 2026-09-10 | P0-12 | [Structured logging with redaction](./records/2026-09-10-P0-12-structured-logging.md) | Redaction is a key-name walk at any depth, not a pino path list, and it also scrubs bearer tokens hiding under innocent keys. **A test generated from the code it tests verifies consistency, never correctness** — mine could not have caught a key being deleted from the set, which a mutation check exposed |
| 2026-09-10 | P0-11 | [Tenant-scoped repository layer](./records/2026-09-10-P0-11-tenant-scoped-repository.md) | The project's number-one security control. A branded `TenantScope` makes an unscoped query a **compile** error; non-owner, soft-deleted and non-existent all return the same `null` so existence cannot leak through a status code; the admin bypass writes its own audit row in-transaction and fails closed. Four mutation checks. The load-bearing part is the build guard, not the repository |
| 2026-09-10 | P0-10 | [Commercial tables](./records/2026-09-10-P0-10-orders-payments-schema.md) | Two constraints carry more weight than anything else in the schema: `UNIQUE (provider, provider_reference_id)` is the whole webhook idempotency story, and `REVOKE UPDATE, DELETE ON audit_logs` is what makes the audit trail one. The permission test must connect as the **application role** — as the owner it passes either way. The round trip used to leave the database unseeded |
| 2026-09-10 | P0-09 | [The invitation aggregate](./records/2026-09-10-P0-09-invitations-schema.md) | The UNIQUE-versus-soft-delete contradiction appears a **second** time (ADR-033) — the spec used `UNIQUE` as a reflex; `users` and `invitations` are the whole affected set. Thirteen tables, not the ten the card lists. A sweep test asserts every table with `updated_at` has its trigger, including tables that do not exist yet |
| 2026-09-10 | P0-08 | [Template catalog and media schema](./records/2026-09-10-P0-08-templates-media-schema.md) | `RESTRICT` raises SQLSTATE **23001**, `NO ACTION` raises **23503** — both appear in this schema, and code mapping only 23503 would 500 on the common case. Two delete rules one level apart are deliberately opposite (BR-3.3) and will look like a mistake to tidy up. `media.invitation_id`'s FK is deferred to `P0-09` (ADR-032) |
| 2026-09-10 | P0-07 | [Users and auth schema](./records/2026-09-10-P0-07-users-auth-schema.md) | `docs/DATABASE/02` defined email uniqueness twice and incompatibly — a column `UNIQUE` makes the partial index unreachable and holds a deleted account's address hostage (ADR-031). Six tables, not the three the card names. 22 constraint tests, three of them **mutation-checked** by dropping the constraint and watching the right test fail |
| 2026-09-10 | P0-06 | [Migration tooling, the baseline, and PostgreSQL 18](./records/2026-09-10-P0-06-migration-tooling.md) | PostgreSQL 18 moved `PGDATA` **and** its declared volume — the old compose mount does not error, it mounts an empty named volume and loses the data on the first `down`. Drizzle generates no down migrations, so they are hand-written and gate-checked. `gen_random_uuid()` needs no extension since PG13, which keeps superuser out of the migration path |
| 2026-09-10 | P0-17 | [CI deferred, and the gates that had to move](./records/2026-09-10-P0-17-ci-deferred-local-gates.md) | Skipping CI would have silently returned the zero-tolerance IDOR rule to being a sentence in a document — its enforcement script had no caller but the pipeline. Now blocks in `pre-push`, tested both directions. The new `scripts/verify.sh` caught a formatting break already merged in `P0-26` on its first run |
| 2026-09-10 | P0-26 | [Helm charts for the Kubernetes path](./records/2026-09-10-P0-26-helm-charts.md) | Two configurations the chart refuses to render — a missing `image.tag`, and a second cron replica that would run every scheduled job twice. Kubernetes schema validation could **not** be performed: no cluster is reachable, so the manifests are known to render, not known to be accepted |
| 2026-09-10 | P0-05 | [Local environment via Docker Compose](./records/2026-09-10-P0-05-local-environment.md) | The whole stack, verified by running it rather than reading it: buckets private (403 on anonymous GET), container non-root, startup gated on real health. `.dockerignore` beside the Dockerfile is silently ignored — Docker reads it from the context root, and the symptom points nowhere near the cause |
| 2026-09-10 | P0-25 | [Surfaces separated into backend, frontend, admin](./records/2026-09-10-P0-25-surface-directories.md) | Layout now mirrors the trust boundaries rather than the languages, which is why `admin/` sits beside `frontend/` and not inside it. A knowing, recorded divergence: `docs/FRONTEND/00` still says `apps/` and was left unamended at the owner's instruction |
| 2026-09-10 | P0-04 | [Backend service skeleton](./records/2026-09-10-P0-04-backend-service-skeleton.md) | The API runs: validated config that exits 78 naming every missing variable, three surfaces mounted separately, a bounded drain that releases idle keep-alive sockets but not busy ones. Found a build that reported success and emitted nothing — a stale `.tsbuildinfo` surviving `rm -rf dist`, invisible from CI because a clean checkout has none |
| 2026-09-09 | P0-02, P0-03 | [Repository structure and the gates that keep it honest](./records/2026-09-09-P0-02-P0-03-repo-scaffolding-and-conventions.md) | Monorepo scaffolded and the workspace graph proven; three conventions turned into build failures, including a guard that fails any diff adding an `:id` route without touching a test. Found the repo already had four commits in a different convention — checking `git log` before installing a gate is what surfaced it |
| 2026-09-09 | P1-13 | [Gift account data reframing](./records/2026-09-09-gift-account-data-reframing.md) | The account number is published on purpose, so guests can send a gift — not a payment credential. Encryption protects only the subset that is not already public. The reframing exposed the attack nobody had written down: swap the number on a live invitation and collect every guest's gift, silently. Now R16, with an audit trail and a non-optional owner email |
| 2026-09-09 | P3-01, P0-23 | [Pricing and publishing address](./records/2026-09-09-pricing-and-publishing-address.md) | Rp 139,000 for 12 months, one package, one free draft; invitations at `invitation.zedth.my.id/{slug}` with no wildcard DNS. The care went into not collapsing everything onto one host — guest-submitted content sharing an origin with the dashboard would have handed a stored XSS a path the wildcard design never gave it. Board now has zero blocked tasks |
| 2026-09-09 | — | [Specification gap remediation](./records/2026-09-09-specification-gap-remediation.md) | All 17 gaps closed and `docs/` amended: five tables, six endpoints, two new DATABASE files, 24 documents touched. The two contradictions were the point — a status code that would have leaked resource existence on some endpoints and not others, and a refund that returned the money and left the customer the product |
| 2026-09-09 | P0-01 | [The stack is decided](./records/2026-09-09-P0-01-stack-decision.md) | TypeScript monorepo, NestJS, Next.js, Drizzle, Cloudflare R2, Midtrans, single VPS. The deciding argument was not preference: the field-path resolver has to behave identically in the backend validator and the editor checklist, and one language makes that a package rather than a discipline. Two vendor concentrations accepted and recorded as R13 and R14 |
| 2026-09-09 | P0-24 | [TASKS and MEMORY scaffolding](./records/2026-09-09-P0-24-tasks-and-memory-scaffolding.md) | The execution layer: 133 tasks across eight phases, each naming its specification refs, DoD and abuse cases. Writing it against `docs/` surfaced 17 specification gaps and 13 open questions — including two contradictions that would have become bugs, one of them with a money consequence |
| 2026-09-09 | — | [Documentation set, translation, agent instructions](./records/2026-09-09-documentation-set-and-agent-instructions.md) | How the 121-document specification came to exist: expanded from a bullet outline, written twice (Indonesian then English), then consolidated to one English set. Also the origin of `CLAUDE.md`, `AGENTS.md` and `MEMORY/` |

---

## By Phase

### Pre-Phase-0 — Specification
- [Documentation set, translation, agent instructions](./records/2026-09-09-documentation-set-and-agent-instructions.md) — the whole of `docs/`, and the decision to keep one canonical language (ADR-001)

### Pre-Phase-0 — Specification amendments
- [Specification gap remediation](./records/2026-09-09-specification-gap-remediation.md) — closes PG-01 through PG-17; a documented deviation is a decision, an undocumented one is a bug nobody has found yet

### Phase 0 — Foundation
- `P0-01` — [The stack is decided](./records/2026-09-09-P0-01-stack-decision.md) — the constraint that chose the language was one sentence in `docs/FRONTEND/03`
- `P0-05` — [Local environment](./records/2026-09-10-P0-05-local-environment.md) — an unprivileged database role and private buckets, set up before there is anything to protect
- `P0-26` — [Helm charts](./records/2026-09-10-P0-26-helm-charts.md) — the escape route from the single-host risk, written while it is still cheap; guard rails that fail the render rather than the cluster
- `P0-17` — [CI deferred](./records/2026-09-10-P0-17-ci-deferred-local-gates.md) — **deferred, not done**; what moved to local hooks, and the five gates that now run nowhere
- `P0-06` — [Migration tooling](./records/2026-09-10-P0-06-migration-tooling.md) — two roles so the app cannot alter its own schema, expand-contract enforced by a gate, and a silent-data-loss trap in the PG18 image
- `P0-07` — [Users and auth schema](./records/2026-09-10-P0-07-users-auth-schema.md) — a contradiction in the spec found by reading it before writing code; constraints proven by violating them, and the tests proven by breaking the schema
- `P0-08` — [Templates and media](./records/2026-09-10-P0-08-templates-media-schema.md) — a circular foreign key across a task boundary, and the SQLSTATE distinction between RESTRICT and NO ACTION
- `P0-09` — [The invitation aggregate](./records/2026-09-10-P0-09-invitations-schema.md) — cascade and restrict in opposite directions, three levels deep, each one tested
- `P0-10` — [Commercial tables](./records/2026-09-10-P0-10-orders-payments-schema.md) — idempotency and append-only pushed down to the database, where application code cannot forget them
- `P0-11` — [Tenant-scoped repository](./records/2026-09-10-P0-11-tenant-scoped-repository.md) — making the wrong query impossible to write rather than easy to catch
- `P0-12` — [Structured logging](./records/2026-09-10-P0-12-structured-logging.md) — redaction that does not depend on anyone remembering, and a correlation id that does not need threading
- `P0-13` — [Envelope and errors](./records/2026-09-10-P0-13-envelope-errors-health.md) — one response shape, and an error path that cannot leak because it never forwards what it does not recognise
- `P0-14` — [Audit and status writers](./records/2026-09-10-P0-14-audit-status-writers.md) — making 'log the transition' structural rather than remembered
- `P0-15` — [Queue and workers](./records/2026-09-10-P0-15-queue-worker-skeleton.md) — three failure modes that produce no error: double-charging, vanished jobs, duplicate emails
- `P0-25` — [Surfaces separated](./records/2026-09-10-P0-25-surface-directories.md) — a deviation the owner asked not to close in `docs/`; carried in the record instead
- `P0-04` — [Backend service skeleton](./records/2026-09-10-P0-04-backend-service-skeleton.md) — a green build that produced no artifact; and the shared-package boundary asserted rather than assumed
- `P0-02`, `P0-03` — [Repository structure and gates](./records/2026-09-09-P0-02-P0-03-repo-scaffolding-and-conventions.md) — a checklist people are asked to remember is one that gets skipped invisibly; three of them are now build failures
- `P0-23`, `P3-01` — [Pricing and publishing address](./records/2026-09-09-pricing-and-publishing-address.md) — the literal reading of the request would have cost a security property; two DNS records kept it
- `P0-24` — [TASKS and MEMORY scaffolding](./records/2026-09-09-P0-24-tasks-and-memory-scaffolding.md) — a plan that goes stale is worse than none, so the board is updated in the commit that changes the code

### Phase 1 — Auth and Invitation Core
- `P1-13` — [Gift account data reframing](./records/2026-09-09-gift-account-data-reframing.md) — a classification table that groups a published gift number with a password hash will produce wrong decisions downstream

### Phase 2 — Template Rendering and Preview
_No records yet._

### Phase 3 — Order, Payment and Publishing
_No records yet._

### Phase 4 — Engagement
_No records yet._

### Phase 5 — Admin Panel
_No records yet._

### Phase 6 — Hardening and Launch
_No records yet._

### Phase 7 — Post-Launch
_No records yet._

---

## By Kind

Some records are worth finding by what they are rather than when they happened.

| Kind | Records |
|---|---|
| Phase summaries | _none yet_ |
| Specification amendments | [Gap remediation](./records/2026-09-09-specification-gap-remediation.md) — 17 gaps, 24 documents, 2 new DATABASE files |
| Stack and architecture decisions | [P0-01](./records/2026-09-09-P0-01-stack-decision.md) — ADR-004 through ADR-017 |
| Product and commercial decisions | [Pricing and publishing address](./records/2026-09-09-pricing-and-publishing-address.md) — ADR-023, ADR-024 |
| Threat model corrections | [Gift account data reframing](./records/2026-09-09-gift-account-data-reframing.md) — ADR-025, R16 |
| Security verification (IDOR sweeps, pentest, payment review) | _none yet_ |
| Performance and load results | _none yet_ |
| Disaster recovery and rollback drills | _none yet_ |
| Incidents and post-mortems | _none yet_ |
