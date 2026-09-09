# 00 — Task Conventions

How every task in this folder is written, tracked, and closed. Read once; then it applies to all phases.

## Task IDs

```
P<phase>-<nn>[.<sub>]
```

| Example | Meaning |
|---|---|
| `P0-04` | Phase 0, task 4 |
| `P1-17.2` | Phase 1, task 17, sub-task 2 |
| `P6-01` | Phase 6, task 1 |

IDs are **permanent and never reused**. If a task is dropped, its ID is retired with a `DROPPED` status and a one-line reason — a gap in the numbering is a lost audit trail, and this project's whole premise (`docs/DATABASE/10-AUDIT-LOGS.md`, `docs/PLAN/06-INVITATION-LIFECYCLE.md`) is that history matters.

Task IDs are the join key across the repo: branch names (`feat/P1-09-invitation-create`), commit subjects, PR titles, MEMORY change records, and `PROGRESS.md`.

## Status Values

| Status | Meaning |
|---|---|
| `TODO` | Not started. Dependencies may or may not be met. |
| `BLOCKED` | Cannot start — a dependency is incomplete, or an open question in `BACKLOG.md` must be answered first. The blocker is always named. |
| `SPEC` | A feature spec is being written (`MEMORY/templates/FEATURE-SPEC-TEMPLATE.md`); no implementation code yet. |
| `WIP` | Implementation in progress. |
| `REVIEW` | Implementation complete, under review / awaiting test results. |
| `DONE` | Every line of the task DoD and the global DoD below is satisfied, **and** a MEMORY record exists. |
| `DROPPED` | Deliberately abandoned. Requires a one-line reason and a MEMORY decision record. |

## Task Card Anatomy

Every task in a phase file uses this structure:

```
### P1-09 — Create an invitation

| | |
|---|---|
| Status | TODO |
| Depends on | P0-11, P1-06 |
| Spec refs | docs/API/04-INVITATION-API.md, docs/DATABASE/04-INVITATIONS.md |
| Spec required | Yes — touches the data model |
| Surface | backend |

Goal — one sentence stating the observable outcome.
Steps — the ordered implementation sequence.
Definition of Done — checkable, objective conditions.
Abuse cases to test — cross-referenced from docs/SECURITY/ and docs/PLAN/18.
```

Field meanings:

- **Depends on** — task IDs that must be `DONE` first. Empty means it can start as soon as the phase starts.
- **Spec refs** — the authoritative documents. If implementation and these documents disagree, the documents win unless the deviation is escalated (see below).
- **Spec required** — `Yes` for anything touching authentication, authorization, payment, file upload, the public surface, or the data model, per `CLAUDE.md`'s non-negotiable rules. `No` for config, scaffolding, and copy work.
- **Surface** — `backend`, `worker`, `web-app`, `public-invite`, `admin`, `infra`, `docs`, or a combination. Used to parallelize work, and to tell at a glance whether a task needs a frontend or a backend person.

## Global Definition of Done

Inherited by **every** task. A task's own DoD is *in addition* to this, never instead of it.

1. **Tests exist at the right layer** of `docs/TESTING/00-TEST-STRATEGY.md`'s pyramid — unit for pure logic, integration against a real Postgres/Redis testcontainer, E2E for user-visible flows.
2. **Every `:id` endpoint has an IDOR test**: user B requests user A's resource and receives `404`, with A's data absent from the response body. This is `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md`'s zero-tolerance rule, and it is the single most frequently skipped item in projects like this one.
3. **Every abuse case listed on the task has an automated test.** A security-sensitive feature with no abuse-case test is not done, however well the happy path works.
4. **Write endpoints whitelist their accepted fields** (`docs/SECURITY/08-API-SECURITY.md` § Input Validation). A test proves that sending `role`, `owner_id`, or a status field in the body changes nothing.
5. **Free-text input is sanitized before storage** (`docs/BACKEND/03-VALIDATION.md`), with a test asserting a script payload does not survive a round-trip to the public page.
6. **Responses follow the envelope in `docs/API/00-API-STANDARDS.md`** — `{success, data, meta}` / `{success, error:{code, message, details}}`, `snake_case` fields, ISO-8601 UTC timestamps — asserted in an integration test, not assumed.
7. **State transitions are logged, not just written**: `invitation_status_history` for invitation status (`docs/DATABASE/04`), `audit_logs` for admin actions (`docs/DATABASE/10`).
8. **Nothing sensitive is logged** — no passwords, tokens, full bank account numbers, or un-redacted payment payloads (`docs/DEVOPS/06-LOGGING.md` § Mandatory Redaction).
9. **CI is green**: lint, type check, build, unit + integration tests, dependency audit, SAST (`docs/DEVOPS/01-CI-CD.md`).
10. **A MEMORY change record exists** (`MEMORY/records/`), the index and changelog are updated, and any architectural decision or specification deviation has an ADR in `MEMORY/DECISIONS.md`.
11. **`PROGRESS.md` and the phase file checkbox are updated** in the same commit as the work.

## Definition of Ready

A task should not move to `WIP` unless:

- All `Depends on` tasks are `DONE`.
- Every document in `Spec refs` has actually been read for this task, not remembered from a previous one.
- If `Spec required: Yes`, the spec exists in `MEMORY/specs/` and is complete.
- No unanswered `BACKLOG.md` open question blocks it.

## Deviation Protocol

`CLAUDE.md` § "When docs and reality disagree" makes `docs/` the source of truth. When reality and the specification conflict — a library cannot do what `docs/ARCHITECTURE/06` assumed, a payment provider's webhook shape differs from `docs/API/07`, a UX spec is impossible at a given breakpoint:

1. **Stop.** Do not silently pick a different approach.
2. Write an ADR in `MEMORY/DECISIONS.md` describing the conflict, the options, and the recommendation.
3. Raise it with the project owner.
4. Only after a decision: implement, amend the affected `docs/` file in the **same change**, and note in the ADR that the document was amended.

A deviation that is documented is a decision. A deviation that is not documented is a bug nobody has found yet.

## Security Review Trigger

`docs/BACKEND/00-BACKEND-STANDARDS.md` § Code Review requires every PR touching an `:id` endpoint to pass the `docs/SECURITY/05` checklist before merge. In addition, a PR carries a **security review flag** in its description if it touches any of:

- authorization or ownership logic,
- payment initiation, webhooks, or pricing,
- file upload or media processing,
- input sanitization or output encoding,
- anything served under `/public/*`.

## Estimation

Tasks carry **relative size**, not calendar dates. `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` gives week ranges per phase assuming a 1-3 engineer team (`docs/PLAN/00` § Constraints); those weeks are the roadmap's forecast, and the sizes here are what a schedule should actually be built from.

| Size | Rough meaning |
|---|---|
| `S` | Under half a day for someone familiar with the area |
| `M` | One to two days |
| `L` | Several days; consider splitting into sub-tasks |
| `XL` | Too large — must be split before it enters `WIP` |

Sizes are recorded in `PROGRESS.md`, not repeated on every card.

## Branch, Commit, PR

### Branching: one branch per task, named for its task ID

`main` stays free of in-progress development code. Every task is worked on its own branch, and the branch name carries the **phase and task number** so it says which unit of work it is without anyone having to look it up.

```
feat/P0-02-monorepo-structure       Phase 0, task 2
feat/P1-09-invitation-create        Phase 1, task 9
fix/P3-05-webhook-signature         Phase 3, task 5
chore/P0-17-ci-pipeline             Phase 0, task 17
```

| Rule | |
|---|---|
| **Naming** | `<type>/P<phase>-<nn>-<slug>` — never a generic phase name. `type` is `feat`, `fix`, `chore` or `docs` |
| **Scope** | One task per branch. A task with sub-tasks may use `feat/P1-12.3-<slug>` |
| **Commits** | Every subject on the branch carries the same task ID: `P0-02: scaffold monorepo structure` |
| **Merge target** | `main`, once the task's Definition of Done — including its MEMORY record — is satisfied. Not before |
| **Exception** | Changes to `docs/`, `TASKS/` and `MEMORY/` alone may go to `main` directly. They are reference, plan and record; the thing `main` is being kept clean *of* is half-finished code |

The point is legibility: `main` should always describe a system that works, and a branch name should answer "which task is this?" on its own. A generic name like `phase-0-foundation` answers neither question — it hides twenty-four tasks behind one label, and nothing about it says whether the work on it is finished.

The task ID appearing in the branch, the commit, the PR, the MEMORY record and `PROGRESS.md` is the whole traceability chain; the branch is simply its first link.
- Commit subject: `P1-09: create invitation with template version lock and settings row`.
- PR body states: the task ID, the specification sections implemented, which test layers were added and run, the security review flag (or "none"), and any deviation with its ADR link.
- Business rules implemented in code carry their rule ID in a comment (`// BR-4.2`), per `docs/BACKEND/02-SERVICE-LAYER.md` § Principles.
