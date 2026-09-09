# Decision Log (ADRs)

Every architectural decision `docs/` left open, and every deviation from what `docs/` decided.

**When to write one**: a decision the specification does not contain; a deviation from the specification (mandatory, per the deviation protocol in `TASKS/00-TASK-CONVENTIONS.md`); a choice that will be questioned later; or a decision **not** to build something.

**When not to**: an implementation detail that is obvious from the code and would not be questioned.

## Format

```
## ADR-NNN — <Title>

| | |
|---|---|
| Date | YYYY-MM-DD |
| Status | Proposed / Accepted / Superseded by ADR-NNN / Rejected |
| Task | <task id> |
| Deciders | |

Context — the situation forcing a choice, and the constraints on it.

Decision — what was chosen, stated plainly.

Alternatives considered — each option, and the specific reason it was not chosen.
This is the section that makes an ADR worth keeping: it tells a future reader
whether their idea was already evaluated or genuinely never considered.

Consequences — what this makes easier, what it makes harder, and what it
forecloses. Include the drawbacks. An ADR listing only benefits will not be
trusted when someone needs to decide whether to revisit it.

Specification impact — none, or: which docs/ file should be amended, and whether it has been.
```

Numbers are sequential and permanent. A superseded ADR stays in place with its status updated and a pointer forward; deleting it destroys the reasoning trail that is the entire point.

---

## Decisions Pending

Decisions `TASKS/` has identified as needing an ADR, listed here so they are not discovered late. Each moves into the log below when made.

| Task | Decision needed | Why it matters |
|---|---|---|
| ~~P0-01~~ | ~~Backend, ORM, frontend, monorepo, queue, storage, image library, payment provider~~ — **decided 2026-09-09**, ADR-004 through ADR-017 | `OQ-01`, `OQ-02`, `OQ-03`, `OQ-04`, `OQ-06`, `OQ-09` answered. Supersedes ADR-002 |
| ~~P0-13~~ | ~~403 versus 404 for another user's resource~~ — **decided 2026-09-09**, ADR-018: 404 | `PG-01` resolved; four documents amended |
| ~~P5-08~~ | ~~Refund target status~~ — **decided 2026-09-09**, ADR-019: `draft` | `PG-14` resolved; four documents amended |
| ~~P3-01~~ | ~~Is the `custom_domain` addon sellable before the feature exists~~ — **decided 2026-09-09**, ADR-022: seeded inactive | `PG-05` resolved |
| ~~P1-15 / P5-04~~ | ~~Template version upgrade as a distinct endpoint~~ — **decided 2026-09-09**, ADR-021: yes, separate endpoint | `PG-16` resolved |
| ~~P5-09~~ | ~~How content gets reported for moderation~~ — **decided 2026-09-09**, ADR-021: a rate-limited public report endpoint that flags rather than hides | Gives the admin queue a real source |
| P0-18 | Where secrets live per environment | Narrowed by ADR-015 (single VPS): the practical choice is a file-based store on the host versus a managed secrets service |
| P1-01 | Breached-password check: fail open or fail closed | Failing closed blocks legitimate registration during a third-party outage; failing open weakens the control silently |
| P1-07 | Rate limiting behaviour when Redis is unavailable | Fail open means no limiting at all; fail closed means no logins at all. The answer may differ per policy. Sharpened by ADR-009: Redis now also carries the job queue |
| P1-08 | Account deletion while an invitation is published | `OQ-11`. A legal question as much as a product one |
| ~~P1-13~~ | ~~Encryption at rest for `invitation_bank_accounts.account_number`~~ — **decided 2026-09-09**, ADR-025: no column encryption; storage-level encryption plus integrity controls | `OQ-10` resolved. The reframing added R16 and a mandatory owner notification |
| P3-01 | Package and addon pricing; free draft quota | `OQ-05`. Nothing can launch on placeholders |
| P4-05 | CAPTCHA activation threshold | Vendor decided (ADR-011: Turnstile); the traffic threshold that switches it on is still open |
| P6-13 | Which kill-switches exist as feature flags | `docs/SECURITY/12` § Containment assumes they exist |
| P7-01 | Custom domain TLS: Caddy on-demand TLS at the origin, or Cloudflare SSL for SaaS | ADR-015 chose Caddy partly to keep this option free; revisit when the feature is scheduled |

---

## Log

### ADR-001 — Single canonical documentation language: English

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | — (pre-implementation) |
| **Deciders** | Project owner |

**Context** — The specification was originally written in Bahasa Indonesia (`docs/`), then fully translated into English (`docs-en/`), producing two parallel, structurally identical sets.

**Decision** — The Indonesian `docs/` directory was deleted and `docs-en/` was renamed to `docs/`. There is now exactly one canonical documentation set, in English.

**Alternatives considered** — Maintaining both sets in parallel: rejected because every future edit would need to land twice, and the two would drift in exactly the places where precision matters most (schema, contracts, security rules). Keeping only Indonesian: rejected because the wider tooling and library ecosystem the implementation will draw on is English-language, and mixed-language cross-references are harder to follow than a single language either way.

**Consequences** — One source of truth, no synchronization cost. Application code, comments and engineering documentation are English going forward. This does **not** change the product's end-user language: user-facing copy — buttons, error messages, emails, the invitation itself — remains Bahasa Indonesian per `docs/UI-UX/00-DESIGN-DIRECTION.md` § Tone of Voice. A contributor who reads only Indonesian now needs help with the specification, which is a real cost accepted deliberately.

**Specification impact** — None; this describes `docs/` itself.

---

### ADR-002 — Stack not yet chosen

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | **Superseded by ADR-004 through ADR-017** (2026-09-09) |
| **Task** | — (pre-implementation) |
| **Deciders** | Project owner |

**Context** — `docs/ARCHITECTURE/00` through `03` describe the system shape — modular monolith, layered `Controller → Service → Repository`, PostgreSQL, Redis — in a framework-agnostic way, giving illustrative examples (NestJS, Laravel, FastAPI; React, Next.js) without committing.

**Decision** — No concrete framework or library choice has been made. This is deliberately left open pending confirmation before Phase 0 implementation begins.

**Alternatives considered** — Choosing during specification authoring: rejected because the specification's value is that it constrains the shape of the system without constraining the team's tooling, and a stack chosen without the person who will maintain it is a stack that gets rewritten.

**Consequences** — `P0-01` could not start until this was answered, and `P0-01` blocked the rest of Phase 0. Answered on 2026-09-09 by ADR-004 through ADR-017, which record the full stack. This entry stays in place because the reasoning for *deferring* the choice — that a stack chosen without the person who will maintain it gets rewritten — remains the reason the decision was made deliberately rather than during specification authoring.

**Specification impact** — `CLAUDE.md` and `AGENTS.md` § Dev environment still carry placeholder guidance and must be filled in with real commands as part of `P0-01`.

---

### ADR-003 — Establish `TASKS/` and `MEMORY/` as the execution and record layers

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-24` |
| **Deciders** | Project owner |

**Context** — `docs/` contains 121 documents describing what to build and why, and `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` gives a 48-line phase outline. Between "here is the complete specification" and "here is the phase list" there was nothing that said what to do first, what blocks what, or how a piece of work is judged finished. `MEMORY/` existed with a `STATE.md` snapshot and an append-only `LOG/`, which recorded history but had no forward-looking counterpart and no per-task discipline.

**Decision** — Add `TASKS/` as the execution layer: task conventions with a global Definition of Done, eight phase files covering 133 tasks, a progress board, and a backlog of open questions and specification gaps. Restructure `MEMORY/` into the record format used by the project owner's `zed-auth` repository: an index, a changelog, this decision log, `records/` (one file per completed task), `specs/` (feature specs written before implementation), and `templates/`.

Two structural consequences of the restructure:

- `MEMORY/LOG/` becomes `MEMORY/records/`, with the existing entry migrated unchanged.
- `MEMORY/STATE.md` is **removed**, and `TASKS/PROGRESS.md` becomes the single status board.

**Alternatives considered** — Keeping the roadmap as the only plan: rejected because a 48-line outline cannot express dependencies, and the two hard ordering constraints in `docs/PLAN/16` § Critical Dependencies were stated in prose where they are easy to skip. Keeping `MEMORY/STATE.md` alongside `TASKS/PROGRESS.md`: rejected because two status snapshots drift, and then neither is trusted; the reference repository does not have one either. Putting feature specs in `TASKS/specs/`: rejected in favour of `MEMORY/specs/`, so that everything written *about* a task lives in one folder.

**Consequences** — Every task now carries its specification references, its Definition of Done, and its abuse cases, which makes the security requirements in `docs/SECURITY/` checkable per task rather than only at the pre-launch sweep. The cost is real: `TASKS/` and `MEMORY/` must be updated in the same commit as the work, and a plan that goes stale is worse than none. `CLAUDE.md` and `AGENTS.md` were amended to describe the new structure, since they previously instructed agents to write to `MEMORY/STATE.md` and `MEMORY/LOG/`.

Writing the plan against the specification surfaced 17 specification gaps and 13 open questions, recorded in `TASKS/BACKLOG.md`. Two of them are contradictions between documents that would have become bugs: `PG-01` (403 versus 404 for another user's resource, where `docs/API/00` contradicts itself and `docs/SECURITY/04`, `05`, `CLAUDE.md` and `docs/TESTING/04` all say 404) and `PG-14` (a refund sends the invitation to `draft` per `docs/PLAN/02` and to `paid` per `docs/BACKEND/05` — the difference being whether a refunded customer keeps the ability to republish for free).

**Specification impact** — None to `docs/` yet. Fourteen amendments are owed by the tasks that resolve the gaps; they are tracked in `TASKS/PROGRESS.md` § Specification Amendments Owed so the debt is visible rather than buried in phase files.

### ADR-004 — Backend: TypeScript on Node.js with NestJS

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-01` |
| **Deciders** | Project owner |

**Context** — `docs/ARCHITECTURE/03` and `docs/BACKEND/00` name NestJS, Laravel and Django-DRF as acceptable, and require: a DI/service layer, schema validation that rejects unknown fields, a queue with retry and a dead-letter queue, and a safe image pipeline. `docs/PLAN/00` § Constraints assumes 1-3 engineers.

**Decision** — TypeScript on Node.js 22 LTS, with **NestJS 12** as the backend framework, in one monorepo with the frontends.

**Alternatives considered**

- **Go** — the project owner's `zed-auth` repository is a substantial Go service, so the skill is demonstrated, and Go's resource profile per instance is better. Rejected for one specific reason: this product's architectural centre is the template system, where the canonical field-path registry and the dot-notation resolver must behave **identically** in the backend's publish validation (`docs/BACKEND/03` § Validating Completeness) and in the frontend's editor checklist and renderer (`docs/FRONTEND/03`, `docs/FRONTEND/04`). `docs/FRONTEND/03` says outright that the schema should be "shared/generated from a single source if the stack allows it". In a Go backend that logic is written twice and kept in step by discipline; in one language it is a single package that cannot drift. For a 1-3 person team that is worth more than the runtime efficiency.
- **Laravel / Django-DRF** — both fit the layered architecture, but the frontend is React under any reading of `docs/FRONTEND/07`, so these add a second language without removing the first.
- **Fastify or plain Express instead of NestJS** — lighter, but `docs/ARCHITECTURE/01` prescribes twelve domain modules with strict `Controller → Service → Repository` layering and constructor injection (`docs/BACKEND/02` § Dependency Injection). NestJS supplies exactly that structure; hand-rolling it is work with no product output.

**Consequences** — One language across API, workers, three frontends and the shared packages. `packages/schema` becomes literally shared code rather than a convention. NestJS brings decorators and module metadata, which `docs/BACKEND/00` cautions against relying on in security-critical paths — so authorization stays explicit in the service layer (`P0-11`, `P1-06`) rather than being expressed as a decorator that is easy to omit. Node's single-threaded runtime makes CPU-bound image work a real risk, which is why `docs/BACKEND/04` § Resource Isolation already puts media processing in a separate, resource-capped worker pool (ADR-010).

**Specification impact** — None. `docs/BACKEND/00` lists NestJS first among its examples. `CLAUDE.md` and `AGENTS.md` § Dev environment updated with the real toolchain.

---

### ADR-005 — Monorepo with pnpm workspaces and Turborepo

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-01`, `P0-02` |
| **Deciders** | Project owner |

**Context** — `docs/FRONTEND/00` § Project Structure assumes shared packages (`ui`, `template-renderer`, `api-client`, `schema`). `docs/FRONTEND/04` requires one renderer used by the editor preview, the public page and the catalogue demo. `docs/ARCHITECTURE/02` allows one repository or three.

**Decision** — A single repository, pnpm workspaces for dependencies, Turborepo for task orchestration and caching.

```
apps/       api  worker  web-app  public-invite  admin
packages/   schema  template-renderer  ui  api-client  config
```

**Alternatives considered** — Separate repositories per surface: rejected because the renderer and the field-path schema would become published packages with a version-bump cycle between "change the schema" and "the editor sees it", which is friction paid on every template change. npm or yarn workspaces: pnpm chosen for strict `node_modules` isolation, which prevents a package importing a dependency it never declared — a real source of "works locally, fails in the container".

**Consequences** — One lockfile, one CI pipeline, atomic changes across API and frontend. The repository grows large and a naive CI runs everything on every change; Turborepo's affected-package filtering is what keeps that in check, and it has to be configured correctly from the start or it becomes a slow pipeline nobody trusts.

**Specification impact** — None; matches `docs/FRONTEND/00` § Project Structure.

---

### ADR-006 — Frontends: Next.js for the app and public invitation, Vite SPA for admin

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-01`, `P0-22` |
| **Deciders** | Project owner |

**Context** — `docs/FRONTEND/07` rules out a pure client-side SPA for the public invitation: sharing bots scrape `og:*` without executing JavaScript, so the page must be server-rendered with per-invitation metadata and on-demand cache invalidation. `docs/ARCHITECTURE/02` requires three logically separate surfaces. `docs/SECURITY/02` puts the admin panel behind its own trust boundary, and `docs/UI-UX/15` makes it desktop-first with no SEO requirement.

**Decision** — **Next.js 16** (App Router) with **React 19** for `web-app` and `public-invite`. **Vite 8 + React** for `admin`.

**Alternatives considered**

- Next.js for all three: simpler, one toolchain. Rejected narrowly — the admin panel needs no server rendering, and shipping it as static files served by the reverse proxy means the admin host runs no Node process at all. That is a smaller attack surface on the surface `docs/SECURITY/01` rates highest-impact if compromised, and a faster build for the surface iterated on most during Phase 5.
- Nuxt/Vue: equivalent capability. React chosen because `docs/UI-UX/06` names shadcn/ui and `docs/FRONTEND/05` names `@dnd-kit`, both React, and the specification's examples are React throughout.
- Astro for the public invitation: excellent for content pages, but the invitation needs client-side interactivity (countdown, RSVP, gallery, personalization) and shares the renderer with the editor, so the island model buys little here.

**Consequences** — Two frontend toolchains instead of one, a real cost for a small team. The shared packages absorb most of it: `ui` and `template-renderer` are plain React and build once. The public invitation's JavaScript budget (`docs/FRONTEND/09`, about 150KB gzip) is reachable only with per-template code splitting, which constrains how `P2-03`'s section components are imported.

**Specification impact** — None.

---

### ADR-007 — Database access: Drizzle ORM with drizzle-kit migrations

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-01`, `P0-06` |
| **Deciders** | Project owner |

**Context** — `docs/DATABASE/` contains literal `CREATE TABLE` statements that migrations must match "exactly unless there's a documented reason to deviate" (`CLAUDE.md`). Those statements use partial unique indexes (`WHERE deleted_at IS NULL`), typed array columns (`VARCHAR(40)[]`), `CHECK` constraints, `JSONB`, and an `INET` column on `audit_logs`. `docs/ARCHITECTURE/04` requires migrations to run as a separate pre-rollout step supporting expand-contract.

**Decision** — **Drizzle ORM 0.45.x** with **drizzle-kit** for schema definition and migration generation.

**Alternatives considered**

- **Prisma** — better tooling, larger community, the obvious default. Rejected on schema fidelity: partial unique indexes and `CHECK` constraints are not expressible in the Prisma schema and must be hand-written into migration SQL the schema file then does not describe; `String[]` maps to `text[]` rather than `varchar(40)[]`; `INET` requires `Unsupported()`, which makes the column unselectable through the client. Every one of those is a place where the code stops matching `docs/DATABASE/`, which is the one thing these migrations are supposed to guarantee.
- **TypeORM** — expressive enough, but its migration generation is less predictable and its query builder makes an unscoped find easy to write, which works against `P0-11`'s goal of making the un-tenanted query hard to write.
- **Raw SQL with a thin query layer** — maximum fidelity, no type safety across twenty-plus tables. Too costly for a small team at this schema size.

**Consequences** — The schema file reads close to the SQL in `docs/DATABASE/`, and `drizzle-kit generate` emits reviewable SQL, so "migrations match the documents" is checkable by eye. Drizzle's ecosystem is smaller than Prisma's and it has no equally mature Studio; `drizzle-kit studio` plus a normal SQL client covers it. Drizzle keeps `where(eq(invitations.ownerId, userId))` visible at the call site, which suits `P0-11`.

**Specification impact** — None.

---

### ADR-008 — Zod as the single validation vocabulary

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-01`, `P0-20` |
| **Deciders** | Project owner |

**Context** — `docs/BACKEND/03` shows Zod schemas and requires the validation schema to double as the accepted-field whitelist, rejecting unknown fields. `docs/FRONTEND/03` wants client validation aligned with the server's, ideally from one source. `docs/DATABASE/03` requires `template_versions.sections` to be validated against a fixed schema before any write.

**Decision** — **Zod 4.5.x**, living in `packages/schema`, as the single vocabulary for HTTP request validation in NestJS (through a Zod validation pipe), the template section and theme schema, the canonical field-path registry, and client-side form validation.

**Alternatives considered** — `class-validator` (the NestJS default): rejected because its decorators are not shareable with the frontend and its whitelist behaviour is configuration rather than the schema itself. JSON Schema with a validator: portable across languages, but that portability only pays if the backend is not TypeScript, which ADR-004 settled.

**Consequences** — One definition of every request shape, imported by both sides, so the editor's inline validation and the API's rejection cannot drift. Strict mode everywhere makes mass-assignment protection the default rather than a rule to remember (global DoD item 4). The risk is a package that becomes a dumping ground: it holds schemas and the field registry only, never business logic.

**Specification impact** — None; `docs/BACKEND/03`'s examples are already Zod.

---

### ADR-009 — Queue and workers: BullMQ on Redis

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-01`, `P0-15` |
| **Deciders** | Project owner |

**Context** — `docs/ARCHITECTURE/07` names "a Redis-based BullMQ/Sidekiq-equivalent, or a managed SQS", and requires per-job retry policies, exponential backoff, a dead-letter queue, scheduled cron jobs, and separate worker pools by load category (`docs/BACKEND/08`).

**Decision** — **BullMQ 6.3.x** on the same Redis used for cache and rate limiting, with three worker pools — `worker-media`, `worker-general`, `worker-cron` — as separate processes from one `apps/worker` codebase.

**Alternatives considered** — Managed SQS: better durability guarantees, but adds a cloud dependency the single-VPS deployment (ADR-015) does not otherwise need, and its delayed-job and cron support is weaker. pg-boss (jobs in PostgreSQL): attractive because it removes a moving part and gives transactional enqueue, but it puts queue polling load on the primary database — the exact resource the caching architecture exists to protect during a spike.

**Consequences** — Redis becomes load-bearing for cache, rate limiting and jobs, so its persistence configuration and memory limit matter more than a pure cache's would, and its failure mode needs a decision per subsystem (`P1-07`). Job payloads carry the `request_id` for the correlation `docs/DEVOPS/05` wants. BullMQ's repeatable jobs cover the cron schedule in `docs/BACKEND/08`, with a leader lock so a second worker instance does not double-run the daily expiry job.

**Specification impact** — None.

---

### ADR-010 — Media pipeline: sharp with ClamAV in an isolated worker

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-01`, `P1-18` |
| **Deciders** | Project owner |

**Context** — `docs/SECURITY/06` requires magic-byte validation, dimension limits, decompression-bomb protection with strict memory and time limits, complete EXIF stripping, and malware scanning, with transformation running in an isolated process (`docs/BACKEND/04` § Resource Isolation).

**Decision** — **sharp 0.35.x** (libvips) for decode, resize and WebP variant generation, with `limitInputPixels` and explicit concurrency and cache caps; **ClamAV** as a sidecar container for scanning; magic-byte inspection at the synchronous stage; all of it in the `worker-media` pool under hard container CPU and memory limits.

**Alternatives considered** — ImageMagick: broader format support, a correspondingly broader CVE history, and slower. Cloud image services (Cloudinary, imgix): they would remove this task entirely, but the uploaded file must be scanned and EXIF-stripped before it leaves the trust boundary, and `docs/PLAN/11` § CDN & Delivery specifies pre-generated variants at upload rather than on-the-fly transformation — so the service's main advantage does not apply here.

**Consequences** — `docs/SECURITY/06`'s eleven layers map onto concrete library calls, and `limitInputPixels` plus the container memory cap is the decompression-bomb defence rather than a hope. ClamAV costs roughly a gigabyte of RAM for its signature database, a real line item on a single VPS, accounted for in ADR-015. sharp ships platform-specific binaries, so the Docker build must not copy `node_modules` across architectures.

**Specification impact** — None.

---

### ADR-011 — Storage, CDN and edge: Cloudflare R2 with Cloudflare in front

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-01`, `P0-16`, `P3-12` |
| **Deciders** | Project owner |

**Context** — `docs/ARCHITECTURE/05` requires S3-compatible private buckets served through a CDN with origin access control, immutable long-TTL media, and cross-region backup. `docs/ARCHITECTURE/06` makes CDN caching of the public page central to surviving the wedding-day spike (R3). `docs/PLAN/00` § Constraints demands cheap-when-idle infrastructure. `docs/SECURITY/10` wants an adaptive CAPTCHA.

**Decision** — **Cloudflare R2** for `user-media` and `template-assets`, **Cloudflare CDN** in front of the public invitation and media, **Cloudflare Turnstile** for the adaptive CAPTCHA, and Cloudflare DNS for the wildcard record. **MinIO** locally for parity.

**Alternatives considered** — AWS S3 with CloudFront, the default, rejected on one number: this product's traffic is hundreds of guests each loading a photo gallery, concentrated into a few days — egress-heavy, unpredictable, and the least budgetable line on S3. R2 charges no egress fee, which turns the scariest cost in the model into a fixed one. Self-hosted MinIO in production: cheapest, but media durability becomes the operator's problem, and `docs/ARCHITECTURE/09` requires backups in a different account or region, which self-hosting on the same VPS structurally cannot provide.

**Consequences** — One vendor covers object storage, CDN, DNS, WAF and CAPTCHA. That reduces moving parts and concentrates risk: a Cloudflare outage takes out media, edge cache and the challenge at once, which belongs in `docs/PLAN/18` as a new entry. R2 is S3-compatible, so the `StoragePort` in `P0-16` keeps a move to S3 a configuration change. R2 also gives database backups a home at a different provider entirely, satisfying `docs/ARCHITECTURE/09` § Backup more strongly than a second AWS region would.

**Specification impact** — `docs/PLAN/18-RISK-REGISTER.md` gains R13 (single-vendor edge dependency).

---

### ADR-012 — Payment provider: Midtrans for the MVP

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted — commercial terms to be confirmed by the project owner |
| **Task** | `P0-01`, `P3-03` |
| **Deciders** | Project owner |

**Context** — `docs/PLAN/00` § MVP Scope requires at least one local gateway, naming Midtrans and Xendit. `docs/PLAN/01` FR-5.3 requires virtual account, e-wallet and QRIS. `docs/SECURITY/07` requires signature-verified webhooks and minimal PCI scope.

**Decision** — **Midtrans**, integrated through the Snap redirect or embedded widget, behind the `PaymentGatewayPort` from `P3-03`.

**Alternatives considered** — **Xendit**: comparable coverage, arguably better developer documentation and a cleaner API surface. The two are close enough that the decision is commercial — settlement period, MDR per method, onboarding requirements for the business entity — and those are the project owner's numbers, not an engineering judgement. Midtrans is chosen as the default because `docs/SECURITY/07` already documents its signature algorithm (SHA-512 over `order_id + status_code + gross_amount + server_key`), so the specification and the implementation start aligned, and because Snap's payment-method coverage for Indonesian consumers is the broadest at MVP scale.

**Consequences** — All card entry happens on Midtrans's surface, keeping PCI scope at its lightest (`docs/SECURITY/07` § PCI-DSS Scope). The webhook signature implementation follows Midtrans's official documentation, not the illustration in the specification. Because the provider sits behind a port (`docs/BACKEND/01`, mitigation for R9), switching to Xendit later is an adapter plus a webhook route, not a redesign — which is what makes accepting a commercial decision under uncertainty safe here.

**Specification impact** — None.

---

### ADR-013 — Transactional email: Resend with React Email templates

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-01`, `P4-06` |
| **Deciders** | Project owner |

**Context** — `docs/PLAN/13` names SES, SendGrid and Mailgun as examples and requires centrally stored templates changeable without a deploy. `docs/BACKEND/07` requires a swappable `EmailPort`. Account verification and password reset both depend on delivery, and a password reset email is a phishing target, so SPF, DKIM and DMARC matter.

**Decision** — **Resend** as the MVP provider behind `EmailPort`, with templates authored as **React Email** components in `packages/ui`.

**Alternatives considered** — **Amazon SES**: materially cheaper at volume and the right answer later, but it starts in a sandbox requiring a production-access request, and its templating and deliverability tooling are thinner. At MVP volumes the cost difference is a few dollars a month and the setup difference is a day. **MJML** for templates, as `docs/BACKEND/07` illustrates: a fine choice, but React Email keeps templates in the same language and component library as the rest of the product and renders in tests without a separate toolchain.

**Consequences** — Email templates live in the monorepo and ship with a deploy, which is a partial deviation from `docs/PLAN/13`'s "changeable without a deploy" intent — accepted because the deploy is a container rebuild on the same VPS, not a release process, and typed templates catch a missing variable at build time rather than in a customer's inbox. The `EmailPort` keeps the SES migration cheap when volume justifies it. SPF, DKIM and DMARC are configured on the sending domain as part of `P4-06`, and verified from staging before any real user receives a verification email.

**Specification impact** — `docs/BACKEND/07` § Email Templates mentions `templates/email/*.mjml` as an example; the intent (centralized, not inline HTML) is preserved. No amendment needed, since the document presents it as an example rather than a requirement.

---

### ADR-014 — Maps: MapLibre in the editor, static image and deep link on the public page

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-01`, `P1-24`, `P2-03` |
| **Deciders** | Project owner |

**Context** — `docs/PLAN/04` § F5 requires an address input with an interactive pin producing coordinates. `docs/UI-UX/14` requires the public page to show a map and an "Open in Google Maps" button. `docs/FRONTEND/09` sets a public-page JavaScript budget of roughly 150KB gzip and an LCP target under 2.5s on 4G.

**Decision** — Two different treatments for two different surfaces:

- **Editor** (authenticated, low volume): **MapLibre GL JS 6.x** with an OpenStreetMap-based tile source for the pin picker, optionally with a paid geocoding autocomplete for address search.
- **Public invitation** (unauthenticated, high volume): **no map SDK at all**. A lazily-loaded static map image plus an "Open in Google Maps" deep link built from the stored coordinates.

**Alternatives considered** — Google Maps JS API on both surfaces: the best place data in Indonesia by a wide margin, which matters when a user is searching for a venue by name — hence keeping a Google-quality autocomplete as an option in the editor. Rejected for the public page on two grounds that point the same way: an embedded map SDK is one of the heaviest things a page can load, against a 150KB budget on a mid-range Android over 4G; and it bills per map load on the one surface whose traffic is unpredictable and unbounded. Leaflet instead of MapLibre: lighter, but MapLibre's vector tiles give a better pin-picking experience for the same integration effort.

**Consequences** — Guests get a fast page and a button that opens the map application they already have, which is what they were going to do anyway. The editor keeps a real interactive picker where its cost is bounded by the number of couples, not the number of guests. Two map integrations exist instead of one, and the static-image provider is a small extra dependency.

**Specification impact** — None; `docs/UI-UX/14` asks for a map section and an "Open in Google Maps" button, both of which this satisfies.

---

### ADR-015 — Hosting: a single VPS with Docker Compose and Caddy

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-01`, `P0-23`, `P3-11` |
| **Deciders** | Project owner |

**Context** — `docs/ARCHITECTURE/08` describes the production topology without naming a provider. `docs/PLAN/00` § Constraints requires infrastructure that is cheap when idle and cheap to scale during spikes, with a 1-3 person team. `docs/PLAN/10` requires wildcard subdomain routing under a wildcard certificate, and Phase 7 requires per-domain certificates for custom domains.

**Decision** — A **single VPS** in Singapore or Jakarta running the whole stack under **Docker Compose** — API, worker pools, `web-app`, `public-invite`, PostgreSQL 16, Redis 7, ClamAV — behind **Caddy** as the origin reverse proxy, with Cloudflare in front (ADR-011). The `admin` SPA is served as static files by Caddy. Deployment is pull-based: the host fetches and restarts its own services, so nothing outside the network holds a credential to the machine.

**Alternatives considered**

- **Managed container platform** (Cloud Run, ECS, Fly): better autoscaling, but the load profile here is a spiky read path already absorbed by the CDN, and the write path is small. Paying platform complexity for autoscaling the cache does not fit the budget constraint.
- **Kubernetes**: rejected outright at this team size, which `docs/ARCHITECTURE/00` § Non-Goals anticipates by choosing a modular monolith.
- **Managed PostgreSQL**: genuinely tempting, because it makes point-in-time recovery someone else's job — and `docs/ARCHITECTURE/09` requires PITR with a 4-hour RTO. Self-hosting means WAL archiving to R2 and a restore drill that must actually be performed (`P6-12`). Revisit if the drill proves painful; the cost difference is small next to a failed restore.
- **nginx** instead of Caddy: `docs/DEVOPS/03`'s example config is nginx-flavoured but explicitly indicative. Caddy is chosen for automatic certificate management, including **on-demand TLS** — which is what makes Phase 7's per-domain custom-domain certificates a configuration rather than a project, and keeps that path free rather than requiring a paid Cloudflare tier.

**Consequences** — One machine is a single point of failure, which does not meet `docs/ARCHITECTURE/08`'s implied redundancy or `docs/ARCHITECTURE/09`'s RTO in the worst case. That is an accepted, recorded risk for the MVP, mitigated by: the CDN continuing to serve cached invitation pages through an origin outage (which is the failure that would hurt most, on a wedding day), nightly backups plus WAL archiving to R2 at a different provider, and a documented rebuild runbook. It must be re-evaluated before the product carries weddings it cannot afford to disappoint. PgBouncer is deferred until there is more than one API instance — `docs/ARCHITECTURE/04` recommends it for connection spikes from serverless or many workers, which this topology does not have.

**Specification impact** — `docs/PLAN/18-RISK-REGISTER.md` gains R14 (single-host deployment, no redundancy at MVP).

---

### ADR-016 — Testing and CI toolchain

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-01`, `P0-17`, `P0-19` |
| **Deciders** | Project owner |

**Context** — `docs/TESTING/00` sets the pyramid and names Jest/Vitest, Supertest, Playwright, k6 and ZAP as indicative tools. `docs/TESTING/02` requires integration tests against real PostgreSQL and Redis containers rather than mocks. `docs/BACKEND/09` sets an 80% service-layer coverage gate. `docs/SECURITY/11` sets the SAST, dependency and DAST cadence.

**Decision** — **Vitest 5.x** for unit and integration tests across every package, **Testcontainers** for real PostgreSQL and Redis, **Supertest** for HTTP-level integration, **Playwright 1.63.x** for E2E, **MSW** for mocking external services, **axe-core** for accessibility assertions, **k6** for load testing. CI on **GitHub Actions**, with **Semgrep** for SAST, **Renovate** for dependency updates, and **OWASP ZAP** against staging.

**Alternatives considered** — Jest: the NestJS default, but the frontend packages are Vite-based and one runner across the monorepo is worth more than the framework default. A shared PostgreSQL service container instead of Testcontainers: faster, but tests then share state, and `docs/TESTING/02` requires per-test isolation.

**Consequences** — One test runner and one configuration style across the monorepo. Testcontainers makes integration tests slower and requires Docker in CI; that cost buys tests that exercise the actual constraints — the partial unique index, the `CHECK`, the cascade — which `P0-07` through `P0-10` explicitly test for rather than assume. The harness must fail loudly when no database is reachable rather than skipping, which `P0-19` names as a Definition of Done item because a green suite that ran nothing is a false statement everyone acts on.

**Specification impact** — None.

---

### ADR-017 — Observability toolchain

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-01`, `P0-12`, `P6-10` |
| **Deciders** | Project owner |

**Context** — `docs/DEVOPS/06` requires structured JSON logs with `request_id` correlation and redaction enforced by the logger rather than by developer discipline. `docs/DEVOPS/05` lists the metrics to dashboard, and `docs/DEVOPS/07` the alerts. `docs/FRONTEND/08` requires client error tracking with context and without sensitive fields.

**Decision** — **Pino 10.x** for structured logging, using its `redact` paths for the field list in `docs/DEVOPS/06`; **OpenTelemetry** for trace context propagated into job payloads; **Prometheus + Grafana** on the same host for metrics and dashboards; **Sentry** for backend and frontend error tracking; an external uptime service for the synthetic checks `docs/DEVOPS/05` requires from outside the infrastructure.

**Alternatives considered** — A hosted observability platform (Datadog, Better Stack, Grafana Cloud): less to operate, but the cost model does not suit a budget-constrained MVP, and self-hosted Prometheus and Grafana on an existing host is close to free. Winston instead of Pino: Pino's declarative redaction is the deciding feature — `docs/DEVOPS/06` is explicit that redaction cannot depend on each developer remembering, and a logger that redacts by configuration is the only way to make that true.

**Consequences** — Redaction is enforced at the logger, so `P6-11`'s audit is a verification rather than a search. Self-hosted Prometheus and Grafana on the same VPS means monitoring dies with the host it monitors — which is exactly why the external synthetic checks are not optional. Sentry's client SDK must be configured to scrub the fields `docs/FRONTEND/08` names, since a client error payload can otherwise carry the invitation content that caused it.

**Specification impact** — None.

---

### ADR-018 — A non-owner's request returns 404, never 403

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-13` — resolves `PG-01` |
| **Deciders** | Project owner |

**Context** — `docs/API/00-API-STANDARDS.md` documented **both** answers for the same case. Its 403 row read "including the IDOR-prevention case: the resource exists but isn't the user's", while its 404 row read "also used to hide the existence of another user's resource". Everything else in the specification said 404: `docs/SECURITY/04` § Example Pseudocode, `docs/SECURITY/05` § Mandatory Checklist, `docs/TESTING/04` ("not a 403 that confirms the resource's existence"), and `CLAUDE.md`'s non-negotiable rules. `docs/API/05` § Error Cases then specified 403 for uploading to another user's invitation, and `docs/SECURITY/11` hedged with "a consistent 403/404".

Left unresolved, this would have been decided endpoint by endpoint by whoever wrote each one, which is how a system ends up with an oracle: any endpoint answering 403 tells an attacker the identifier they guessed is real.

**Decision** — **404 for any resource that exists but does not belong to the current user.** 403 is reserved for cases where the resource identity is not the question: a role the caller does not have (`/admin/*`), or an action gated on `email_verified`.

**Alternatives considered** — 403 with a generic body, on the argument that it is semantically honest and that the resource identifier was usually guessed rather than discovered. Rejected because semantic honesty here is precisely the leak: `docs/SECURITY/05` is the project's stated zero-tolerance area, `docs/PLAN/00` § Success Metrics sets zero cross-tenant incidents as a launch metric, and a status code that differentiates is a slow enumeration channel that no rate limit fully closes. The cost is a slightly less informative error for a legitimate user who somehow reaches another user's URL — a case that does not occur in normal use.

**Consequences** — The repository layer returns null rather than a row for a non-owner (`P0-11`), so the service cannot accidentally return 403: the information needed to do so never reaches it. `P6-01`'s IDOR sweep treats any 403 as a finding. Debugging a genuine permission problem is marginally harder, mitigated by logging the distinction server-side where only operators can see it.

**Specification impact** — Amended: `docs/API/00` (status table plus a new "403 vs 404" section), `docs/API/05` (error cases), `docs/SECURITY/01` (threat model wording), `docs/SECURITY/11` (sweep criterion now names 404 and calls a 403 a finding).

---

### ADR-019 — A refund returns the invitation to `draft`

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P5-08` — resolves `PG-14` |
| **Deciders** | Project owner |

**Context** — Three documents disagreed about the state an invitation lands in after an admin refund. `docs/PLAN/02` BR-5.4 said `paid → draft`, with a published invitation unpublished. `docs/BACKEND/05` § Refund set a published invitation to `paid`. `docs/BACKEND/09` hedged with "reverts to `draft`/the correct status". The difference is not cosmetic: an invitation left at `paid` can be republished at any time without paying again, so under that reading the platform returns the customer's money and leaves them the product.

**Decision** — A refund sets the invitation to **`draft`**, from whatever state it held, including directly from `published`. The public page stops being served immediately, with the cache invalidated rather than left to expire. All invitation data is preserved, and the user may create a new order whenever they want.

**Alternatives considered**

- **`paid`** (the `docs/BACKEND/05` reading): defensible only if refunds were expected to be goodwill gestures where the customer keeps access. Nothing in `docs/PLAN/09` or `docs/API/09` suggests that; a refund there is an admin correction, and `docs/PLAN/06`'s lifecycle diagram draws the refund arrow into `draft`.
- **A dedicated `refunded` invitation state**: cleaner in principle — the history would be visible in the status itself. Rejected because `docs/DATABASE/04`'s `CHECK` constraint enumerates the valid statuses and every consumer of that enum would need updating for a state that behaves identically to `draft`. The refund is already legible in `orders.status`, `invitation_status_history` and `audit_logs`.

**Consequences** — The rule is now one sentence with no exceptions, which is what makes it testable (`P5-08`, `docs/BACKEND/09` § E2E). Cache invalidation on refund becomes mandatory rather than incidental: a refunded invitation still being served from cache is both a product failure and a privacy one. An admin refunding a live invitation on a wedding day takes that invitation offline immediately, so the confirmation dialogue in `P5-08` must state the effect in those words before the button is pressed.

**Specification impact** — Amended: `docs/BACKEND/05` (refund pseudocode plus the reasoning), `docs/BACKEND/09` (E2E expectation), `docs/PLAN/02` BR-5.4 (expanded), `docs/PLAN/06` (transition rules).

---

### ADR-020 — Schema completions: tokens, MFA, preview links, view counts, slug blocklist

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-07`, `P0-09` — resolves `PG-04`, `PG-06`, `PG-12`, `PG-13`, `PG-15` |
| **Deciders** | Project owner |

**Context** — Five capabilities the specification required functionally had no table to store them: email verification and password reset tokens (`docs/API/01`, `docs/SECURITY/03`), admin TOTP factors and recovery codes (`docs/SECURITY/03`, `docs/PLAN/12`), share-preview tokens (`docs/API/04`, `docs/PLAN/04` § F6), page-view counts (`docs/API/08`, `docs/PLAN/14`), and the slug blocklist that `docs/SECURITY/10` requires to be admin-editable without a deploy. Each would have been invented at implementation time by whichever task hit it first.

**Decision** — Five tables added to `docs/DATABASE/`, following the conventions already in force there (UUID keys, `snake_case`, timestamps, explicit indexes):

| Table | Home | Notes |
|---|---|---|
| `user_tokens` | `docs/DATABASE/02` | Verification and reset, one row per issued token, `token_hash` only, single-use via `used_at` |
| `user_mfa_factors`, `user_recovery_codes` | `docs/DATABASE/02` | TOTP secret encrypted at the application layer, codes hashed, factor inactive until `confirmed_at` |
| `invitation_preview_tokens` | `docs/DATABASE/04` | Hashed, expiring, revocable, with `last_accessed_at` |
| `invitation_view_counts` | `docs/DATABASE/11` (new) | Daily grain, upserted by the flush job, no per-visitor data |
| `slug_blocklist` | `docs/DATABASE/12` (new) | `exact` versus `substring` match types, admin-managed, audited |

Three choices inside those tables are worth naming. **Everything credential-shaped is stored hashed or encrypted** — verification tokens, reset tokens, preview tokens, recovery codes hashed; TOTP secrets encrypted — so that a database dump yields nothing directly usable, which is the same reasoning `docs/DATABASE/02` already applied to refresh tokens. **View counts are daily rather than a single total**, because the question an owner actually asks in the week before the wedding is "is anyone opening the link I sent yesterday", and because a daily row can be pruned without losing the total. **The blocklist distinguishes exact from substring matching**, because blocking reserved words as substrings would reject legitimate Indonesian names — a couple named Aprilia should not lose their slug to a routing concern.

**Alternatives considered** — Reusing `refresh_tokens` for verification and reset tokens: rejected, different lifetimes, different semantics, and overloading a table that already has a security-critical rotation rule invites a mistake. Storing view counts in Redis only: rejected because the owner dashboard needs history that survives a Redis restart. Keeping the blocklist in code: rejected, `docs/SECURITY/10` explicitly requires it to be updatable without a deploy.

**Consequences** — `P0-07` and `P0-09` grow by five tables. The MFA secret column commits the project to an application-layer encryption mechanism, which also settles half of `OQ-10`: the key management for encrypting bank account numbers will already exist. `docs/DATABASE/` grows from 11 files to 13.

**Specification impact** — Amended: `docs/DATABASE/00` (table groups), `docs/DATABASE/01` (ERD), `docs/DATABASE/02`, `docs/DATABASE/04`. Added: `docs/DATABASE/11-ANALYTICS.md`, `docs/DATABASE/12-PLATFORM-CONFIG.md`. Cross-referenced from `docs/PLAN/14` and `docs/SECURITY/10`.

---

### ADR-021 — API completions: media read, owner-side RSVP and guestbook, version upgrade, watermark, reporting

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P1-17`, `P4-02`, `P4-04`, `P1-15`, `P3-09`, `P5-09` — resolves `PG-03`, `PG-09`, `PG-10`, `PG-11`, `PG-16` |
| **Deciders** | Project owner |

**Context** — Five features the product documents describe in detail had no endpoint in the API contract. `docs/FRONTEND/05` polls `GET /media/:id`, which `docs/API/05` never defined. `docs/PLAN/04` § F10 and § F11 specify owner-side RSVP management and guestbook moderation, and `docs/UI-UX/10` specifies their tables and buttons, but `docs/API/04` had neither. BR-3.2 promises users an explicit template version upgrade with no endpoint to perform it. `packages.has_watermark` distinguishes the Basic and Premium packages but never reached the public renderer. `docs/PLAN/12` describes a moderation queue fed by "user reports" with no way for a user to report.

**Decision** — Six additions to the contract:

- `GET /api/v1/media/:media_id` — ownership-scoped, the endpoint the upload flow polls.
- `GET/DELETE /api/v1/invitations/:id/rsvps`, `/rsvps/summary`, `/rsvps/export` — owner-side RSVP management, with the summary computed in SQL and the CSV export escaping cells that would otherwise execute as spreadsheet formulas.
- `GET/PATCH/DELETE /api/v1/invitations/:id/guestbook[/:entry_id]` — owner-side moderation, distinct from the admin queue.
- `POST /api/v1/invitations/:id/upgrade-template-version` — separate from `change-template`.
- `display.watermark` in the `GET /public/i/:slug` response, derived server-side from the paid package.
- `POST /public/i/:slug/guestbook/:entry_id/report` — rate-limited, flags rather than hides.

Two of these deserve their reasoning stated. **Version upgrade is a separate endpoint from template change** even though both write `template_version_id`, because they are different user intentions carrying different warnings: changing templates may hide sections (BR-4.1), while upgrading a version keeps the design and is the conscious act BR-3.2 describes. One endpoint would force one confirmation dialogue to explain both. **Reporting flags rather than hides**, because a public endpoint that could remove a message from a stranger's wedding page is a denial-of-service tool with a friendly name.

**Alternatives considered** — Putting owner-side RSVP and guestbook management under the admin API: rejected, they are the owner's own data and admin routes carry cross-tenant audit semantics they should not need. Returning the watermark flag as a package identifier rather than a boolean: rejected, it would leak the customer's purchase tier to every guest for no rendering benefit.

**Consequences** — `docs/API/04` grows by two sub-resource sections, and Phase 4 gains real endpoints rather than a gap discovered mid-sprint. The CSV formula-injection guard is now a documented requirement rather than something a reviewer might notice. The report endpoint gives Phase 5's moderation queue an actual source.

**Specification impact** — Amended: `docs/API/04`, `docs/API/05`, `docs/API/08`, `docs/API/09` (owner versus platform moderation), `docs/PLAN/12`.

---

### ADR-022 — Documentation corrections: settings mapping, addon availability, checkout transition, demo data, phantom tables

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-09`, `P1-14`, `P3-01`, `P3-02`, `P0-21` — resolves `PG-02`, `PG-05`, `PG-07`, `PG-08`, `PG-17` |
| **Deciders** | Project owner |

**Context** — Five smaller inconsistencies, each individually minor and each capable of costing an implementer an hour or a wrong turn.

**Decision**

- **`PG-02` — where settings fields live.** `docs/PLAN/08` models `slug` and `expiry_date` inside `Settings`; `docs/DATABASE/04` stores them on `invitations`. The physical schema stays as it is: they are identity and lifecycle fields on the hottest query in the product (`WHERE slug = ? AND status = 'published'`), and moving them behind a second table would add a join to the public page request. `docs/PLAN/08` gains a mapping table making the domain-to-table relationship explicit, and the API keeps the domain grouping so users need not know the schema to change a setting.
- **`PG-05` — the custom domain addon.** Seeded `is_active = false` until `P7-01` ships the feature. Selling access to something that does not exist is a support problem first and a consumer-protection problem second.
- **`PG-07` — who sets `pending_payment`.** The order service, inside the order-creation transaction. The invitation is awaiting payment from the moment an order exists, and a status written in a later step could be lost if the user abandons the flow between the two. Renewal orders perform no transition.
- **`PG-08` — where demo data lives.** A seeded invitation owned by a system account, rendered through the production renderer and the production API shape. A demo rendered by a demo-only path drifts from the product the moment either side changes, and `docs/UI-UX/11` requires the demo to set accurate expectations before a user commits to a template.
- **`PG-17` — phantom tables.** `docs/ARCHITECTURE/04`'s schema summary listed `invitation_locations`, `invitation_sections` and `template_sections`, none of which exist: location fields are on `invitation_events`, enabled sections are an array on `invitation_settings`, and template sections are JSONB on `template_versions`. The summary now matches `docs/DATABASE/00`, which is authoritative, and says so.

**Consequences** — Nothing changes in the intended system; five places where an implementer would have had to stop and choose are now decided. The `docs/ARCHITECTURE/04` correction matters most in practice, because it would have been read by whoever wrote the migrations in `P0-09`.

**Specification impact** — Amended: `docs/PLAN/07`, `docs/PLAN/08`, `docs/PLAN/09`, `docs/API/06`, `docs/ARCHITECTURE/04`, `docs/DATABASE/07`.

---

### ADR-023 — Pricing: one package at Rp 139,000 for 12 months, one free draft

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P3-01` — resolves `OQ-05` |
| **Deciders** | Project owner |

**Context** — `docs/PLAN/09` § Packages described a two-tier model (Basic and Premium) with different photo caps, watermark behaviour, custom-domain access and validity periods, and explicitly left final pricing out of scope. `docs/DATABASE/07` makes `packages.price` the source of truth for every calculation, so nothing in Phase 3 is real until the numbers exist. `docs/PLAN/00` § Business Model also left the free tier's boundary unstated: it says "1 free invitation" while FR-1.4 requires the architecture to support many invitations per account.

**Decision** — A **single paid package**, priced at **Rp 139,000**, valid for **12 months**, with a **200 photo** cap at 10 MB per file and **no watermark**. The **free tier is one draft**: an account may hold at most one invitation that has never been paid for.

The project owner's reasoning, recorded because it explains the shape and not only the number: the effort in producing a wedding invitation belongs to the couple, not to the platform, so the platform should be cheap.

Concretely:

| | |
|---|---|
| `packages` | one active row: `standard`, Rp 139,000, `duration_months = 12`, `max_photos = 200`, `has_watermark = false` |
| `addons` | `custom_domain` inactive until `P7-01`; `extended_validity` inactive at MVP — redundant beside a 12-month package plus renewal orders |
| Free tier | at most **one** invitation per account that has never reached `paid`. Draft only, watermarked preview, cannot publish |
| Renewal | an `order_type = 'renewal'` order at the same Rp 139,000 for another 12 months |

**Two interpretations were made and are flagged rather than buried.** "Subscription 1 tahun" is implemented as a **12-month validity period with manual renewal**, not recurring billing — `docs/PLAN/00` says the MVP is not subscription-based, the renewal flow in `docs/PLAN/10` already exists, and recurring billing is a materially different payment flow that would need its own security review (`P7-07`). And a single price is read as a **single tier**: with the two-tier table gone, Basic and Premium disappear rather than Basic being priced separately.

**Alternatives considered**

- **Keeping Basic and Premium** with 139,000 as one of them: rejected because only one price was given, and because a second tier at this level would have to sit around Rp 89,000 for a difference the customer would struggle to care about. `docs/UI-UX/13`'s comparison cards exist to help a user choose between tiers; with one tier there is nothing to compare, and the checkout gets simpler rather than poorer.
- **A lower price with a photo cap around 20** (the old Basic shape): rejected on arithmetic. The marginal cost of the 200-photo cap is roughly Rp 900 a year in R2 storage, against a Rp 139,000 price. Capping photos low would save nothing worth the support conversation it creates.
- **Free tier of zero drafts** (pay before editing): rejected because `docs/UI-UX/04` describes a journey where confidence is built by seeing the real preview before paying, and `docs/PLAN/00` targets a 15% draft-to-paid conversion — which requires drafts to exist.

**Consequences**

The free-draft rule is stated as "at most one invitation that has never reached `paid`", which is what keeps the wedding-organizer persona working: an organizer with five paid invitations can still start a sixth draft. Counting all drafts regardless of history would have made the product unusable for `docs/UI-UX/03`'s secondary persona.

Unit economics at Rp 139,000 (about US$8.50): payment gateway fees run roughly Rp 1,000–4,000 depending on method; storage for a fully-loaded invitation is on the order of Rp 900 a year; egress is free on R2 (ADR-011). Gross margin is comfortable, which is the point — the model is volume at a price that does not make a couple hesitate.

The watermark's role narrows sharply. With no paid tier carrying one, it appears only on **free drafts and share-previews**, not on any published invitation. That simplifies `PG-09`'s `display.watermark` flag — for now it is always false for a published invitation — and it retires most of `OQ-13`: what remains is what the preview watermark looks like, not a decision about which customers see one. It also removes the watermark as an acquisition channel, which was a stated secondary benefit in `docs/UI-UX/14`; a footer credit link is the obvious replacement if that channel is wanted, and is a separate decision.

`extended_validity` going inactive means the `addons` table ships at MVP with no active rows. That is fine — the table and the `addon_ids` array stay, so the first active addon is a seed row rather than a schema change.

**Specification impact** — Amended: `docs/PLAN/00` (business model), `docs/PLAN/02` (BR-8.1 and a new BR-1.4 free-draft rule), `docs/PLAN/09` (packages), `docs/PLAN/11` (media limits), `docs/DATABASE/07` (seed note), `docs/UI-UX/13` (checkout without tier comparison), `docs/UI-UX/14` (watermark scope).

---

### ADR-024 — Publishing addresses: path-based on fixed hostnames, no wildcard DNS

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-23`, `P3-11` — resolves `OQ-08` |
| **Deciders** | Project owner |

**Context** — `docs/PLAN/10` § Subdomain specified `{slug}.maindomain.com` resolved from the `Host` header against a wildcard DNS record and a wildcard TLS certificate. `docs/DEVOPS/03`, `docs/BACKEND/06`, `docs/FRONTEND/01`, `docs/FRONTEND/07` and `docs/ARCHITECTURE/08` all build on that.

The project owner's domain is `zedth.my.id`, with `invitation.zedth.my.id` already in service, and the infrastructure is not yet in a position to manage DNS records programmatically. The stated direction is to add a Cloudflare API token later so records can be created against a Cloudflare Tunnel — which is also, not coincidentally, the mechanism the Phase 7 custom-domain feature would need.

**Decision** — For the MVP, an invitation is published at a **path on a fixed hostname**: `https://invitation.zedth.my.id/{slug}`. No wildcard DNS record and no wildcard certificate.

Three fixed hostnames, added one at a time as each surface is built, with **no wildcard anywhere**:

| Host | Serves | Added at |
|---|---|---|
| `invitation.zedth.my.id` | Public invitations at `/{slug}`, previews at `/preview/{token}`, and `/public/*` proxied to the API so guest submissions stay same-origin | Exists today |
| `app.zedth.my.id` | Marketing, catalogue, auth, dashboard, editor, checkout, plus `/api/v1/*` and `/api/webhooks/*` | `P0-23` |
| `admin.zedth.my.id` | The admin SPA and the admin API paths it proxies | `P5-01` |

The slug remains globally unique and remains the invitation's identity, so this is a change of address format, not of data model.

**Why not one single host for everything.** Serving guest-submitted content and the authenticated application from the same origin would create an escalation path that the wildcard design did not have. RSVP names and guestbook messages are attacker-controlled text rendered on the public page; a stored XSS that survives sanitization would then run on the **same origin** as the dashboard and the authenticated API, and could act as any logged-in user who opens that invitation — including the couple who own it. Under the original wildcard scheme each invitation had its own origin, so the browser's same-origin policy contained that failure for free. Splitting the public surface onto its own hostname costs exactly one static DNS record and restores that containment. `docs/SECURITY/02`'s trust boundaries survive this change; a single-host layout would have quietly removed one.

**Alternatives considered**

- **Wildcard `*.invitation.zedth.my.id` now**: the specified design, and still the target. Rejected for the MVP because it requires a wildcard DNS record and a wildcard certificate, which is precisely the automation that does not exist yet.
- **`/i/{slug}` prefix instead of a bare slug**: eliminates any chance of an application route shadowing an invitation. Rejected because this URL is forwarded by hand to hundreds of guests over WhatsApp, and `invitation.zedth.my.id/andi-sarah` is the product's public face. The collision risk is handled structurally instead — see Consequences.
- **A path prefix on one host for everything** (`/app`, `/admin`, `/{slug}`): fewest records, and rejected for the same-origin reason above.

**Consequences**

*The collision hazard is real and is closed by construction.* With invitations at the root of their host, any application route on that host could shadow a published invitation — a marketing page deployed at `/pricing` would take an invitation named `pricing` offline silently. The public host therefore serves **only** invitations, previews and the proxied `/public/*` API, and `slug_blocklist` (`docs/DATABASE/12`) reserves every path segment used on it. `P5-13` gains a CI check asserting that every reserved path is in the blocklist, so adding a route without reserving it fails the build rather than breaking a wedding.

*Migration is a configuration change, not a rewrite.* Slug resolution is implemented once, reading the slug from **either** a path segment or a `Host` header according to configuration (`docs/BACKEND/06`). When the Cloudflare token and tunnel automation land, `{slug}.invitation.zedth.my.id` becomes the canonical form by flipping that configuration and creating records; the path form must then **301 permanently** to the subdomain form and keep doing so indefinitely. Links to a wedding invitation are forwarded through family WhatsApp groups and never expire in practice, so a published URL is a promise.

*Canonical URLs and SEO.* `docs/PLAN/15`'s canonical URL becomes the path form. Since `seo_indexable` defaults to false, almost no invitation is indexed and the eventual canonical change carries little SEO cost — which is a good reason to migrate before that default is commonly overridden rather than after.

*This unblocks Phase 7 rather than complicating it.* The custom-domain feature (`P7-01`) needs exactly the same capability the project owner intends to build: programmatic DNS records against a tunnel. The work is now shared, and `P7-01` should be re-read as "per-invitation subdomains **and** custom domains", since both fall out of the same automation.

*Cost.* Nothing here is free of downside: three hostnames mean three certificate lifecycles instead of one wildcard, and a per-surface proxy configuration instead of one host rule. Caddy (ADR-015) automates certificates per hostname, so the operational cost is small.

**Specification impact** — Amended: `docs/PLAN/10` (publishing addresses and the migration path), `docs/PLAN/00`, `docs/PLAN/15`, `docs/PLAN/18` (R15), `docs/ARCHITECTURE/08`, `docs/API/08`, `docs/BACKEND/06`, `docs/DEVOPS/03`, `docs/FRONTEND/01`, `docs/FRONTEND/07`, `docs/SECURITY/02`, `docs/SECURITY/10`, `docs/UI-UX/02`.

---

### ADR-025 — Gift account numbers: no column encryption; protect integrity instead

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P1-13` — resolves `OQ-10` |
| **Deciders** | Project owner |

**Context** — `docs/SECURITY/09` § Encryption suggested "considering" application-level column encryption for `invitation_bank_accounts.account_number`, and `docs/SECURITY/00`'s data classification table listed the field as **Critical**, in the same row as password hashes, refresh tokens and payment payloads. That grouping invited a wrong instinct, and the project owner corrected it: the account number exists so that a guest who cannot attend can send a gift. It is entered by the couple to be **printed on their invitation**. The platform never uses it for any payment it processes — money moves between a guest and the couple's own bank, outside the system entirely.

That changes the threat model, so the decision has to be re-derived rather than inherited.

**What the field actually is.** For a published invitation with the gift section enabled, the account number is served to every guest who opens the link — publication is the entire purpose. The database additionally holds account numbers that are **not** public: drafts, invitations with the gift section toggled off (`docs/API/08` omits them, BR-4.1), expired invitations, and soft-deleted ones.

**Decision** — **No column-level encryption for `invitation_bank_accounts.account_number`.** Protect it with storage-level encryption covering the whole database, the existing access controls, and — the part that actually matters here — **integrity controls**, because for a number published in order to receive money, tampering is a worse outcome than disclosure.

Concretely:

1. **Storage-level encryption at rest for the entire database**, plus encrypted backups (already required by `docs/DEVOPS/04`).
2. **Object-level authorization** on every bank-account endpoint, already the project's first priority (`docs/SECURITY/05`).
3. **Omission from the public payload** whenever the gift section is disabled — specified, and tested per-section in `P2-07`.
4. **Log masking** to the last four digits, enforced by the logger (`P0-12`), never by developer discipline.
5. **New: every change to a bank account on a `published` invitation notifies the owner by email**, in the manner of a bank confirming a payee change.
6. **New: bank account writes are recorded** with actor and timestamp, so "when did this number change, and who changed it" is answerable.

**Alternatives considered**

- **Column-level encryption**, the option `docs/SECURITY/09` floated. Rejected on proportionality. The threat it addresses is a stolen database dump — but that same dump contains full names, home and venue addresses, coordinates, phone numbers, photographs and complete guest lists, all in plaintext. Encrypting one column does not change what a breach is or how it must be disclosed under the PDP law; it narrows a hole in a wall that is open beside it. If the concern is a stolen dump, the proportionate control is encryption of the whole store, which is item 1.

  It also costs more here than it looks: the value is decrypted on every render of the page it appears on, and the field stops being queryable — which forecloses the one query worth having, "is this account number reused across many unrelated invitations", a genuine fraud signal.

- **Encrypting only the non-public subset** (drafts and gift-disabled invitations): coherent in principle, since that subset is the only part encryption protects. Rejected as unimplementable in practice — the same row moves in and out of that subset every time an owner toggles a section or publishes, so it would mean re-encrypting on state changes and a schema that stores the same column two ways.

- **Not storing the account number at all** (asking the couple to re-enter it, or accepting an image): rejected. It defeats the feature, and an image is worse in every respect.

**Consequences**

The security effort moves to where the loss actually is. If an attacker can change the account number on a live invitation — through an authorization bug, or a compromised owner account — then every guest who scans that page sends their gift to the attacker. The couple learns about it after the wedding, from relatives asking why the money never arrived. That is direct financial harm to third parties who have no relationship with the platform, and column encryption does nothing about it. Ownership checks, an audit trail and a change notification do.

Items 5 and 6 are additions to the specification rather than restatements of it, and they carry a small cost: an extra email and an extra write on a rarely-changed field.

`payments.raw_callback_payload` is deliberately **not** covered by this ADR. It is a different field with a different profile — never displayed, provider-supplied, and retained specifically so a signature can be re-verified during an investigation, which redaction would destroy. It stays unencrypted at the column level under the same storage-level protection, with access restricted and access logged (`docs/API/09`). If a provider is ever observed sending card-like data, that is a PCI scope change and `P3-16` is where it must be caught.

Nothing here is expensive to revisit. Column encryption can be added later at the cost of a migration, and while there is no production data that migration is free — which is why the decision was worth making now rather than at `P1-13`.

**Specification impact** — Amended: `docs/SECURITY/00` (data classification now separates credentials from sensitive personal data the owner deliberately publishes), `docs/SECURITY/09` (§ Encryption states the decision and its reasoning), `docs/DATABASE/06` (the column note), `docs/DATABASE/08` (raw payload scoped separately), `docs/PLAN/13` (gift account change notification), `docs/PLAN/18` (R16 — gift account tampering).

---
