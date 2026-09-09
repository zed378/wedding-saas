# <Task ID> — <Short Title>

| | |
|---|---|
| **Date** | YYYY-MM-DD |
| **Task** | `TASKS/PHASE-N-....md` § <task id> |
| **Phase** | Phase N |
| **Surface** | backend / worker / web-app / public-invite / admin / infra / docs |
| **Author** | |
| **Commits / PR** | |
| **Status** | Completed / Partially completed / Reverted |

---

## What Changed

A factual summary in two or three sentences. What exists now that did not before, or behaves differently than it did.

## Why

The reason this was done now, and the specification documents it implements. Link them precisely — `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` § Attack Surfaces, not "the security doc".

If the task exists because of something discovered during other work rather than because the roadmap said so, say that — it is the more useful information.

## How

The implementation approach, at the level of detail a future reader needs before opening the code. Not a line-by-line description; the diff already covers that.

Name anything non-obvious: a workaround, an unusual pattern, a place where the straightforward approach was wrong for a reason that is not visible locally.

## Files and Components Touched

| Path | Change |
|---|---|
| | |

## Decisions Made

Decisions taken during this work. Anything architectural, or any deviation from `docs/`, also gets a full ADR in `DECISIONS.md` — link it here.

| Decision | Rationale | ADR |
|---|---|---|
| | | |

## Deviations from `docs/`

Per the deviation protocol in `TASKS/00-TASK-CONVENTIONS.md`: state the conflict, what was chosen, whether the project owner approved it, and whether the document has been amended.

If there were none, write "None" — an empty section reads as an oversight.

## Tests Added

| Layer | What it covers |
|---|---|
| Unit | |
| Integration | |
| E2E | |
| Security | |

## Security Verification

Fill this in for any task touching authorization, payment, upload, sanitization, or the public surface. Name the test, not the intention.

| Control | Requirement source | Test that proves it |
|---|---|---|
| Object-level authorization (404 for a non-owner) | `docs/SECURITY/05` | |
| Field whitelisting / no mass assignment | `docs/SECURITY/08` | |
| Free-text sanitization | `docs/SECURITY/08` | |
| Payment status server-decided only | `docs/SECURITY/07` | |
| Upload validation layers | `docs/SECURITY/06` | |

## Abuse Cases Covered

Every abuse case listed on the task card must appear here with the test that covers it.

| Abuse case | Source | Test |
|---|---|---|
| | | |

## Definition of Done Verification

Both the task's own DoD and the global DoD from `TASKS/00-TASK-CONVENTIONS.md`. **If an item was waived, say which one, why, and who agreed** — a silently unmet DoD item is the failure mode this section exists to prevent.

- [ ] Tests at the appropriate pyramid layer
- [ ] IDOR test for every new `:id` endpoint
- [ ] Every abuse case has an automated test
- [ ] Write endpoints whitelist their fields
- [ ] Free-text input sanitized before storage
- [ ] Response envelope matches `docs/API/00`
- [ ] State transitions logged (`invitation_status_history` / `audit_logs`)
- [ ] Nothing sensitive logged
- [ ] CI green: lint, types, build, unit, integration, dependency audit, SAST
- [ ] `TASKS/PROGRESS.md` and the phase file updated
- [ ] Task-specific DoD items (list them)

## What Did Not Work

Approaches tried and abandoned, and why. The section most likely to be skipped and most likely to save someone a day later — a dead end that is not recorded gets walked into again.

## Follow-Ups and Open Questions

Anything left undone, discovered mid-work, or deferred. Every item here should also exist in `TASKS/BACKLOG.md` or as a task, so it has a consequence rather than only a mention.

## What to Watch

What could go wrong in production because of this change, what the symptom would look like, and which metric or alert would show it first.
