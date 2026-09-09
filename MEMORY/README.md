# MEMORY/ — Change Record and Decision Log

`TASKS/` is what will be done. `MEMORY/` is what **was** done, and why it ended up that way.

This folder exists because `docs/` describes the intended system and the code describes the current system — but neither explains how one became the other. Six months from now, the question "why does a refund send the invitation back to `draft` rather than `paid`?" is answerable from here and nowhere else. The code shows the behaviour; only the record shows what it cost to decide.

Agents and contributors working on this repository do not retain memory between sessions. `MEMORY/` is the only mechanism for continuity, which is why writing to it is part of a task rather than a summary appended afterwards.

---

## Structure

| Path | Purpose |
|---|---|
| [`MEMORY-INDEX.md`](./MEMORY-INDEX.md) | One line per record, newest first. The entry point. |
| [`CHANGELOG.md`](./CHANGELOG.md) | Chronological summary of what changed, at a coarser grain than the records. |
| [`DECISIONS.md`](./DECISIONS.md) | Architecture Decision Records — every choice `docs/` left open, and every deviation from it. |
| [`records/`](./records/) | One file per completed task: what changed, why, and what to watch. |
| [`specs/`](./specs/) | Feature specs for tasks marked `Spec required` in `TASKS/`, written before implementation. |
| [`templates/`](./templates/) | The change record, phase summary, and feature spec templates. |

**Where the current status lives**: [`TASKS/PROGRESS.md`](../TASKS/PROGRESS.md), not here. This folder is history; the board is state. A snapshot file in two places drifts, and then neither can be trusted.

---

## What Gets a Record

**Every task that reaches `DONE`.** That is global Definition of Done item 10 in [`TASKS/00-TASK-CONVENTIONS.md`](../TASKS/00-TASK-CONVENTIONS.md), and it is not negotiable — a task without a record is not done, however finished the code looks.

Also recorded:

- **Any deviation from `docs/`** — as an ADR, per the deviation protocol. A documented deviation is a decision; an undocumented one is a bug nobody has found yet.
- **Any decision `docs/` deliberately left open** — the stack, the payment provider, cache TTLs, fail-open versus fail-closed choices, encryption at rest for account numbers.
- **Phase completions** — a summary of what shipped, what deviated, what was deferred, and what to watch.
- **Security-relevant outcomes** — the IDOR sweep result, a pentest, the payment security review, a load test, a restore drill. These are the evidence `docs/PLAN/17` § Sign-off is built on, and an assertion that a test passed is not evidence.
- **Operational events with lasting consequence** — a production incident, a rollback, a key rotation.

## What Does Not Get a Record

- Work in progress. Records describe completed changes.
- Anything the git history already tells you accurately. A record explains *why*, not *what changed on which line*.
- Restating a `docs/` document. Link to it instead.

---

## Writing a Record

1. Copy [`templates/CHANGE-RECORD-TEMPLATE.md`](./templates/CHANGE-RECORD-TEMPLATE.md).
2. Name it `records/YYYY-MM-DD-<task-id>-<slug>.md`.
3. Fill in every section. "Not applicable" is a valid answer; a blank section is not — each section exists because it has been the missing piece in someone's later investigation.
4. Add a one-line pointer to [`MEMORY-INDEX.md`](./MEMORY-INDEX.md) at the top of the list.
5. Add a [`CHANGELOG.md`](./CHANGELOG.md) entry if the change is user-visible or operationally significant.
6. Add an ADR to [`DECISIONS.md`](./DECISIONS.md) if a decision was made or a `docs/` document deviated from.
7. Commit all of it **with the code**, not afterwards. A record written a week later is a reconstruction, and reconstructions quietly omit the parts that were confusing at the time — which are exactly the parts worth having.

## Writing an ADR

Use the format at the top of `DECISIONS.md`. The two sections easiest to skip are the two that matter:

- **Alternatives considered** — the value of an ADR is that a future reader can tell whether their new idea was already evaluated and rejected, or genuinely never considered.
- **Consequences** — including the bad ones. An ADR listing only benefits is marketing, and it will not be trusted when someone needs to decide whether to revisit the choice.

---

## Honesty Rules

These matter more here than anywhere else in the repository, because a record is only worth reading if it can be trusted.

- **Record what happened, not what was supposed to happen.** If a test was skipped, say so. If a Definition of Done item was waived, say which one and who agreed.
- **Record failures.** A load test that missed its target, an approach abandoned after two days, a migration rolled back — these are the highest-value records here, because they stop the same ground being covered twice.
- **Never claim a security test passed without naming it.** `docs/SECURITY/05` sets zero tolerance for cross-tenant leaks and `docs/SECURITY/11` makes multi-tenancy findings unwaivable. A record that says "IDOR tested, all good" and names no test is worse than one that says nothing, because it stops anyone looking again.
- **Do not retroactively edit a record to look better.** Add a follow-up record instead. The point of an append-oriented log is that it can be trusted — the same reason `audit_logs` is append-only at the database level (`docs/DATABASE/10` § Policy).
- **Record open questions found during the work**, and add them to [`TASKS/BACKLOG.md`](../TASKS/BACKLOG.md) so they have a consequence rather than only a mention.

---

## Relationship to Other Folders

| Folder | Direction | Nature |
|---|---|---|
| `docs/` | Reference | What was decided before building. Amended only through the deviation protocol. |
| `TASKS/` | Forward | What will be built, in what order, and how it will be judged done. |
| `MEMORY/` | Backward | What was built, what it cost, and what to watch. |

A `docs/` document changing is itself an event worth a record — it means reality taught the specification something.
