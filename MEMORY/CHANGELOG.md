# Changelog

Chronological summary of changes at a coarser grain than the individual records in [`records/`](./records/). If you want to know what happened and roughly when, read this. If you want to know why it was done that way, follow the link to the record.

This is the **internal** changelog. It is not the product's user-facing release notes, and it may describe work that has not shipped.

Format follows Keep a Changelog conventions, grouped by release once releases exist. Before the first release, entries are grouped by date.

---

## Unreleased

### 2026-09-09

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
