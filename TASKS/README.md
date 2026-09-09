# TASKS/ — Execution Plan

`docs/` describes **what** to build and **why**. This folder describes **what to do next, in what order, and how to know it is finished**.

Nothing in this folder invents new architecture. Every task points back to the specification document that already decided the design. If a task would need a decision `docs/` does not contain, it is not a task — it is an entry in [`BACKLOG.md`](./BACKLOG.md) under "Open Questions", to be raised with the project owner.

## Files in This Folder

| File | Purpose |
|---|---|
| [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) | Task ID scheme, status values, the anatomy of a task card, and the Definition of Done every task inherits |
| [`PROGRESS.md`](./PROGRESS.md) | The single status board — phase-level and task-level completion at a glance |
| [`PHASE-0-FOUNDATION.md`](./PHASE-0-FOUNDATION.md) | Stack decision, repo scaffolding, full schema, tenant-scoped data layer, CI, queue/storage skeletons, the reference template |
| [`PHASE-1-AUTH-AND-INVITATION-CORE.md`](./PHASE-1-AUTH-AND-INVITATION-CORE.md) | Auth, RBAC and ownership middleware, invitation CRUD and every sub-resource, media pipeline, dashboard and editor shell |
| [`PHASE-2-TEMPLATE-RENDERING-AND-PREVIEW.md`](./PHASE-2-TEMPLATE-RENDERING-AND-PREVIEW.md) | The generic renderer, section components, live preview, the public invitation page, SEO, share-preview |
| [`PHASE-3-ORDER-PAYMENT-PUBLISHING.md`](./PHASE-3-ORDER-PAYMENT-PUBLISHING.md) | Server-side pricing, orders, gateway integration, the signed webhook, publish/unpublish, subdomain routing, caching, expiry and renewal |
| [`PHASE-4-ENGAGEMENT.md`](./PHASE-4-ENGAGEMENT.md) | Public RSVP and guestbook, owner-side management, moderation, the notification worker, view analytics |
| [`PHASE-5-ADMIN-PANEL.md`](./PHASE-5-ADMIN-PANEL.md) | The admin surface: 2FA, template management, users, orders and refunds, moderation queue, audit log viewer |
| [`PHASE-6-HARDENING-AND-LAUNCH.md`](./PHASE-6-HARDENING-AND-LAUNCH.md) | IDOR sweep, payment and upload abuse suites, pentest, load testing, DR drill, accessibility, UAT, release gate |
| [`PHASE-7-POST-LAUNCH.md`](./PHASE-7-POST-LAUNCH.md) | Custom domain, advanced analytics, WhatsApp, marketplace, multi-language, and the other Phase 2 items from `docs/PLAN/00` |
| [`BACKLOG.md`](./BACKLOG.md) | Open questions, specification gaps, and deliberate deferrals |

## How to Use This Folder

1. **Before starting work**, open [`PROGRESS.md`](./PROGRESS.md) and find the lowest-numbered task in the current phase that is `TODO` and whose dependencies are all `DONE`.
2. **Read every document listed in that task's `Spec refs` row.** These are not decoration — they contain the decisions the task implements. `docs/` is fully written; guessing at an endpoint shape or a column name is never necessary and never acceptable.
3. **If the task is marked `Spec required`**, write the feature spec from [`../MEMORY/templates/FEATURE-SPEC-TEMPLATE.md`](../MEMORY/templates/FEATURE-SPEC-TEMPLATE.md) before writing code. Save it to `MEMORY/specs/<task-id>-<slug>.md`.
4. **Implement**, satisfying every line of the task's Definition of Done plus the inherited global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md).
5. **Record the change** in [`../MEMORY/`](../MEMORY/README.md) — a change record per task, an index line, a changelog entry, and an ADR if an architectural decision was made or a specification deviated from.
6. **Update `PROGRESS.md`** and tick the checkbox in the phase file, in the same commit as the work.

## The Phase Rule

From `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md`:

> **Never build a Phase N+1 feature while Phase N is incomplete.**

The phases are sequential because each one depends on the previous one being sound: the editor is schema-driven, so the template system must be settled first (`docs/PLAN/16` § Critical Dependencies); payment security must be reviewed before the payment API is deployed; and every `:id` endpoint written before the ownership middleware exists is an IDOR waiting to be found.

Two deliberate exceptions, both encoded as tasks rather than left to judgement:

- **The reference template (`P0-21`) ships in Phase 0**, ahead of the renderer that consumes it, because `docs/PLAN/16` requires the template schema to be finalized before editor work begins.
- **Frontend foundation work (`P0-22`) starts in Phase 0** and frontend page tasks appear inside the phase whose API unblocks them, rather than as a separate track. `docs/PLAN/16` puts the editor UI in Phase 1 and the renderer in Phase 2; that lockstep is preserved here by keeping each screen in the phase that owns its backend.

## Relationship to `docs/` and `MEMORY/`

| Folder | Direction | Nature |
|---|---|---|
| `docs/` | Reference | What was decided before building. Amended only deliberately, per the deviation protocol. |
| `TASKS/` | Forward | What will be built, in what order, and how it will be judged done. |
| `MEMORY/` | Backward | What was built, what it cost, and what to watch. |

`TASKS/` is forward-looking; `MEMORY/` is backward-looking. They are updated in the same commit: a task is not `DONE` until its MEMORY record exists.
