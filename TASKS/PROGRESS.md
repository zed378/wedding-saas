# Progress Board

Single source of truth for where the project stands. Updated in the same commit as the work it describes (`00-TASK-CONVENTIONS.md` global DoD item 11).

**Last updated**: 2026-09-09
**Current phase**: Phase 0 — Foundation (1 / 24 done). `P0-01` is `BLOCKED` on `OQ-01`; nothing else in Phase 0 can start until the stack is chosen.
**Overall**: 1 / 133 tasks done

Status values: `TODO` · `BLOCKED` · `SPEC` · `WIP` · `REVIEW` · `DONE` · `DROPPED`
Sizes: `S` under half a day · `M` one to two days · `L` several days · `XL` must be split

---

## Phase Summary

| Phase | Tasks | Done | Status | Gate to enter |
|---|---|---|---|---|
| [Phase 0 — Foundation](./PHASE-0-FOUNDATION.md) | 24 | 1 | **ACTIVE** — blocked on `OQ-01` | — |
| [Phase 1 — Auth and Invitation Core](./PHASE-1-AUTH-AND-INVITATION-CORE.md) | 25 | 0 | Not started | Phase 0 exit criteria |
| [Phase 2 — Template Rendering and Preview](./PHASE-2-TEMPLATE-RENDERING-AND-PREVIEW.md) | 14 | 0 | Not started | Phase 1 exit + `P1-25` |
| [Phase 3 — Order, Payment and Publishing](./PHASE-3-ORDER-PAYMENT-PUBLISHING.md) | 16 | 0 | Not started | Phase 2 exit + `OQ-02`, `OQ-05` answered |
| [Phase 4 — Engagement](./PHASE-4-ENGAGEMENT.md) | 12 | 0 | Not started | Phase 3 exit + `OQ-04` answered |
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
| P0-01 | Confirm and freeze the tech stack | docs | S | **BLOCKED** — `OQ-01` | — |
| P0-02 | Initialize the monorepo structure | infra | S | TODO | P0-01 |
| P0-03 | Git conventions, PR template, CODEOWNERS | infra | S | TODO | P0-02 |
| P0-04 | Backend service skeleton | backend | M | TODO | P0-02 |
| P0-05 | Local environment via Docker Compose | infra | M | TODO | P0-04 |
| P0-06 | Migration tooling and baseline migration | backend | S | TODO | P0-05 |
| P0-07 | Schema 1/4 — users and auth tables | backend | M | TODO | P0-06 |
| P0-08 | Schema 2/4 — templates, versions, media | backend | M | TODO | P0-07 |
| P0-09 | Schema 3/4 — invitations and children | backend | L | TODO | P0-08 |
| P0-10 | Schema 4/4 — orders, payments, audit logs | backend | M | TODO | P0-09 |
| P0-11 | Tenant-scoped repository layer | backend | L | TODO | P0-09 |
| P0-12 | Structured logging with redaction | backend | M | TODO | P0-04 |
| P0-13 | Response envelope, errors, health | backend | M | TODO | P0-04 |
| P0-14 | Audit log and status history writers | backend | M | TODO | P0-10, P0-12 |
| P0-15 | Queue and worker skeleton | worker | M | TODO | P0-05, P0-12 |
| P0-16 | Object storage abstraction | backend | M | TODO | P0-05 |
| P0-17 | CI pipeline | infra | M | TODO | P0-04 |
| P0-18 | Secrets and configuration conventions | infra | S | TODO | P0-04 |
| P0-19 | Test harness | backend, web-app | M | TODO | P0-05 |
| P0-20 | Template schema definition and validator | backend, web-app | L | TODO | P0-08 |
| P0-21 | Reference template and demo seed data | backend, web-app | L | TODO | P0-20 |
| P0-22 | Frontend skeletons and design system | frontend | L | TODO | P0-02 |
| P0-23 | Staging, wildcard DNS and TLS | infra | L | **BLOCKED** — `OQ-03`, `OQ-08` | P0-17 |
| P0-24 | Adopt the TASKS/MEMORY discipline | docs | S | **DONE** | — |

**Critical path**: `P0-01` → `P0-02` → `P0-04` → `P0-05` → `P0-06` → `P0-07`…`P0-11`. `P0-11` is the one to give extra review attention: every `:id` endpoint in the next four phases is built on it.

**Parallel tracks** once `P0-02` lands: backend schema (`P0-04`…`P0-11`), platform (`P0-17`, `P0-18`, `P0-23`), frontend (`P0-22`), template (`P0-20`, `P0-21` — needs only `P0-08`).

---

## Phase 1 — Auth and Invitation Core

Roadmap: Week 3-5.

| ID | Task | Surface | Size | Status | Depends on |
|---|---|---|---|---|---|
| P1-01 | Password hashing and policy | backend | M | TODO | P0-07, P0-19 |
| P1-02 | Registration and email verification | backend | M | TODO | P1-01, P0-15 |
| P1-03 | Login, access tokens, refresh rotation | backend | L | TODO | P1-01 |
| P1-04 | Google OAuth | backend | M | TODO | P1-03 |
| P1-05 | Forgot and reset password | backend | M | TODO | P1-03, P0-15 |
| P1-06 | Auth, role and ownership middleware | backend | L | TODO | P1-03, P0-11 |
| P1-07 | Rate limiting | backend | M | TODO | P1-03 |
| P1-08 | User profile and account deletion | backend | M | TODO | P1-06 |
| P1-09 | Create an invitation | backend | M | TODO | P1-06, P0-20 |
| P1-10 | Invitation list, detail, update, delete | backend | L | TODO | P1-09 |
| P1-11 | Couple sub-resource | backend | M | TODO | P1-10 |
| P1-12 | Events sub-resource | backend | M | TODO | P1-10 |
| P1-13 | Bank accounts and quote | backend | M | TODO | P1-10 |
| P1-14 | Settings and slug rules | backend | M | TODO | P1-10 |
| P1-15 | Change template without data loss | backend | M | TODO | P1-10, P0-20 |
| P1-16 | Free-text sanitization pipeline | backend | M | TODO | P0-13 |
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
| P3-01 | Packages, addons, pricing service | backend | M | **BLOCKED** — `OQ-05` | P0-10 |
| P3-02 | Order creation | backend | L | TODO | P3-01, P1-06 |
| P3-03 | Payment gateway port and adapter | backend | L | **BLOCKED** — `OQ-02` | P3-02, P0-18 |
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
| P4-05 | Abuse controls and adaptive CAPTCHA | backend | M | **BLOCKED** — `OQ-09` | P4-01, P4-03 |
| P4-06 | Notification module and email port | backend, worker | L | **BLOCKED** — `OQ-04` | P0-15 |
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
| P5-08 | Manual refund | backend, admin | M | TODO | P5-07 |
| P5-09 | Moderation queue | backend, admin | M | TODO | P5-03, P4-04 |
| P5-10 | Invitation overview, read-only | backend, admin | M | TODO | P5-03 |
| P5-11 | Dashboard metrics | backend, admin | M | TODO | P5-03 |
| P5-12 | Audit log viewer | backend, admin | M | TODO | P5-03 |
| P5-13 | Slug blocklist management | backend, admin | M | TODO | P5-03, P1-09 |
| P5-14 | Phase 5 test suite and acceptance | all | M | TODO | all above |

**Note**: `P5-08` cannot start until `PG-14` (refund target status contradiction) is resolved.

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

| Task | Blocker | Kind |
|---|---|---|
| P0-01 | `OQ-01` — tech stack | Open question |
| P0-23 | `OQ-03` — hosting target, `OQ-08` — domain | Open questions |
| P3-01 | `OQ-05` — pricing values | Open question |
| P3-03 | `OQ-02` — payment provider | Open question |
| P4-05 | `OQ-09` — CAPTCHA vendor | Open question |
| P4-06 | `OQ-04` — email provider | Open question |
| P5-08 | `PG-14` — refund status contradiction | Specification gap |

Seven of the thirteen open questions in [`BACKLOG.md`](./BACKLOG.md) block a specific task. `OQ-01` blocks everything.

---

## Specification Amendments Owed

Each of these is a `docs/` change owed by the task that resolves the gap, per the deviation protocol. They are listed here so the debt is visible on the board rather than only inside a phase file.

| Gap | Document to amend | Owed by |
|---|---|---|
| PG-01 | `docs/API/00`, `docs/API/05` | P0-13 |
| PG-02 | `docs/PLAN/08` (mapping note) | P1-14 |
| PG-03 | `docs/API/05` | P1-17 |
| PG-04 | `docs/API/04`, `docs/DATABASE/04` | P2-12 |
| PG-06 | `docs/DATABASE/02` | P1-02 |
| PG-07 | `docs/API/06` | P3-02 |
| PG-09 | `docs/API/08` | P3-09 |
| PG-10, PG-11 | `docs/API/04` | P4-02, P4-04 |
| PG-12 | `docs/DATABASE/` (new table) | P4-09 |
| PG-13 | `docs/DATABASE/02` | P5-02 |
| PG-14 | `docs/BACKEND/05` | P5-08 |
| PG-15 | `docs/DATABASE/` (new table) | P5-13 |
| PG-16 | `docs/API/04` | P1-15 or P5-04 |
| PG-17 | `docs/ARCHITECTURE/04` | P0-09 |
