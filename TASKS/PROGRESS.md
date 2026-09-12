# Progress Board

Single source of truth for where the project stands. Updated in the same commit as the work it describes (`00-TASK-CONVENTIONS.md` global DoD item 11).

**Last updated**: 2026-09-10
**Current phase**: Phase 0 — Foundation (26 / 27 done). **Staging is live**: `https://app.vizunicum.my.id` and `https://invitation.vizunicum.my.id/{slug}`, served from the VM at `10.1.200.13` through a Cloudflare Tunnel — the host has a private address and no inbound port.

The only task left is `P0-17` (CI/CD), deferred by ADR-028. Its **deployment** half was waived by the project owner on 2026-09-11; deploying is `git pull` plus a compose command. Its **verification** half was not waived and is the one Phase 0 exit criterion still unmet — see below. **The database schema is complete** — 28 tables across `P0-06`..`P0-10`, 123 constraint tests. The API runs, validates its configuration and serves the three surfaces, and the local stack comes up with one command. the critical path through `P0-11` is complete; `P0-12`, `P0-13`, `P0-18`, `P0-19` and `P0-22` are all unblocked and can run in parallel.
**Overall**: 39 / 136 tasks done

**No automated pipeline**: `P0-17` is deferred (ADR-028). Before merging to `main`, run `scripts/verify.sh`. The `:id`-endpoint gate blocks in `.githooks/pre-push`; integration tests, the coverage floor, SAST and dependency scanning are **not** running anywhere until `P0-17` is picked up — revisit before Phase 3 payment code.

**Specification status**: all 17 gaps resolved and `docs/` amended (ADR-018 through ADR-022). Pricing, the publishing address and the gift account data question are decided (ADR-023 through ADR-025). **No task on this board is blocked** — five open questions remain in [`BACKLOG.md`](./BACKLOG.md) and all of them shape work rather than stopping it.

**Product decisions now fixed**: one package at **Rp 139,000 for 12 months**, free tier of **one draft**; invitations published at **`invitation.vizunicum.my.id/{slug}`** (path-based, no wildcard DNS), with per-invitation subdomains deferred to `P7-01`.

Status values: `TODO` · `BLOCKED` · `SPEC` · `WIP` · `REVIEW` · `DONE` · `DROPPED`
Sizes: `S` under half a day · `M` one to two days · `L` several days · `XL` must be split

---

## Phase Summary

| Phase | Tasks | Done | Status | Gate to enter |
|---|---|---|---|---|
| [Phase 0 — Foundation](./PHASE-0-FOUNDATION.md) | 27 | 26 | **ACTIVE** | — |
| [Phase 1 — Auth and Invitation Core](./PHASE-1-AUTH-AND-INVITATION-CORE.md) | 25 | 13 | **ACTIVE** | Phase 0 exit criteria |
| [Phase 2 — Template Rendering and Preview](./PHASE-2-TEMPLATE-RENDERING-AND-PREVIEW.md) | 14 | 0 | Not started | Phase 1 exit + `P1-25` |
| [Phase 3 — Order, Payment and Publishing](./PHASE-3-ORDER-PAYMENT-PUBLISHING.md) | 16 | 0 | Not started | Phase 2 exit |
| [Phase 4 — Engagement](./PHASE-4-ENGAGEMENT.md) | 12 | 0 | Not started | Phase 3 exit |
| [Phase 5 — Admin Panel](./PHASE-5-ADMIN-PANEL.md) | 14 | 0 | Not started | Phase 4 exit |
| [Phase 6 — Hardening and Launch](./PHASE-6-HARDENING-AND-LAUNCH.md) | 17 | 0 | Not started | Phase 5 exit |
| [Phase 7 — Post-Launch](./PHASE-7-POST-LAUNCH.md) | 11 | 0 | Not started | MVP launched, `P6-17` signed off |

> **The phase rule** (`docs/PLAN/16-IMPLEMENTATION-ROADMAP.md`, `TASKS/README.md`): never build a Phase N+1 feature while Phase N is incomplete. The two deliberate exceptions — the reference template and the frontend foundation both landing in Phase 0 — are encoded as `P0-21` and `P0-22`, and nowhere else.
>
> **Two hard dependencies** from `docs/PLAN/16` § Critical Dependencies, both encoded as task dependencies rather than left to memory: the template system (`P0-20`, `P0-21`) is finalized before editor work (`P1-22`, `P1-23`); the payment security review (`P3-16`) happens before payment code reaches production.

---

## Phase 0 — Foundation

Roadmap: Week 1-2. Exit criteria in the phase file.

| ID | Task | Surface | Size | Status | Depends on |
|---|---|---|---|---|---|
| P0-01 | Confirm and freeze the tech stack | docs | S | **DONE** — ADR-004…ADR-017 | — |
| P0-02 | Initialize the monorepo structure | infra | S | **DONE** | P0-01 |
| P0-03 | Git conventions, PR template, CODEOWNERS | infra | S | **DONE** — branch protection still to enable in GitHub settings | P0-02 |
| P0-04 | Backend service skeleton | backend | M | **DONE** | P0-02 |
| P0-05 | Local environment via Docker Compose | infra | M | **DONE** | P0-04 |
| P0-06 | Migration tooling and baseline migration | backend | S | **DONE** | P0-05 |
| P0-07 | Schema 1/4 — users and auth tables | backend | M | **DONE** — 6 tables; ADR-031 resolved a spec contradiction | P0-06 |
| P0-08 | Schema 2/4 — templates, versions, media | backend | M | **DONE** — `media.invitation_id` FK deferred to `P0-09` (ADR-032) | P0-07 |
| P0-09 | Schema 3/4 — invitations and children | backend | L | **DONE** — 13 tables; ADR-033 resolved a second UNIQUE/soft-delete contradiction | P0-08 |
| P0-10 | Schema 4/4 — orders, payments, audit logs | backend | M | **DONE** — `audit_logs` append-only by permission; webhook idempotency index in place | P0-09 |
| P0-11 | Tenant-scoped repository layer | backend | L | **DONE** — branded scope, guard blocking on push, 4 mutation checks | P0-09 |
| P0-12 | Structured logging with redaction | backend | M | **DONE** — redaction in the logger, request id ambient via AsyncLocalStorage | P0-04 |
| P0-13 | Response envelope, errors, health | backend | M | **DONE** — allowlist error mapper; readiness separate from liveness | P0-04 |
| P0-14 | Audit log and status history writers | backend | M | **DONE** — status writable only through the service, guard blocking on push | P0-10, P0-12 |
| P0-15 | Queue and worker skeleton | worker | M | **DONE** — atomic idempotency, DLQ, cron leader election | P0-05, P0-12 |
| P0-16 | Object storage abstraction | backend | M | **DONE** — `@wi/storage`; branded keys; buckets private, verified 403 | P0-05 |
| P0-17 | CI pipeline | infra | M | **DEFERRED** — ADR-028; gates moved to `scripts/verify.sh` + pre-push hook | P0-04 |
| P0-18 | Secrets and configuration conventions | infra | S | **DONE** — the service refuses to boot on a mixed-environment configuration | P0-04 |
| P0-19 | Test harness | backend, web-app | M | **DONE** — four layers; found a container startup crash and a stale-image bug | P0-05 |
| P0-19.1 | Shared logging package | backend, packages | S | **DONE** — the worker redacts at last; a guard now refuses a `pino()` call outside `@wi/logging` | P0-12, P0-15, P0-19 |
| P0-20 | Template schema definition and validator | backend, web-app | L | **DONE** — 39 canonical field paths, a closed component registry, and one resolver both surfaces share | P0-08 |
| P0-21 | Reference template and demo seed data | backend, web-app | L | **DONE** — one template as JSON, and a demo invitation proven publishable against it | P0-20 |
| P0-22 | Frontend skeletons and design system | frontend | L | **DONE** — three apps, 13 components, and a browser axe pass that found a contrast bug the unit tests could not | P0-02 |
| P0-23 | Staging, hosts and TLS | infra | L | **DONE** — live at `app.` and `invitation.vizunicum.my.id` over HTTPS through a Cloudflare Tunnel; automated deploy waived by the project owner 2026-09-11 | P0-04 |
| P0-24 | Adopt the TASKS/MEMORY discipline | docs | S | **DONE** | — |
| P0-25 | Separate surfaces into backend/frontend/admin | infra | S | **DONE** | P0-02 |
| P0-26 | Helm charts for the Kubernetes path | infra | M | **DONE** — K8s schema validation deferred to `P0-23`, no cluster reachable | P0-05 |

**Critical path**: `P0-02` → `P0-04` → `P0-05` → `P0-06` → `P0-07`…`P0-11` — **all done**. `P0-11` got the extra review attention the board asked for: four mutation checks, two-user fixtures throughout, and a build guard that blocks direct table access.

**Parallel tracks** once `P0-02` lands: backend schema (`P0-04`…`P0-11`), platform (`P0-17`, `P0-18`, `P0-23`), frontend (`P0-22`), template (`P0-20`, `P0-21` — needs only `P0-08`).

---

## Phase 1 — Auth and Invitation Core

Roadmap: Week 3-5.

| ID | Task | Surface | Size | Status | Depends on |
|---|---|---|---|---|---|
| P1-01 | Password hashing and policy | backend | M | **DONE** — argon2id measured on the deploy host; the breach check fails open and says so | P0-07, P0-19 |
| P1-02 | Registration and email verification | backend | M | **DONE** — uniform response for a duplicate address; DoD item 3 half-met, the rest owed by P3-01 and P3-06 | P1-01, P0-15 |
| P1-03 | Login, access tokens, refresh rotation | backend | L | **DONE** — reuse of a spent refresh token revokes every session; role and status re-read from the database on every request | P1-01 |
| P1-04 | Google OAuth | backend | M | **DONE** — the body has no email to trust; an unverified Google address cannot claim an account. Answers OQ-15 (migration 0005) | P1-03 |
| P1-05 | Forgot and reset password | backend | M | **DONE** — every session dies in the same transaction as the password write; step 4 (rate limit) owed by P1-07 | P1-03, P0-15 |
| P1-06 | Auth, role and ownership middleware | backend | L | **DONE** — `requireOwnership` is a service-layer function, not a guard; the reusable IDOR helper has three tests that pass only when an assertion fails | P1-03, P0-11 |
| P1-07 | Rate limiting | backend | M | **DONE** — sliding window in Redis; fail closed on credential endpoints, open elsewhere (ADR-050); tunable from Redis with no deploy | P1-03 |
| P1-08 | User profile and account deletion | backend | M | **DONE** — no route has a parameter and no service method takes a user id; ADR-051 answers OQ-11 | P1-06 |
| P1-09 | Create an invitation | backend | M | **DONE** — five-row aggregate in one transaction; BR-3.1 locks a concrete version; the free-draft quota counts never-paid, not drafts | P1-06, P0-20 |
| P1-10 | Invitation list, detail, update, delete | backend | L | **DONE** — owner filter in SQL, explicit DTOs, first real use of `expectIdorSafe` | P1-09 |
| P1-11 | Couple sub-resource | backend | M | **DONE** — `photo_media_id` is a second tenancy boundary; a photo from another invitation of the *same* user is also refused | P1-10 |
| P1-12 | Events sub-resource | backend | M | **DONE** — `:event_id` scoped by `:id` in one query; five repository-level tests added because a mutation showed the two layers were masking each other | P1-10 |
| P1-13 | Bank accounts and quote | backend | M | TODO | P1-10 |
| P1-14 | Settings and slug rules | backend | M | TODO | P1-10 |
| P1-15 | Change template without data loss | backend | M | TODO | P1-10, P0-20 |
| P1-16 | Free-text sanitization pipeline | backend | M | **DONE** — built early: `P1-11`–`P1-15` all have it as a DoD item. A build guard refuses an unregistered text field | P0-13 |
| P1-17 | Media upload — sync validation | backend | L | TODO | P1-10, P0-16 |
| P1-18 | Media processing worker | worker | L | TODO | P1-17, P0-15 |
| P1-19 | Gallery, reorder, cover, quota | backend | M | TODO | P1-18 |
| P1-20 | Frontend — auth screens | web-app | M | TODO | P0-22, P1-03 |
| P1-21 | Frontend — dashboard and wizard | web-app | L | TODO | P1-20, P1-09 |
| P1-22 | Frontend — editor shell and autosave | web-app | L | TODO | P1-21, P1-10 |
| P1-23 | Frontend — schema-driven properties panel | web-app | L | TODO | P1-22, P0-20 |
| P1-24 | Frontend — media manager and map picker | web-app | L | TODO | P1-23, P1-19 |
| P1-25 | Phase 1 test suite and acceptance | all | L | TODO | all above |

**Critical path**: `P1-03` → `P1-06` → `P1-09` → `P1-10` → the sub-resources and the editor.

---

## Phase 2 — Template Rendering and Preview

Roadmap: Week 6-7.

| ID | Task | Surface | Size | Status | Depends on |
|---|---|---|---|---|---|
| P2-01 | Template catalog API | backend | M | TODO | P0-20, P1-06 |
| P2-02 | Generic renderer core | frontend | L | TODO | P0-20, P0-21 |
| P2-03 | Section component library v1 | frontend | L | TODO | P2-02 |
| P2-04 | Per-section error boundaries | frontend | M | TODO | P2-03 |
| P2-05 | Live preview in the editor | web-app | M | TODO | P2-03, P1-22 |
| P2-06 | Publish-check and editor checklist | backend, web-app | M | TODO | P0-20, P1-14 |
| P2-07 | Public invitation API | backend | L | TODO | P1-14, P2-01 |
| P2-08 | Public SSR app and host routing | public-invite | L | TODO | P2-07, P2-03, P0-23 |
| P2-09 | SEO metadata and robots | public-invite | M | TODO | P2-08 |
| P2-10 | Public page interactions | public-invite | M | TODO | P2-08 |
| P2-11 | Catalog and detail UI, demo mode | web-app | L | TODO | P2-01, P2-03 |
| P2-12 | Share-preview links | backend, public-invite | M | TODO | P2-08 |
| P2-13 | Performance budget and CWV baseline | public-invite | M | TODO | P2-10 |
| P2-14 | Phase 2 test suite and acceptance | all | M | TODO | all above |

**Critical path**: `P2-02` → `P2-03` → everything. The renderer is the phase.

---

## Phase 3 — Order, Payment and Publishing

Roadmap: Week 8-9. **Entry needs `OQ-02` and `OQ-05` answered.**

| ID | Task | Surface | Size | Status | Depends on |
|---|---|---|---|---|---|
| P3-01 | Packages, addons, pricing service | backend | M | TODO — Rp 139,000 / 12 months (ADR-023) | P0-10 |
| P3-02 | Order creation | backend | L | TODO | P3-01, P1-06 |
| P3-03 | Payment gateway port and adapter | backend | L | TODO — Midtrans (ADR-012) | P3-02, P0-18 |
| P3-04 | Payment initiation | backend | M | TODO | P3-03 |
| P3-05 | Payment webhook | backend | L | TODO | P3-04, P0-14 |
| P3-06 | Status polling and reconciliation | backend | M | TODO | P3-05 |
| P3-07 | Order expiry and late payment | worker | M | TODO | P3-05, P0-15 |
| P3-08 | Invoice and order history | backend | M | TODO | P3-05 |
| P3-09 | Publish endpoint | backend | L | TODO | P2-06, P3-05 |
| P3-10 | Unpublish, republish, slug change | backend | M | TODO | P3-09 |
| P3-11 | Production subdomain routing and TLS | infra | M | TODO | P3-09, P0-23 |
| P3-12 | Public page caching and invalidation | backend, infra | L | TODO | P3-09, P2-08 |
| P3-13 | Invitation expiry job and renewal | worker, backend | L | TODO | P3-09, P3-07 |
| P3-14 | Frontend — checkout and payment status | web-app | L | TODO | P3-04, P0-22 |
| P3-15 | Frontend — publish flow and share | web-app | M | TODO | P3-09, P2-06 |
| P3-16 | Payment security review and acceptance | all | L | TODO | all above |

**Critical path**: `P3-01` → `P3-02` → `P3-03` → `P3-05` → `P3-09`. `P3-05` is the most security-critical task in the project; `P3-16` gates production.

---

## Phase 4 — Engagement

Roadmap: Week 10-11.

| ID | Task | Surface | Size | Status | Depends on |
|---|---|---|---|---|---|
| P4-01 | Public RSVP submission | backend | M | TODO | P2-07, P1-07 |
| P4-02 | Owner RSVP management and export | backend | M | TODO | P4-01 |
| P4-03 | Public guestbook | backend | M | TODO | P2-07, P1-07 |
| P4-04 | Owner guestbook moderation | backend | M | TODO | P4-03 |
| P4-05 | Abuse controls and adaptive CAPTCHA | backend | M | TODO — Turnstile (ADR-011); threshold `OQ-14` | P4-01, P4-03 |
| P4-06 | Notification module and email port | backend, worker | L | TODO — Resend (ADR-013) | P0-15 |
| P4-07 | Transactional email wiring | worker | L | TODO | P4-06 |
| P4-08 | Preferences and delivery monitoring | backend, worker | M | TODO | P4-07 |
| P4-09 | Page view counter | backend, worker | M | TODO | P2-07, P0-15 |
| P4-10 | Owner analytics summary | backend, web-app | M | TODO | P4-09, P4-02 |
| P4-11 | Frontend — engagement screens | frontend | L | TODO | P4-02, P4-04 |
| P4-12 | Phase 4 test suite and acceptance | all | M | TODO | all above |

---

## Phase 5 — Admin Panel

Roadmap: Week 12-13.

| ID | Task | Surface | Size | Status | Depends on |
|---|---|---|---|---|---|
| P5-01 | Admin shell and session isolation | admin, infra | M | TODO | P0-22, P0-23 |
| P5-02 | Admin 2FA and step-up re-auth | backend, admin | L | TODO | P1-03, P5-01 |
| P5-03 | Admin authorization and audit middleware | backend | M | TODO | P0-14, P1-06 |
| P5-04 | Template and version management API | backend | L | TODO | P0-20, P5-03 |
| P5-05 | Template editor UI and preview | admin | L | TODO | P5-04, P2-03 |
| P5-06 | User management | backend, admin | M | TODO | P5-03 |
| P5-07 | Order and payment management | backend, admin | M | TODO | P5-03, P3-05 |
| P5-08 | Manual refund | backend, admin | M | TODO — target status decided (ADR-019) | P5-07 |
| P5-09 | Moderation queue | backend, admin | M | TODO | P5-03, P4-04 |
| P5-10 | Invitation overview, read-only | backend, admin | M | TODO | P5-03 |
| P5-11 | Dashboard metrics | backend, admin | M | TODO | P5-03 |
| P5-12 | Audit log viewer | backend, admin | M | TODO | P5-03 |
| P5-13 | Slug blocklist management | backend, admin | M | TODO | P5-03, P1-09 |
| P5-14 | Phase 5 test suite and acceptance | all | M | TODO | all above |

**Note**: `PG-14` (the refund status contradiction) is resolved — a refund returns the invitation to `draft` (ADR-019), and all four affected documents are amended. `P5-08` is unblocked.

---

## Phase 6 — Hardening and Launch

Roadmap: Week 14-15. Every task here is release-relevant; `P6-01`, `P6-02`, `P6-03`, `P6-07` and `P6-12` are release blockers.

| ID | Task | Surface | Size | Status | Depends on |
|---|---|---|---|---|---|
| P6-01 | Full IDOR and multi-tenancy sweep | backend | L | TODO | Phases 1-5 |
| P6-02 | Payment tampering suite | backend | M | TODO | P3-16 |
| P6-03 | File upload attack suite | backend, worker | M | TODO | P1-18 |
| P6-04 | Injection, XSS, mass-assignment sweep | backend | M | TODO | P1-16 |
| P6-05 | Auth and session abuse suite | backend | M | TODO | P1-03, P5-02 |
| P6-06 | SAST, DAST, dependency policy | infra | M | TODO | P0-17 |
| P6-07 | External penetration test | all | L | TODO | P6-01…P6-06 |
| P6-08 | Load and performance testing | infra, backend | L | TODO | P3-12 |
| P6-09 | Cache tuning and hit-ratio validation | backend, infra | M | TODO | P6-08 |
| P6-10 | Monitoring dashboards and alerts | infra | L | TODO | P0-12, P3-05 |
| P6-11 | Logging and retention audit | backend, infra | M | TODO | P0-12 |
| P6-12 | Backup verification and DR drill | infra | L | TODO | P0-23 |
| P6-13 | Rollback drill and feature flags | infra | M | TODO | P0-17 |
| P6-14 | Cross-browser and device matrix | frontend | M | TODO | Phases 2-4 |
| P6-15 | Accessibility audit | frontend | L | TODO | Phases 2-5 |
| P6-16 | Privacy, legal pages, incident readiness | docs, web-app | M | TODO | — |
| P6-17 | UAT and release gate sign-off | all | L | TODO | all above |

**Note**: `P6-16` has no dependencies and should start early in the phase — writing a privacy policy does not need the pentest to finish, and the tabletop exercise is more useful before the release scramble than during it.

---

## Phase 7 — Post-Launch

Not scheduled. Sequenced by real usage data rather than by the order below.

| ID | Task | Surface | Size | Status | Depends on |
|---|---|---|---|---|---|
| P7-01 | Custom domain support | backend, infra | L | TODO | P3-11 |
| P7-02 | Advanced analytics | backend, web-app | L | TODO | P4-09 |
| P7-03 | WhatsApp notifications | backend, worker | L | TODO | P4-06 |
| P7-04 | In-app notifications | backend, web-app | M | TODO | P4-06 |
| P7-05 | Template marketplace | backend, admin | XL | TODO | P5-04 |
| P7-06 | Multi-language invitations | backend, public-invite | L | TODO | P2-02 |
| P7-07 | Organizer features and Pro plan | backend, web-app | L | TODO | P1-21 |
| P7-08 | Presigned upload migration | backend | M | TODO | P1-17 |
| P7-09 | Read replica and scaling | infra | L | TODO | P6-08 |
| P7-10 | Data export and portability | backend | M | TODO | P1-08 |
| P7-11 | Fine-grained admin permissions | backend, admin | M | TODO | P5-03 |

**`P7-05` is `XL`** and must be split before it enters `WIP`, per `00-TASK-CONVENTIONS.md`.

---

## Blocked Tasks

**None.** Every task on this board can start once its dependencies are `DONE`.

The blockers cleared in sequence on 2026-09-09: the stack decision (ADR-004 through ADR-017) answered `OQ-01`, `OQ-02`, `OQ-03`, `OQ-04`, `OQ-06` and `OQ-09`; the specification amendments (ADR-018 through ADR-022) closed `PG-14`; pricing (ADR-023) cleared `P3-01`; and the publishing address (ADR-024) cleared `P0-23`.

Six open questions remain and none of them stops work. Three were answered during Phase 1 and are listed below them, because "answered" here means *decided and recorded*, not *confirmed by whoever owns the call*:

| Question | Affects | Why it still matters |
|---|---|---|
| `OQ-12` | Every phase | Team size. `docs/PLAN/16`'s 15 weeks only hold if the parallel tracks are actually staffed |
| `OQ-13` | `P2-03`, `P2-12` | What the preview watermark looks like, and whether published invitations carry a credit link |
| `OQ-14` | `P4-05` | The traffic threshold that turns the CAPTCHA on. Best set from observed traffic, but needs an initial value |
| `OQ-17` – `OQ-20` | `P0-20`, `P1-17`, Phase 2 | Schema and vocabulary questions, each decided provisionally with an ADR |
| **`OQ-21`** | `P1-03` | **Should refresh rotation have a grace window?** Two legitimate concurrent refreshes are indistinguishable from theft and log the user out everywhere. Implemented strictly as `docs/SECURITY/03` states; a grace window weakens a control the document states without qualification |
| **`OQ-22`** | `P1-07` | **Is the (email, IP) login key right against a distributed attacker?** It gives a botnet a fresh budget per IP. The obvious fix lets a stranger lock a victim out of their own account |

Answered during Phase 1, each needing confirmation rather than further work:

| Question | Answer | Who should confirm |
|---|---|---|
| ~~`OQ-11`~~ | **ADR-051** — deleting an account does not take its published invitations down; they serve until their own expiry | Legal, before launch |
| ~~`OQ-15`~~ | **ADR-049** — a Google identity is unique across active accounts (migration `0005`) | Nobody; forced by `P1-04`'s matching order |

---

## Business Rule Changes — After the Plan Was Written

| Date | Rule | Change | Recorded |
|---|---|---|---|
| 2026-09-12 | BR-1.4, **new** BR-2.8 | **The free tier may publish, once, for three days.** ADR-023 set the free tier at one unpaid draft and said nothing about publishing; the project owner settled it, choosing the strictest of three options. After three days the invitation expires and stops being served. No new status and no new column: a `needs_upgrade` flag beside `published` would give the renderer two fields to consult before deciding a page is visible. | ADR-052, `docs/PLAN/02`, `docs/PLAN/09`, `P3-09`, `P3-10` |

Nothing built so far needed changing. `P1-09`'s quota already counts invitations that never reached `paid`, and a trial publish does not reach `paid` — so a user who trials and lets it lapse still holds their one free invitation and cannot start a second.

---

## Specification Amendments — Completed

All 17 gaps are resolved and every owed amendment has been made (2026-09-09, ADR-018 through ADR-022). `docs/` now describes the system the plan builds, so no task starts by having to decide something two documents disagreed about.

| Amended | Change |
|---|---|
| `docs/API/00` | 403 versus 404 rule, with the reasoning |
| `docs/API/04` | Owner-side RSVP and guestbook endpoints, version upgrade, preview link list/revoke |
| `docs/API/05` | `GET /media/:media_id`, 404 correction |
| `docs/API/06` | Who transitions the invitation to `pending_payment` |
| `docs/API/08` | `display.watermark`, preview token route, guest report endpoint |
| `docs/API/09` | Owner versus platform moderation boundary |
| `docs/ARCHITECTURE/04` | Table list corrected; three phantom tables removed |
| `docs/BACKEND/05`, `docs/BACKEND/09` | Refund returns the invitation to `draft` |
| `docs/DATABASE/00`, `01` | Table groups and ERD updated for five new tables |
| `docs/DATABASE/02` | `user_tokens`, `user_mfa_factors`, `user_recovery_codes` |
| `docs/DATABASE/04` | `invitation_preview_tokens` |
| `docs/DATABASE/07` | Addon availability gating |
| `docs/DATABASE/11-ANALYTICS.md` | **New** — `invitation_view_counts` |
| `docs/DATABASE/12-PLATFORM-CONFIG.md` | **New** — `slug_blocklist` |
| `docs/DEVOPS/03` | Caddy named as the origin proxy; routing rewritten for three fixed hosts, no wildcard |
| `docs/PLAN/10` | Publishing address is path-based at MVP, with hostnames, collision safety and the migration path |
| `docs/BACKEND/06` | Slug resolution by configured strategy — path today, subdomain later, one implementation |
| `docs/PLAN/09`, `11`, `00`, `02` | One package at Rp 139,000 for 12 months; uniform media limits; free-draft quota as BR-1.4 |
| `docs/UI-UX/13`, `14` | Checkout without tier comparison; watermark narrowed to previews only |
| `docs/SECURITY/00`, `09`, `DATABASE/06`, `08` | Gift account numbers reclassified: personal data the couple publishes, not a payment credential. No column encryption; integrity controls instead |
| `docs/PLAN/13`, `18` | Gift account change notification; R16 (gift account tampering) added |
| `docs/API/00`, `FRONTEND/01`, `07`, `UI-UX/02`, `ARCHITECTURE/08`, `PLAN/15`, `SECURITY/02`, `10` | Real hostnames, path-based addresses, origin-separation rationale |
| `docs/PLAN/02`, `docs/PLAN/06` | BR-5.4 and the lifecycle transition rules |
| `docs/PLAN/07` | Demo data lives as a seeded system-owned invitation |
| `docs/PLAN/08` | Where settings fields physically live |
| `docs/PLAN/09` | Addon availability at MVP |
| `docs/PLAN/12` | Moderation queue sources |
| `docs/PLAN/14` | Pointer to the analytics table |
| `docs/PLAN/18` | R13 (single-vendor edge) and R14 (single-host deployment) added |
| `docs/README.md` | File counts |
| `docs/SECURITY/01`, `10`, `11` | 404 wording, blocklist table pointer, IDOR sweep criterion |
