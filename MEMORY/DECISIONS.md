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

**Decision** — TypeScript on Node.js LTS, with **NestJS 12** as the backend framework, in one monorepo with the frontends.

*Version correction (2026-09-09, `P0-02`)*: this ADR originally named Node 22 LTS. Node 24 is the active LTS and 22 is in maintenance, so the pin is **Node 24 LTS** (`.nvmrc`, `engines`). A version correction inside an accepted decision, not a change of decision.

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
| **Status** | Accepted — **hostnames superseded by ADR-042**; the structure (path-based, three fixed hosts, no wildcard) stands unchanged |
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

### ADR-026 — One branch per task, named for its task ID; `main` carries no in-progress code

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Status** | Accepted |
| **Task** | `P0-03` |
| **Deciders** | Project owner |

**Context** — `TASKS/00-TASK-CONVENTIONS.md` originally specified a branch per task (`feat/P1-09-invitation-create`) without saying anything about what `main` should contain. The project owner asked for two things, in two steps: first that development work happen off `main` so it stays free of in-progress code, and then — after a first pass used phase-wide branches — that branch names carry the phase and task number rather than a generic phase label.

The repository's history at that point was four commits, all specification, plan and record. `P0-02` had just produced the first 70 code files.

**Decision** — One branch per task, named `<type>/P<phase>-<nn>-<slug>`, merged to `main` only when that task's Definition of Done — including its MEMORY record — is satisfied. Changes confined to `docs/`, `TASKS/` and `MEMORY/` may land on `main` directly; they are reference, plan and record, and are not the in-progress code `main` is being kept clean of.

**Alternatives considered**

- **A branch per phase** (`feat/phase-0-foundation`), which this ADR proposed in its first form and the project owner rejected. It keeps `main` equally clean, but the name hides every task in the phase behind one label, so it answers neither "which task is this" nor "is it finished". It also produces a branch living for weeks — Phase 1 is 25 tasks — which delays integration problems rather than preventing them.
- **Trunk-based, straight onto `main`**: fastest, and exactly what the owner asked to avoid.

**Consequences** — The task ID now appears in the branch, every commit subject, the PR, the MEMORY record and `PROGRESS.md`: one chain, five links, and the branch is its first. `main` only ever gains a task that is genuinely finished, so "what is on main" and "what is done" are the same question.

The cost is more branches and more merges than a phase branch would produce, and a merge per task means the board and the record must be updated per task rather than per phase — which the global Definition of Done already required anyway.

The commit convention is unchanged and remains strict: subjects start with the task ID.

**Specification impact** — `TASKS/00-TASK-CONVENTIONS.md` § Branch, Commit, PR rewritten; `.githooks/pre-push` warns on any name that is not task-shaped; `README.md` § Working conventions updated.

**Note on this record** — an earlier form of this ADR, written during the same session and never committed, specified phase branches. It was corrected in place rather than superseded, because it had not yet landed anywhere a reader could have relied on it. The alternatives section above keeps the rejected option and the reason, which is the part worth preserving.

---

### ADR-027 — Surfaces live in `backend/`, `frontend/` and `admin/`, and `docs/FRONTEND/00` is left unamended

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Status** | Accepted |
| **Task** | `P0-25` |
| **Deciders** | Project owner |

**Context** — `P0-02` created `apps/{api,worker,web-app,public-invite,admin}` because `docs/FRONTEND/00-FRONTEND-STANDARDS.md` § Project Structure specifies exactly that shape, and ADR-005 recorded it. The project owner asked for the three surfaces to be separated into their own top-level directories, and — asked a second time — that `docs/` not be amended to match.

**Decision** — Four top-level groups:

```
backend/    api, worker
frontend/   web-app, public-invite
admin/      the admin panel
packages/   schema, template-renderer, ui, api-client, config
```

`docs/FRONTEND/00` § Project Structure keeps describing `apps/`. It is **knowingly** out of step with the repository, at the owner's instruction, and this ADR is the record of that.

**Alternatives considered**

- **Keeping `apps/`**, the specified shape. Rejected by the owner.
- **Amending `docs/FRONTEND/00`** to describe the new layout, which is what `CLAUDE.md` § "When docs and reality disagree" and the deviation protocol in `TASKS/00-TASK-CONVENTIONS.md` normally require. Explicitly declined by the owner, so the divergence is carried here instead. This is the part worth flagging: the protocol exists so that code and specification never drift silently, and the compensating control is that both agent instruction files now say plainly that the document disagrees and which one to trust.
- **Putting `admin/` under `frontend/`**, since it is also a React application. Rejected on the stronger grouping: `docs/SECURITY/02` § boundary 3→4 places the admin panel behind its own trust boundary, on its own hostname, with a session deliberately separate from the user application (ADR-024). Filing it beside the surface it is isolated from would make the layout argue against the architecture.

**Consequences**

The layout now mirrors the trust boundaries rather than the languages, which is the more useful thing for a reader to see first: the two backend processes deploy together, the two user-facing apps share a renderer, and the admin panel shares nothing with either.

The cost is a documented inconsistency. Anyone reading `docs/FRONTEND/00` alone will build the wrong mental model, and `docs/DEVOPS/02-CONTAINERIZATION.md`'s compose example still names `./apps/api`. The mitigation is narrow but real: `CLAUDE.md` and `AGENTS.md` are read first by every session and now state both the true layout and the fact that the document disagrees. A one-line note in `docs/FRONTEND/00` would close it whenever the owner wants.

`git mv` was used throughout, so `git log --follow` still traces every moved file. Prior MEMORY records and ADR-005 keep their original paths — they describe what was true when written, and rewriting them would break the property that makes the record trustworthy.

**Specification impact** — None, deliberately. `docs/FRONTEND/00` § Project Structure and `docs/DEVOPS/02` § docker-compose remain as written and are now known to differ from the repository.

---

### ADR-028 — GitHub Actions is deferred; the gates run locally instead

**Date** 2026-09-10 · **Status** Accepted · **Task** `P0-17` · **Supersedes** nothing

**Context** — `P0-17` calls for the seven-step pull-request pipeline in `docs/DEVOPS/01-CI-CD.md`. The project owner asked to skip GitHub CI for now.

That is a reasonable call for a single-developer project that merges locally: there are no pull requests to run a pull-request pipeline on, so a `pull_request` workflow would have been enforcing nothing while appearing to enforce everything. The appearance is the dangerous part.

**Decision** — `P0-17` is **DEFERRED**, not dropped, and the gates it would have carried move to two local mechanisms:

1. `scripts/verify.sh` — format, lint, typecheck, test, the `:id` gate, the Helm chart check, and build. Run before a merge to `main`.
2. `.githooks/pre-push` — now **blocks** a push that adds an `:id` endpoint without touching a test.

The second one is the one that matters. `docs/SECURITY/05` sets zero tolerance for cross-tenant leaks, and `scripts/check-id-endpoint-tests.mjs` was written in `P0-03` to enforce it. It was going to be wired into the pull-request workflow. Deferring CI without moving it would have left the project's highest-priority security rule with **no automated enforcement at all** — a checklist item in a document, which is what `P0-03` built the script to stop being.

**Consequences** — What is lost is real and is not mitigated by any of the above:

| Gate | Status now |
|---|---|
| Integration tests against real Postgres and Redis | Not run automatically anywhere |
| Service-layer coverage floor, 80% (`docs/BACKEND/09`) | Not enforced |
| SAST and dependency CVE scanning (`docs/SECURITY/11`) | Not run |
| Reviewer approval before merge (`docs/DEVOPS/01`) | Not enforced |
| Actions pinned by digest — supply-chain control | Not applicable yet |

And local hooks are weaker than CI in three specific ways, all of which should be assumed to happen eventually: `--no-verify` bypasses them, a fresh clone has no hooks until `pnpm install` runs `prepare`, and nothing verifies a clean checkout — the class of bug that hid behind a stale `.tsbuildinfo` in `P0-04` is invisible to a local run by construction.

**When this must be revisited** — before the payment code in Phase 3 is written, at the latest. `docs/SECURITY/07` and `P3-16` assume a pipeline that can reject a change, and "a reviewer approved it" is not a control that exists here yet. `P0-17` keeps its dependency chain so `P0-23` still sees it.

**Specification impact** — None. `docs/DEVOPS/01-CI-CD.md` stands as the target; it is simply not implemented yet, which the task board now says explicitly.

---
### ADR-029 — PostgreSQL 18, and the volume mount that moved with it

**Date** 2026-09-10 · **Status** Accepted · **Task** `P0-06` · **Amends** ADR-007, ADR-015 (the `PostgreSQL 16` in each now reads 18)

**Context** — ADR-007 and the stack table said PostgreSQL 16, chosen before any code existed. The project owner asked for `postgres:18-alpine` while `P0-06` was wiring up migrations — the cheapest possible moment, since the only schema that exists is one function and no data exists anywhere.

**Decision** — **PostgreSQL 18**. `deploy/docker-compose.yml` runs `postgres:18-alpine`.

**The part that is not a version bump.** PostgreSQL 18's official image moved the data directory and the declared volume:

| | 16 | 18 |
|---|---|---|
| `PGDATA` | `/var/lib/postgresql/data` | `/var/lib/postgresql/18/docker` |
| declared `VOLUME` | `/var/lib/postgresql/data` | `/var/lib/postgresql` |

The compose file mounted `postgres-data:/var/lib/postgresql/data`. Left alone, that does **not** error. The named volume mounts and stays empty, the real data goes to an anonymous volume Docker creates for the declared path, and everything works — until the first `docker compose down`, at which point the database is empty and the named volume is still sitting there looking correct. A developer would reasonably conclude the volume was broken rather than unused.

The mount is now `postgres-data:/var/lib/postgresql`. Verified rather than reasoned about: wrote a row, ran `down`, ran `up`, read the row back.

**Consequences** — Any existing local volume holds a version-16 cluster that an 18 server refuses to start on. Local fix is `docker compose -f deploy/docker-compose.yml down -v`, which is free here because nothing but the baseline migration exists. **This would not be free later**, and it is the reason to take the bump now rather than at staging setup (`P0-23`).

`gen_random_uuid()` remains core, so nothing in `docs/DATABASE/` changes. Verified on the image: it works with `pg_extension` holding nothing but `plpgsql`.

`docs/DEVOPS/02-CONTAINERIZATION.md` still shows `postgres:16-alpine` in an illustrative snippet, unamended under the standing instruction that `docs/` is not rewritten for workflow and infrastructure decisions (ADR-027). The stack tables in `CLAUDE.md` and `AGENTS.md` — which every session reads first — now say 18.

**Specification impact** — None. No document states a required major version outside that one snippet.

---

### ADR-030 — Down migrations are written by hand, and are a development tool

**Date** 2026-09-10 · **Status** Accepted · **Task** `P0-06`

**Context** — The `P0-06` Definition of Done requires an up/down/up round trip. Drizzle does not generate down migrations: `drizzle-kit generate` emits one forward SQL file and nothing else, and `drizzle-orm`'s migrator only moves forward.

So the DoD could not be met as written without building something. The question was what, and how honestly to describe it.

**Decision** — Every migration ships a hand-written `<tag>.down.sql` beside it, and `db:rollback` reverses the most recently applied one.

Bookkeeping stays in Drizzle's own table rather than a second one of ours. Drizzle records applied migrations in `drizzle.__drizzle_migrations` as `(id, hash, created_at)`, where `created_at` equals the `when` of the matching entry in `meta/_journal.json`. `db:rollback` maps that timestamp back to the journal, finds the tag, runs the down file and deletes the row — in one transaction, so a half-failure cannot leave the table claiming a migration is applied when its objects are gone.

**`db:rollback` is a development tool. It is not the production recovery mechanism**, and this ADR exists partly to stop it being read as one. `docs/DEVOPS/08-ROLLBACK.md` never treats down migrations as recovery: its database story is expand-contract, where safety comes from the old schema still being present, so that a *code* rollback lands on a schema that still has the columns it reads. Reversing a schema change over live data is lossy by nature — dropping a column drops everything written to it since the deploy, and no `.down.sql` returns it. Production recovery remains expand-contract, roll-forward, and point-in-time restore.

What it is genuinely good for is the local loop: apply a migration, find it wrong, undo, edit, apply again, without recreating the container and losing the rest of the local database. That is a real cost it removes, several times a week, for the next four tasks.

**Alternatives considered**

- **No down migrations; recreate the database when a migration is wrong.** Honest and zero code, and defensible for production. Rejected for the local loop: `P0-07` through `P0-10` will iterate on the schema constantly, and a tool that makes the wrong thing easy gets worked around.
- **A second table tracking our own migration state.** Avoids reaching into Drizzle's internals, but creates two sources of truth about what has been applied, which can disagree. A disagreement here is worse than the coupling.
- **A migration library that has down migrations natively (node-pg-migrate, Umzug).** Would mean two migration tools, or abandoning the schema fidelity that ADR-007 chose Drizzle for.

**Consequences** — We depend on a Drizzle internal: one table, three columns. That coupling is pinned by `backend/api/test/db-migrations.spec.ts`, which reads the DDL out of the installed package, so a Drizzle upgrade that changes the shape fails a test rather than silently reversing the wrong migration.

Writing the down file is manual and therefore forgettable, so `scripts/check-migration-pairs.mjs` fails when one is missing — and when a `.down.sql` is orphaned by a deleted migration. "This cannot be reversed" is a valid down file, as long as it exists and raises an error naming what to restore from instead. An absent file and a deliberate refusal look identical from the outside; only one of them is a decision.

**Specification impact** — None. `docs/DEVOPS/08` describes expand-contract and rollback strategy and says nothing about down migrations either way; this fills a gap rather than contradicting one.

---
### ADR-031 — `users.email` is unique among active accounts only

**Date** 2026-09-10 · **Status** Accepted · **Task** `P0-07` · **Amends** `docs/DATABASE/02-USERS.md`

**Context** — `docs/DATABASE/02-USERS.md` defined email uniqueness twice, in two incompatible ways:

```sql
email VARCHAR(255) NOT NULL UNIQUE,
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
```

A column-level `UNIQUE` constrains every row in the table, soft-deleted ones included. With it in place the partial index can never reject anything the constraint has not already rejected — it is unreachable code expressed as an index.

The two statements also encode opposite intentions. The partial predicate exists so that a soft-deleted account releases its address; the column constraint holds that address until the row is physically gone. `docs/SECURITY/09` puts a retention period between those two events, and the `P0-07` task card states the goal outright: "the partial unique index that makes soft-deleted accounts free their email".

Under the document as literally written, a user who deleted their account could not register again with the same address for the length of the retention window, and the failure would surface as a duplicate-key error rather than anything they could act on.

**Decision** — The partial unique index is the only uniqueness rule on `users.email`. The column-level `UNIQUE` is dropped, and `docs/DATABASE/02-USERS.md` is amended in the same change with a note explaining why the two cannot coexist.

**Alternatives considered**

- **Keep the column `UNIQUE`, drop the partial index.** Simpler, and defensible if email reuse were unwanted. Rejected because it contradicts the stated goal of the task and the retention model in `docs/SECURITY/09`, and because it makes account deletion partially irreversible from the user's point of view.
- **Keep both and treat the partial index as documentation.** Rejected on principle: an index that can never fire is a lie in the schema, and the next person to read it would reasonably assume email reuse works.

**Consequences** — A deleted account's address becomes available immediately, which is the intended behaviour and is now covered by three tests: a duplicate among active users is rejected, the address is accepted once the first row is soft-deleted, and a *third* active account is still refused. That third test exists because the obvious wrong fix — dropping uniqueness altogether — would satisfy the second one.

**A hazard this creates**, recorded so it is not discovered later: any lookup by email that forgets `WHERE deleted_at IS NULL` can now match a deleted account instead of the live one, and two rows can legitimately share an address. The index makes the correct query natural but cannot force it. This is a rule for `P0-11`'s repository layer, noted in the feature spec's open questions.

**Specification impact** — `docs/DATABASE/02-USERS.md` amended: the `UNIQUE` keyword removed from the column, with a blockquote stating that uniqueness comes from `idx_users_email` and why. The `P0-07` DoD required exactly this — an ADR *and* the document corrected in the same change.

---
### ADR-032 — `media.invitation_id`'s foreign key is added by `P0-09`, not `P0-08`

**Date** 2026-09-10 · **Status** Accepted · **Task** `P0-08`

**Context** — Three tables reference each other across a task boundary:

```
template_assets.media_id        -> media               (both P0-08)
media.invitation_id             -> invitations         (P0-09)
invitations.template_version_id -> template_versions   (P0-08)
```

`media` must exist in `P0-08` because `template_assets` references it. But `media.invitation_id` references `invitations`, which `P0-09` creates. There is no ordering of these four tables that satisfies every foreign key within one migration.

The `P0-08` card notices half of this — step 5 says "`media` is created first in the same migration" — but not the half that crosses into the next task.

**Decision** — Create the `invitation_id` **column** in `P0-08` exactly as documented (`UUID`, nullable, with `idx_media_invitation`), and add the **foreign key constraint** in `P0-09` with `ALTER TABLE media ADD CONSTRAINT ... FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE`.

The final schema matches `docs/DATABASE/06-MEDIA.md` exactly. Only the moment the constraint appears differs, and it differs by one migration.

**Alternatives considered**

- **Move `media` into `P0-09`.** Then `template_assets` cannot be created in `P0-08` either, so `P0-08` becomes three tables and `P0-09` becomes eleven — moving the problem rather than solving it, and unbalancing two tasks that are already sized.
- **Make `media.invitation_id` a plain UUID with no constraint, permanently.** Rejected outright: the referential rule is the thing that stops orphaned media accumulating when an invitation is deleted.
- **Create a stub `invitations` table in `P0-08` and alter it later.** Worse in every way — a half-defined table that `P0-09` would have to reconcile against the document.

**Consequences** — Between `0002` and `0003` there is a window where `media.invitation_id` accepts any UUID, including one that references nothing. Nothing writes to `media` in that window, so the exposure is theoretical, but the real risk is not the window: it is that **the constraint is simply forgotten** and the window never closes.

Three things close it:

1. `P0-09`'s task card gains an explicit step and a DoD line for the `ALTER TABLE`.
2. A test in `P0-08` asserts the constraint is **absent**, with a comment saying it must be replaced — not deleted — when `P0-09` lands. A test that starts failing is a much louder reminder than a note.
3. This ADR.

**Specification impact** — None. `docs/DATABASE/06-MEDIA.md` describes the end state, which is what the schema reaches at `0003`.

---
### ADR-033 — `invitations.slug` is unique among live invitations only

**Date** 2026-09-10 · **Status** Accepted · **Task** `P0-09` · **Amends** `docs/DATABASE/04-INVITATIONS.md` · **Follows** ADR-031

**Context** — The same mistake ADR-031 corrected in `docs/DATABASE/02`, in a second file. `docs/DATABASE/04` declares:

```sql
slug VARCHAR(50) UNIQUE,
CREATE UNIQUE INDEX idx_invitations_slug ON invitations(slug) WHERE deleted_at IS NULL;
```

What makes this one clearer than the `users.email` case is that the document then states the intent in its own Notes:

> The `slug` unique constraint only applies to rows where `deleted_at IS NULL` (partial unique index) so a slug can be reused after the old invitation is truly deleted.

A column-level `UNIQUE` applies to every row, soft-deleted ones included. With it in place that sentence is false and the partial index can never fire.

**Decision** — The partial unique index is the only uniqueness rule on `invitations.slug`. The column-level `UNIQUE` is dropped and `docs/DATABASE/04` is amended, with a note explaining why the two cannot coexist.

**Consequences** — A deleted invitation releases its public address immediately, which is what the document intends. Three tests cover it: a duplicate among live invitations is rejected, the slug is reusable after a soft delete, and a **third** live invitation is still refused — that last one because the obvious wrong fix, removing uniqueness altogether, would satisfy the second.

A fourth test asserts that many invitations may have **no** slug at all. Drafts have none, and NULLs do not collide in a unique index; that is worth pinning rather than assuming, because it is the normal state of every invitation before publication.

**Two files now share this correction.** That is a pattern rather than a coincidence — the specification was written with `UNIQUE` as a reflex on any column that ought to be unique, without considering soft deletes. Any remaining table with both `deleted_at` and a `UNIQUE` column should be checked before its schema task. `media` is the only other soft-deleted table and has no unique column, so `users` and `invitations` are the whole set.

**Specification impact** — `docs/DATABASE/04-INVITATIONS.md` amended: `UNIQUE` removed from the `slug` column, and the Notes entry extended to say the column carries no constraint of its own and why.

---
### ADR-034 — Secrets live in per-environment scopes, and the split is enforced in code

**Date** 2026-09-10 · **Status** Accepted · **Task** `P0-18`

**Context** — `docs/DEVOPS/00` requires staging and production configuration to be "managed via a secret manager … NEVER committed to the repo", and requires staging to use the payment provider's sandbox credentials while production uses live.

Those are two different problems. Keeping secrets out of the repository is a process question with a mechanical answer. Keeping them in the *right* environment is not: a live payment key on staging is a valid string of the right shape and length, and every per-field check passes it.

**Decision** — Three things, in increasing order of how much they actually protect.

1. **Per-environment scopes, not folders in one store.** Development uses a git-ignored `.env`; staging and production use separate scopes of the secret manager. A single store with a naming convention makes a cross-environment read a typo away, and the typo that matters is reading production credentials into staging.

2. **Secret scanning at commit time**, `.githooks/pre-commit` running `scripts/check-secrets.mjs`. It blocks. A leaked credential is not recoverable by deleting the commit — once it reaches a shared history it is rotated or it is compromised — so the only useful moment to catch it is before it lands.

3. **The environment split is enforced by the service refusing to start.** `backend/api/src/config/secret-rules.ts` rejects a live Midtrans key outside production, a sandbox key inside it, a short signing key, a non-HTTPS origin and a localhost database in production. Exit 78, naming every violation at once.

The third is the one that earns its place. The first two stop a secret being where it should not be; only the third stops a *correct* secret being used in the wrong place, and that is the failure with real money attached.

**Alternatives considered**

- **A `PAYMENT_MODE=sandbox|live` flag.** Rejected: it adds a value someone must remember to flip in step with the key, and a mismatch between flag and key is a new failure mode. The provider's `SB-` prefix already carries the information.
- **Rely on deployment discipline.** That is what the document already asks for. `P0-18`'s card asks for the two to be non-interchangeable "by configuration mistake", which means the machine has to catch it.
- **Scan in CI only.** CI is deferred (ADR-028), and a commit-time hook catches the leak one step earlier regardless.

**Consequences** — The sandbox-in-production check is the one most likely to be questioned, because it refuses a configuration that "works". It works in the worst possible way: every payment succeeds against the provider's test environment, no money arrives, and the orders look paid. Nothing errors, so nothing alerts.

The scanner will produce false positives — it did on its first run, flagging a fake JWT used as a test fixture for the redactor. The documented escape is a word like `example` on the line, which also makes it read as a placeholder to a human. That is deliberate: a scanner that cries wolf gets disabled, and a disabled scanner catches nothing.

`--no-verify` bypasses the hook, and with CI deferred nothing else checks. `deploy/SECRETS.md` says that if it is used, the value should be treated as compromised.

**Specification impact** — None. `docs/DEVOPS/00` describes the intent; this implements it and adds the enforcement the document assumes.

---
### ADR-035 — Logging is one package, and a build guard keeps it that way

**Date** 2026-09-10 · **Status** Accepted · **Task** `P0-19.1`

**Context** — `docs/DEVOPS/06` § Mandatory Redaction requires redaction "at the logger middleware level, not relying on manual developer discipline each time".

`P0-12` implemented that for the API. `P0-15` gave the worker a **separate** logger with a comment on it: "NOTE: this does NOT redact … the worker logs only fields it constructs itself … That is a real limitation and it is written down rather than assumed." The `P0-15` record predicted the cost and named `P0-19` as the place to fix it. `P0-19` did not fix it, and paid the prediction: a crash-on-startup bug had to be fixed **twice**, once per copy.

Two tasks later the worker still had a logger that wrote whatever it was handed, in clear text.

**Decision** — Three parts.

1. **`packages/logging` (`@wi/logging`) owns redaction, request context and job trace.** It exports `createLogger(config, destination?)` rather than a logger instance, because the service name differs per surface and a package that decides it would need to read an environment variable on behalf of its consumer.

2. **Each surface owns its instance.** `backend/api/src/shared/logging/logger.ts` and `backend/worker/src/logger.ts` are now four lines each: read `SERVICE_NAME`, call `createLogger`. The API additionally **pre-binds** `logSecurityEvent` to its security logger, because the package's signature takes the logger first and passing `logger` instead of `securityLogger` would compile, run, and silently move a security event from the 1-year retention stream to the 90-day one.

3. **`scripts/check-logger-construction.mjs` refuses a `pino()` call outside `packages/logging/src/`**, blocking in `scripts/verify.sh` and `.githooks/pre-push`. Tests are exempt, because a test that builds its own instance to capture output is doing the opposite of hiding a leak.

The third part is the one that matters. A comment saying "this does not redact" is not a mechanism — it survived four tasks and changed nothing. A logger built directly from `pino()` produces the same field names at the same level on the same stream; nothing about it looks wrong. The guard is the difference between a rule and a hope.

**Alternatives considered**

- **Export a ready-made `logger` singleton.** Rejected: the package would have to read `SERVICE_NAME` for its consumer, and the worker sets a different one per pool.
- **Leave the duplication and add a test to each surface.** Rejected: it is the arrangement that just failed. The duplicated crash fix is the evidence.
- **A lint rule instead of a script.** Reasonable, and the better home once `P0-17` wires ESLint. The script works today, with CI deferred (ADR-028), and moving it later is a small edit.

**Consequences** — The worker redacts for the first time. Anything the worker logs — a whole job payload, an error carrying a connection string with a password in it — now goes through the same key-name walk as the API.

`createLogger` gained an optional `destination` parameter purely so a test can assert what *that function* produces. This is not cosmetic: the suite inherited from `P0-12` builds its own pino instance with a copy of the formatters, so deleting the `log` formatter from `logger.ts` leaves all 39 of its assertions passing. `logger.spec.ts` closes that. Measured by mutation: replacing `redact(object)` with `object` fails exactly two tests in `logger.spec.ts` and none in `logging.spec.ts`.

The guard is a text check and can be evaded. It is not aimed at a determined author; it is aimed at the ordinary one who reaches for `pino()` because that is what the docs for pino say to do.

**Specification impact** — None. `docs/DEVOPS/06` already required this; the code did not do it.

---
### ADR-036 — The container dependency layer is keyed on the lockfile, not a hand-written list of workspace members

**Date** 2026-09-10 · **Status** Accepted · **Task** `P0-19.1`

**Context** — `backend/api/Dockerfile` used the standard monorepo Docker recipe: `COPY` every workspace member's `package.json` individually so the `pnpm install` layer caches on manifests alone rather than on the whole source tree.

`P0-19` found that list two members stale (`packages/storage`, `e2e`) and recorded it under *What to Watch*: "The Dockerfile's hand-maintained package list will go stale again." The failure is silent — the image builds, and the container serves whatever the layer cache last produced. `P0-19` found it only because E2E asked the running container for a route that had existed since `P0-13` and got a 404.

`P0-19.1` added a third package and had to touch the list again.

**Decision** — Delete the list. `pnpm fetch` populates the store from **the lockfile alone** — it reads no `package.json` at all — so the dependency layer's cache key becomes `pnpm-lock.yaml`. The build stage then does `COPY . .` and installs from the warm store.

`pnpm-workspace.yaml` travels with the lockfile, because it carries the `allowBuilds` decisions; without it `pnpm fetch` refuses with `ERR_PNPM_IGNORED_BUILDS` rather than silently skipping native postinstalls. It lists globs, not members, so it cannot go stale the way the manifest list did.

The build commands also lose their hand-kept list: `pnpm --filter @wi/api... build` (trailing dots) builds the target and everything it depends on, in graph order.

**Alternatives considered**

- **Add `packages/logging` to the list and move on.** The obvious option, and it is what the previous two tasks each did. Three strikes.
- **`COPY . .` with no fetch stage.** Correct, and loses dependency-layer caching entirely: every source edit re-downloads every package.
- **Generate the list with a script.** A generated list still has to be regenerated, which is the same failure with an extra step.

**Consequences** — The cache key is now the lockfile, so adding a dependency anywhere re-fetches everything. Adding a dependency is rare; forgetting a package is not, and the second failure is silent while the first is a slow build.

**`--prefer-offline`, not `--offline`.** `--offline` was tried first, because it would *prove* the fetch layer complete — a missing package would fail the build rather than quietly reaching the network. It does not work: pnpm 11 verifies the lockfile against its supply-chain policies on every install, and that check reads registry metadata `pnpm fetch` does not mirror (`ERR_PNPM_NO_OFFLINE_META`). Package tarballs still come from the warm store; what crosses the network is metadata. Recorded because "offline" was the stronger claim and this is not it.

`backend/worker/Dockerfile` had the same latent bug in its build command and it stopped being latent in this task: it ran `pnpm --filter @wi/worker build`, so no workspace dependency had a `dist/`, and the worker's first type-level workspace import failed the image build outright. Fixed the same way. Its dependency layer already copies `packages/` wholesale, so it never had the manifest-list problem.

**Specification impact** — None. `docs/DEVOPS/02` sketches a single-package Dockerfile; the monorepo already deviates from it and the deviation is not new here.

---
### ADR-037 — The section keys and the component registry are closed, and the registry is append-only

**Date** 2026-09-10 · **Status** Accepted · **Task** `P0-20`

**Context** — `docs/PLAN/07` § Section System lists ten sections and shows a `component` field holding "component name in the renderer library". It does not say whether either vocabulary is closed. `docs/FRONTEND/04` § Component Registry resolves the name through a lookup table, which implies a fixed set at render time but says nothing about validation time.

**Decision** — Three parts.

1. **`section_key` is an enum of exactly ten values.** The reason is `docs/PLAN/07` § Template Compatibility & Migration: switching templates "matches the `section_key` present in both templates". With free-text keys, two templates that both mean "the gallery" but spell it `gallery` and `photos` silently drop the user's toggles and their section order on switch — data preserved, presentation scrambled, and no error anywhere.

2. **`component` must be registered, and registered *for that section key*.** Binding a component to one section is stricter than the document asks. It costs a lookup and it rejects `{ "section_key": "gallery", "component": "HeroClassic" }`, which passes any name-only check and renders a hero where the gallery belongs.

3. **The component registry is append-only.** `docs/PLAN/07` § Backward Compatibility already requires a breaking component change to ship as a new name (`GalleryGridV2`) "because older template versions explicitly reference the old component name". Combined with BR-3.1 — an invitation locks a version forever — removing a name breaks every invitation locked to a version that used it. That is R5 in `docs/PLAN/18`, and this makes it a rule the validator holds rather than a risk someone remembers.

**Alternatives considered**

- **Free-text `section_key` with a documented convention.** Rejected: the failure is silent and only appears on template switch, which is the one moment a user is already anxious about losing their data.
- **Validate the component name only, not its section.** Rejected: it costs nothing to also check the pairing, and the mispairing is exactly the mistake a copy-pasted section entry makes.
- **Keep the component registry in `packages/template-renderer`.** Rejected for now: the API must validate a definition without importing React. The names live in `@wi/schema`; the renderer owes it a parity test when it exists (`P0-22`/Phase 2), and that obligation is written into `component-registry.ts` rather than assumed.

**Consequences** — Adding a section type is a deliberate edit in two places: a key here and a component there. That is the intended friction — a new section is a product decision, not a template-authoring one.

The parity test does not exist yet, so today nothing proves these eleven names correspond to real components. They are a contract the renderer must satisfy, and until `P0-22` they are only a contract.

**Specification impact** — None. Both closures are readings of existing requirements rather than new ones.

---
### ADR-038 — `border_radius` and `typography.scale` are enumerated, with values `docs/` does not give

**Date** 2026-09-10 · **Status** Accepted · **Task** `P0-20` · **Open question** OQ-20

**Context** — `docs/PLAN/07` § Theme Variables shows a theme by example:

```json
"typography": { "heading_font": "Playfair Display", "body_font": "Lato", "scale": "default" },
"spacing": "comfortable",
"border_radius": "rounded"
```

`spacing` is safe — the prose names all three values (`compact | comfortable | spacious`). For `scale` and `border_radius` the document gives exactly one example value each and no vocabulary.

**Decision** — Enumerate both, and invent the missing values:

- `typography.scale`: `compact | default | large`
- `border_radius`: `none | subtle | rounded | full`

Raised as **OQ-20** in `TASKS/BACKLOG.md` rather than decided silently, per `CLAUDE.md`.

**Alternatives considered**

- **Accept any string.** The honest option given the document, and rejected: a theme value becomes a CSS custom property, and an unknown one renders as *nothing* rather than as an error. A template with `border_radius: "roundeed"` would have square corners on every invitation and no signal anywhere.
- **Block `P0-20` on the answer.** Rejected: `P0-20` is a hard prerequisite for editor work (`docs/PLAN/16` § Critical Dependencies), and blocking the template system on a design-token vocabulary would stop the phase for a question whose answer is cheap to change.

**Consequences** — Widening an enum later is free: existing stored definitions stay valid. Narrowing it is a migration over JSONB in every `template_versions` row, which is precisely why enumerating now beats accepting any string now.

The reference template (`P0-21`) will use `rounded` and `default`, so the invented values are unexercised until a second template exists. If the answer to OQ-20 differs, the change is a one-line edit to two `z.enum` calls and — if a stored definition used a value being removed — a data fix. With one template that is a single row.

**Specification impact** — None yet. If OQ-20 is answered, `docs/PLAN/07` § Theme Variables should gain the vocabularies so the next reader does not have to find this ADR.

---
### ADR-039 — Design tokens are CSS, not a JavaScript config

**Date** 2026-09-11 · **Status** Accepted · **Task** `P0-22`

**Context** — `docs/UI-UX/06` makes the token set "the single source of truth for application UI components" and `docs/FRONTEND/00` names "utility-first CSS (Tailwind) + design tokens". Three applications consume them: `web-app` and `public-invite` on Next.js, `admin` on Vite.

The conventional arrangement is a `tailwind.config.js` exporting a theme object, imported by each app, plus a parallel set of CSS custom properties for anything Tailwind cannot express. That is two declarations of every value.

**Decision** — The tokens live in `packages/ui/src/tokens.css` as a Tailwind v4 `@theme` block, and nothing else declares a colour, size or spacing value.

Tailwind v4 reads `@theme` and does two things with it: emits every entry as a custom property on `:root`, and generates the utility classes named after it. So `bg-primary-600`, `var(--color-primary-600)` and the value in the file are the same declaration — they cannot disagree, because there is only one.

A **semantic layer** sits on top: `--color-surface`, `--color-text`, `--color-border-strong`. Components reference those, never a ramp step. That is the structure `docs/UI-UX/08` § Dark Mode asks to be left possible — "all the tokens above have a paired dark variant whose structure is already planned in the design tokens (not hard-coded colors per component)" — so a dark theme becomes a second block of definitions with no component touched.

**Alternatives considered**

- **A JavaScript config object.** Rejected: two declarations, and the CSS half is the one that drifts because nothing type-checks it.
- **Plain CSS with hand-written classes, no Tailwind.** Tempting for a package, and rejected because `docs/FRONTEND/00` names Tailwind and because the arbitrary-value escape hatch (`bg-[#fff]`) is the exact thing `scripts/check-design-tokens.mjs` can grep for. A bespoke class system gives the guard nothing to look at.

**Consequences** — Every app imports one stylesheet. `admin` and `web-app` import `@wi/ui/tokens.css`; **`public-invite` deliberately does not** — it imports bare Tailwind, because an invitation's colours come from `template_versions.theme` and inheriting the dashboard's indigo would give every wedding the same palette.

`scripts/check-design-tokens.mjs` enforces the rule mechanically, with `tokens.css` itself exempt. A rule forbidding colours in the file whose job is declaring colours would be incoherent.

**Specification impact** — None.

---
### ADR-040 — `@wi/ui` is an ESM package, so `"use client"` survives compilation

**Date** 2026-09-11 · **Status** Accepted · **Task** `P0-22`

**Context** — Next.js's App Router renders on the server by default. A component holding state, using a ref, or receiving an event handler must declare `"use client"` as the **first statement** in its module.

Every other package in this repository emits CommonJS. `tsc` prepends `"use strict"` to a CommonJS module, which puts it in front of `"use client"`, and Next then does not see the directive at all. The symptom is a build error naming the app, not the library.

**Decision** — `packages/ui` sets `"type": "module"`. ESM output carries no `"use strict"` prologue, so the directive stays first.

Two further consequences were forced by the same rule and are worth recording:

1. **Only the interactive components carry the directive.** `Badge`, `Card`, `Skeleton`, `Avatar`, `Stepper` and `Spinner` render on the server; marking them would pull them into the client bundle for nothing.
2. **`InteractiveCard` and `buttonClassName` moved out of their original files.** Anything exported from a client module is unreachable from the server — *including a pure function*. The home page renders a `<Link>` styled as a button, and the build failed with "Attempted to call buttonClassName() from the server". The class recipe now lives in `button-class.ts` with no directive, and `InteractiveCard` in its own file so `Card` can stay on the server.

**Alternatives considered**

- **Ship source and let each app transpile it.** `transpilePackages` is configured anyway, but the package's imports use NodeNext `.js` specifiers, which bundlers do not rewrite to `.tsx`. It would have meant changing every import in the package to suit one consumer.
- **Put `"use client"` on the barrel.** It does not work: the directive applies per module, and the barrel re-exporting a server component does not make it one.

**Consequences** — `@wi/ui` is ESM while the backend packages are CommonJS. That is not an inconsistency to tidy up: the backend runs on Node and the UI package is consumed only by bundlers, and the two have different correct answers.

**Specification impact** — None.

---
### ADR-041 — The component workbench is a route in the app, not Storybook

**Date** 2026-09-11 · **Status** Accepted · **Task** `P0-22`

**Context** — `P0-22` step 8 asks for "a component workbench (Storybook or equivalent) with an axe check per story".

**Decision** — `frontend/web-app/src/app/workbench` renders every component in every state, each wrapped in a `<section data-story="...">`. `e2e/tests/workbench.e2e.ts` enumerates those sections from the DOM and runs axe against each one.

**Why not Storybook** — It is a second build, a second dev server, a second set of framework adapters, and a second place a component can be configured differently from how it ships. Its axe addon audits Storybook's rendering, not the application's.

A route inside the real app is compiled by the app's build, uses the app's stylesheet and the app's token values, and is audited by the E2E harness `P0-19` already built — **in a real browser**, which is the only environment where `color-contrast` can run at all. The jsdom pass in `@wi/ui` disables that rule because jsdom has no layout engine.

**Consequences** — This is not a free choice; it has a cost that the task's own findings demonstrate. The browser pass caught a contrast failure (`Dropzone`'s `opacity-60` blending to 4.49:1) that neither the jsdom axe pass nor the arithmetic token test could see, because neither renders pixels. Storybook would have caught it too. What it would not have caught is that the failure is in what the app actually ships.

The stories are read from the DOM rather than from a list, so adding a component to the workbench is what puts it under the browser audit — and nothing else does. That is the rule, and it is written at the top of both files.

**Specification impact** — None. `docs/UI-UX/17` § Testing asks for "axe-core/Lighthouse accessibility audit in CI for key pages"; this is that, for the component library.

---
### ADR-042 — The domain is `vizunicum.my.id`, not `zedth.my.id`

**Date** 2026-09-11 · **Status** Accepted · **Task** `P0-23` · **Supersedes** the hostname table in ADR-024 · **Deciders** Project owner

**Context** — ADR-024 fixed the publishing addresses on `zedth.my.id` and described `invitation.zedth.my.id` as "already in service". `P0-23` was blocked partly on DNS control; the project owner supplied a Cloudflare account token for **`vizunicum.my.id`** instead and confirmed it replaces the old domain entirely.

Verified rather than assumed:

| | |
|---|---|
| Zone | `vizunicum.my.id`, `active`, Free plan |
| Zone ID | `2fba520cb97a047fefdd89b3e710dd0a` |
| Nameservers | `ned.ns.cloudflare.com`, `raquel.ns.cloudflare.com` |
| Moved from | Rumahweb (`nsid1-4.rumahweb.*`), registrar PT Digital Registra Indonesia |
| Activated | 2026-09-10 |
| `app` / `invitation` / `admin` | **NXDOMAIN** — none of them exist |

That last row is why this is an ADR and not a find-and-replace. ADR-024 recorded one host as already serving traffic; on the new domain nothing is. `docs/PLAN/10` § Hostnames said "exists today" and was corrected in the same change.

**Decision** — Every hostname becomes `*.vizunicum.my.id`:

| Host | Serves | Added at |
|---|---|---|
| `invitation.vizunicum.my.id` | Public invitations at `/{slug}` | `P0-23` |
| `app.vizunicum.my.id` | The application and `/api/*` | `P0-23` |
| `admin.vizunicum.my.id` | The admin panel | `P5-01` |

**Nothing else about ADR-024 changes.** Path-based publishing, three fixed hosts, no wildcard DNS, no wildcard certificate, the public host serving only invitations, and the `slug_blocklist` collision defence all stand. This is a change of domain, not of address strategy — which is why ADR-024 keeps its status and gains a pointer rather than being rewritten.

**Alternatives considered**

- **Keep `zedth.my.id` for production and use `vizunicum.my.id` for staging only.** Put to the project owner as an explicit option and rejected: the whole domain moves.
- **Rewrite ADR-024 in place.** Rejected. `MEMORY/` is append-only, and an ADR edited to match the present erases the fact that the decision changed — which is the one thing a reader six months from now needs to see. The same reasoning kept `MEMORY/records/2026-09-09-pricing-and-publishing-address.md` untouched: it was accurate when written.

**Consequences** — 37 files changed outside `MEMORY/`: `docs/`, `TASKS/`, the two Next configs, the Helm values, the API's config tests and the api-client. `MEMORY/` was deliberately excluded and still says `zedth.my.id` in four places, all of them historical.

The domain is on Cloudflare's **Free** plan. That is fine for DNS, universal TLS and the tunnel; it does **not** include the WAF rule sets `docs/SECURITY/10` assumes for rate limiting at the edge. Not a blocker for staging — the API rate-limits itself (`P1-08`) — but production should not be planned around edge WAF rules that are not on this plan.

**Specification impact** — `docs/PLAN/10` § Hostnames amended: the domain named, the provenance recorded, and "exists today" corrected to `P0-23` because it is no longer true.

---
### ADR-043 — `APP_ENV` is the deployment environment; `NODE_ENV` stays the build mode

**Date** 2026-09-11 · **Status** Accepted · **Task** `P0-23`

**Context** — `docs/DEVOPS/00` § Environment List defines **four** environments: development, test, staging and production. `NODE_ENV` has **three** legal values and is read by Node, React and every bundler as a build mode.

The code used `NODE_ENV` for both, and deploying staging made the collision concrete:

- `docs/DEVOPS/00` § Parity requires staging to be "as close as possible to production … the difference should only be resource/data scale". That means a production **build**: `NODE_ENV=production`.
- `docs/DEVOPS/00` § Environment List requires staging to carry "realistic dummy data, periodically reset … from curated seed data", and § Configuration requires **sandbox** payment credentials.

With one variable those are contradictory. `backend/api/src/infra/db/seed.mts` refused to run because `NODE_ENV=production` — on the one deployed environment that is supposed to be seeded. Worse and quieter: `secret-rules.ts` asked `NODE_ENV === "production"` before deciding whether a **live Midtrans key** was acceptable, so a production build on staging would have accepted one. That is the single check that file exists for.

The test suite had already noticed. `backend/api/test/secret-rules.spec.ts` passed `NODE_ENV: "staging"` in four places — a value `NODE_ENV` never allowed — because "staging" was what the assertions meant.

**Decision** — Two axes.

| | Values | Read by | Answers |
|---|---|---|---|
| `NODE_ENV` | development, test, production | Node, React, bundlers | How was this built? |
| `APP_ENV` | development, test, staging, production | This application | Which deployment is this? |

`APP_ENV` defaults to `NODE_ENV` when unset, so development and test need no new variable and behave exactly as before. A deployed environment sets it explicitly; staging runs `NODE_ENV=production APP_ENV=staging`.

Every environment decision in the application now reads `APP_ENV`: the live/sandbox payment key rules, the production-only origin and signing-key checks, the localhost-database check, and the seed guard.

**Alternatives considered**

- **Add `staging` to `NODE_ENV`.** Rejected: it is not ours to extend. React's development build ships with different code, bundlers branch on it, and a value they do not recognise sends them down the development path — which would put a development React build on staging and break parity in the one direction the document forbids.
- **Key the seed on the database host instead.** The seed already has that check (`looksRemote`), and it is not enough: it passes for any compose stack, including a production one.
- **Leave it and seed staging with `NODE_ENV=development` for one command.** What I nearly did. Rejected: it bypasses a guard rather than fixing the model, and it leaves the live-payment-key hole open, which is the serious half.

**Consequences** — `.env.example` and `deploy/staging.env.example` gain `APP_ENV`. Five new tests pin the behaviour, including "refuses a live payment key on staging", which fails against the old code.

The four `NODE_ENV: "staging"` lines in `secret-rules.spec.ts` became `APP_ENV: "staging"` and are now legal values rather than a value the schema would have rejected had the test ever gone through it.

**Specification impact** — None. `docs/DEVOPS/00` already described four environments; the code now has a way to say which one it is.

---
### ADR-044 — The breached-password check fails open, loudly

**Date** 2026-09-11 · **Status** Accepted · **Task** `P1-01`

**Context** — `docs/SECURITY/03` § Password recommends checking a new password "against a list of common/breached passwords (e.g., via the haveibeenpwned k-anonymity API)". It does not say what to do when that API cannot be reached, and `P1-01` step 4 requires the answer to be decided and recorded rather than defaulted into.

The check sits on the registration path and on password change. Both are moments a user is actively waiting.

**Decision** — **Fail open, and emit a security event every time.**

An unreachable API, a timeout, a non-200, or a body that does not parse all produce `{ status: "unavailable" }`, the password is accepted on the strength of the remaining rules, and `logSecurityEvent("auth.breach_check_unavailable", …)` fires at `warn`.

`checkBreached` reports `unavailable` as a **distinct value** from `safe`. That is the load-bearing part: folding them together would make the caller unable to tell a clean bill of health from a control that is switched off, and the fail-open decision would become unobservable by construction.

**Alternatives considered**

- **Fail closed.** Rejected. It blocks a couple from registering during a third party's outage, for a control the specification itself calls *recommended* — while the controls it makes mandatory (minimum length, and `P1-07`'s five-attempts-per-fifteen-minutes) keep working. A wedding invitation is bought once, often late at night, often on a phone; "try again later" is a lost customer for a reason they will never understand.
- **Fail open silently.** The default if nobody thinks about it, and the reason this is an ADR. A control that can be down for a month without anyone knowing is not a control.
- **Queue the check and validate asynchronously.** Rejected: by then the password is stored, and the only remaining action is emailing the user to say their password is bad — which is worse for them than a rejection at the moment they chose it.

**Consequences** — During an HIBP outage, weak-but-long passwords that are not the user's own name will be accepted. That is the accepted cost, bounded by the other rules.

The security event is the compensating control and it is only as good as whoever watches it. `docs/DEVOPS/07` § Alerting has no rule for it yet; `P0-17`/`P6` should add one, because a warn-level line nobody alerts on is the silent failure this ADR exists to avoid, one step removed.

The check is deliberately **not** run at login. Holding a plaintext password against a third-party call on the hottest auth path buys nothing: the account already exists, and the only available action is one the user did not ask for.

**Specification impact** — None. `docs/SECURITY/03` left this open; it is now decided.

---
### ADR-045 — argon2id at 64 MiB, t=3, p=1, measured on the deployment host

**Date** 2026-09-11 · **Status** Accepted · **Task** `P1-01`

**Context** — `docs/SECURITY/03` § Password requires argon2id (or bcrypt ≥ 12) but names no parameters. `P1-01` step 2 asks for them to be "measured on hardware resembling the deployment target rather than copying values from a blog post".

The deployment target exists as of `P0-23`, so this was measured on it rather than on something resembling it: Ubuntu 24.04, 4 cores, 15 GiB, inside `node:24-alpine` with `--cpus 4`. Median of five hashes after a warm-up:

| memory | t | p | median |
|---|---|---|---|
| 32 MiB | 2 | 1 | 94 ms |
| 32 MiB | 3 | 1 | 126 ms |
| 64 MiB | 2 | 1 | 195 ms |
| **64 MiB** | **3** | **1** | **277 ms** |
| 64 MiB | 3 | 2 | 162 ms |
| 64 MiB | 4 | 1 | 359 ms |
| 128 MiB | 3 | 1 | 580 ms |

**Decision** — `memoryCost: 65536` (64 MiB), `timeCost: 3`, `parallelism: 1`, argon2id.

**Over three times OWASP's floor on the dimension that matters.** The current OWASP minimum for argon2id is m=19 MiB, t=2, p=1. Memory is what makes argon2 expensive to attack on a GPU, so it is where the budget goes.

**277 ms is affordable *here*.** A wedding invitation service sees logins per minute, not per second — a couple signs in, edits, and leaves. With `P1-07`'s rate limiting the sustained hash rate an attacker can force is negligible. On a service with a morning login storm this would be the wrong number, which is why the measurement and the reasoning are recorded together rather than just the values.

**p=1 although p=2 is faster.** 64 MiB/t=3/p=2 is 162 ms, but parallelism spends *cores per hash*, and this host has four shared with eight other compose projects. One core per login is predictable; two makes concurrent logins contend with everything else on the box. Latency is not the binding constraint.

**Alternatives considered**

- **128 MiB.** 580 ms, and 128 MiB of resident memory per concurrent login on a shared 15 GiB host. The memory pressure is the real objection, not the latency.
- **bcrypt cost 12**, the documented fallback. Rejected: it has no memory-hardness parameter at all, which is the property being bought here.
- **Copy OWASP's numbers unmeasured.** They would have been *lower* than these, and nobody would have known whether the host could afford more.

**Consequences** — Raising these later does not rehash what already exists. `needsRehash` is implemented and exported for that, and `P1-03` is the only place it can be used — the sole moment a plaintext password and a stored hash are both in hand. That obligation is written into `password.service.ts` beside the function rather than left to be rediscovered.

The encoded hash is 97 characters, verified against the `varchar(255)` column in `docs/DATABASE/02` by a test rather than by arithmetic.

If production ever runs on materially different hardware, re-measure. These numbers are a property of that host, not of the algorithm.

**Specification impact** — None. `docs/SECURITY/03` names the algorithm and leaves the parameters to implementation.

---

### ADR-046 — `jose` for JWT, statically imported from a CommonJS build

**Date** 2026-09-12 · **Status** Accepted · **Task** `P1-03`

**Context** — `docs/SECURITY/03` § Tokens requires an HS256/RS256 access token. The stack table names no JWT library, so this was open.

The candidates were `jsonwebtoken`, `jose`, and roughly sixty lines of `node:crypto`.

**Decision** — `jose@6`.

**Why not `jsonwebtoken`** — the entire JWT vulnerability class is algorithm confusion, and `jsonwebtoken` is safe only when every call site passes `algorithms: ["HS256"]`. Omitting it is not a compile error, not a runtime error, and not visible in a passing test suite; it is visible only when someone presents an `alg: none` token. `jose` requires the algorithm list as an argument.

**Why not hand-rolled** — the primitive would have come from `node:crypto` and the encoding is base64url, so nothing would have been invented. But a reviewer cannot tell a correct hand-rolled verifier from a subtly wrong one by reading it, and the value of "one call site, obviously pinned" is not worth the value of "a library thousands of people audit".

**The awkward part, and why it is fine** — `jose@6` is ESM-only; `@wi/api` compiles to CommonJS under `module: NodeNext`. TypeScript 7 permits the static import, and Node 24 resolves it through `require(esm)`. **That was verified against the built `dist/` output, not just under Vitest**, because Vitest loads ESM natively and would have been green for a failure that only appears in production — which is exactly how `P0-19.1`'s `import.meta` bug reached a running container.

The risk this carries: a future change that gives `jose` a top-level `await` in its entry point would break `require(esm)` and the failure would be at startup, in the image, not in CI. Pinned major, and `P0-19`'s E2E suite exercises the built image.

### ADR-047 — `JWT_SIGNING_KEY` and `REFRESH_TOKEN_PEPPER` are required, at 32 characters, in every environment

**Date** 2026-09-12 · **Status** Accepted · **Task** `P1-03`

**Context** — both were optional in `env.schema.ts` because nothing used them, and `checkSecretRules` enforced a 32-character minimum **in production only**, on the reasoning that "a developer should not need a 32-character key to run the stack locally".

**Decision** — required, `min(32)`, in the schema, in all four environments. The production-only length rule is deleted.

**Why the development exemption was wrong** — a short HMAC key is brute-forceable offline from a single captured token wherever it runs. More practically: a development environment that tolerates a short key is where a short key comes from. The value gets copied to staging, and staging's is copied to production by someone in a hurry, and the one place it is checked is the one place nobody pastes by hand.

**What replaces it** — a rule the schema genuinely cannot express, because it depends on `APP_ENV`: in production, neither value may still be the placeholder from `.env.example`. That value is long, valid, and published on the internet, so it passes every per-field check while being shared by every deployment that copied the file.

**Cost** — staging has neither variable and will refuse to boot (exit 78, naming both) until they are generated on the host. That is the intended behaviour and is recorded as a deployment follow-up on `P1-03`, not as a surprise.

### ADR-048 — The refresh token is hashed with a pepper; the single-use tokens are not

**Date** 2026-09-12 · **Status** Accepted · **Task** `P1-03`

**Context** — `P1-02` stores email-verification tokens as a plain SHA-256. `docs/SECURITY/03` says refresh tokens are "stored **hashed** (not plaintext)" and says nothing about a pepper — but `REFRESH_TOKEN_PEPPER` has been in the environment schema since `P0-18`, reserved for this.

**Decision** — `refresh_tokens.token_hash` is `HMAC-SHA256(REFRESH_TOKEN_PEPPER, token)`. `user_tokens.token_hash` stays a bare SHA-256.

**Why they differ** — a verification token lives 24 hours and its worst case is that somebody confirms an address that was already theirs. A refresh token *is* the session: thirty days, accepted without a password, and a leak of the table is simultaneous account takeover for every logged-in user. The pepper lives in the environment rather than the database, so a dump alone — a backup on the wrong bucket, a read replica, a SQL injection — does not yield working credentials. It costs one HMAC.

**What it costs** — the pepper cannot be rotated without ending every session. That is recorded in `deploy/SECRETS.md`, and it is why the variable is required rather than defaulted: a missing pepper silently degrading to an unpeppered hash would be the worst of both.

