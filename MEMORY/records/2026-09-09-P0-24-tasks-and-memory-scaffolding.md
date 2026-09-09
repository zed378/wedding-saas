# P0-24 — TASKS and MEMORY scaffolding

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-24 |
| **Phase** | Phase 0 |
| **Surface** | docs |
| **Author** | Claude Code session |
| **Commits / PR** | (not yet under version control — see Follow-Ups) |
| **Status** | Completed |

---

## What Changed

The repository gained an execution layer (`TASKS/`) and a restructured record layer (`MEMORY/`). `TASKS/` turns `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md`'s 48-line phase outline into 133 task cards across eight phase files, each naming its dependencies, the specification documents it implements, its Definition of Done, and the abuse cases it must have tests for. `MEMORY/` moved from a `STATE.md` plus `LOG/` shape to the record format used in the project owner's `zed-auth` repository: an index, a changelog, an ADR log, `records/`, `specs/` and `templates/`.

## Why

Requested directly: an implementation plan in a `TASKS` directory, split into phases, as detailed as possible; then, mid-work, that `MEMORY/` should follow the format of `github.com/zed378/zed-auth`.

The gap this fills was real before the request. `docs/` is complete and precise — 121 documents including full SQL schemas, endpoint contracts, a threat model and a per-layer test strategy — but between it and the roadmap there was nothing saying what to do first, what blocks what, or how a piece of work is judged finished. `docs/PLAN/16` § Critical Dependencies states two hard ordering constraints in prose, where they are easy to skip: the template system must be settled before editor work, and the payment security review must precede production deployment. Both are now task dependencies.

## How

Read the entire specification set — all 121 files, roughly 4,650 lines — before writing anything, then cloned `zed-auth` and read its `TASKS/` and `MEMORY/` structure to match the format rather than approximate it.

Phase boundaries follow `docs/PLAN/16` exactly (Phase 0 through 7), so the plan and the roadmap cannot drift apart. Within a phase, tasks were derived from the documents that specify the work rather than invented: `docs/API/` for endpoints, `docs/DATABASE/` for schema tasks, `docs/SECURITY/` for the abuse cases attached to each card, `docs/UI-UX/` and `docs/FRONTEND/` for the frontend tasks.

Three structural choices worth naming:

**The tenant-scoped repository layer is a Phase 0 task (`P0-11`), not a Phase 1 one.** `docs/SECURITY/05` is the project's stated number-one priority with zero tolerance, and `docs/PLAN/18` R1 rates it very high impact. Building the data layer so that an unscoped query is hard to write — before any `:id` endpoint exists — means the next four phases inherit the property instead of being audited for it afterwards.

**Frontend work sits inside the phase that owns its API**, rather than in a separate track. `docs/PLAN/16` puts the editor UI in Phase 1 and the renderer in Phase 2; keeping each screen with its backend preserves that lockstep. The exception is `P0-22` (design system and app shells), which is genuinely phase-independent.

**Every phase ends with its own test-and-acceptance task** rather than deferring all verification to Phase 6. `docs/SECURITY/11` § Test Types requires multi-tenancy testing on every feature touching an `:id`, not only pre-launch — so the IDOR sweep runs per phase and accumulates into `P6-01`'s full matrix.

Writing the plan against the specification was also, unavoidably, a review of it. Gaps were recorded as they appeared rather than worked around.

## Files and Components Touched

| Path | Change |
|---|---|
| `TASKS/README.md` | Created — folder purpose, how to use it, the phase rule |
| `TASKS/00-TASK-CONVENTIONS.md` | Created — IDs, statuses, card anatomy, 11-item global DoD, deviation protocol |
| `TASKS/PROGRESS.md` | Created — the status board, blocked tasks, specification amendments owed |
| `TASKS/BACKLOG.md` | Created — 13 open questions, 17 specification gaps, 9 deferrals |
| `TASKS/PHASE-0-FOUNDATION.md` | Created — 24 tasks |
| `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` | Created — 25 tasks |
| `TASKS/PHASE-2-TEMPLATE-RENDERING-AND-PREVIEW.md` | Created — 14 tasks |
| `TASKS/PHASE-3-ORDER-PAYMENT-PUBLISHING.md` | Created — 16 tasks |
| `TASKS/PHASE-4-ENGAGEMENT.md` | Created — 12 tasks |
| `TASKS/PHASE-5-ADMIN-PANEL.md` | Created — 14 tasks |
| `TASKS/PHASE-6-HARDENING-AND-LAUNCH.md` | Created — 17 tasks |
| `TASKS/PHASE-7-POST-LAUNCH.md` | Created — 11 tasks |
| `MEMORY/README.md` | Created — structure, what gets a record, honesty rules |
| `MEMORY/MEMORY-INDEX.md` | Created — one line per record |
| `MEMORY/CHANGELOG.md` | Created |
| `MEMORY/DECISIONS.md` | Rewritten in ADR format; the two prior decisions preserved as ADR-001 and ADR-002; ADR-003 added; a pending-decisions table added |
| `MEMORY/records/` | Created; the existing `LOG/` entry migrated unchanged |
| `MEMORY/specs/` | Created, empty until the first `Spec required` task |
| `MEMORY/templates/` | Created — change record, phase summary, feature spec templates |
| `MEMORY/LOG/` | Removed (contents migrated to `records/`) |
| `MEMORY/STATE.md` | Removed — superseded by `TASKS/PROGRESS.md` |
| `CLAUDE.md` | MEMORY section rewritten; `TASKS/` added to the documentation map and the feature workflow |
| `AGENTS.md` | Same |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Add `TASKS/` and restructure `MEMORY/` | The specification had no execution layer, and the record layer had no forward-looking counterpart | ADR-003 |
| Remove `MEMORY/STATE.md` in favour of `TASKS/PROGRESS.md` | Two status snapshots drift, and then neither is trusted | ADR-003 |
| Feature specs live in `MEMORY/specs/`, not `TASKS/specs/` | Everything written *about* a task in one place | ADR-003 |
| `TASKS/` and `MEMORY/` written in English | Matches `docs/` and ADR-001; user-facing copy stays Indonesian | ADR-001, `OQ-07` |

## Deviations from `docs/`

None. No `docs/` file was modified. Fourteen amendments are **owed** by the tasks that resolve the gaps found here, tracked in `TASKS/PROGRESS.md` § Specification Amendments Owed.

## Tests Added

| Layer | What it covers |
|---|---|
| Unit | Not applicable — documentation only |
| Integration | Not applicable |
| E2E | Not applicable |
| Security | Not applicable |

## Security Verification

Not applicable — no code was written. The security *requirements* were, however, the main organizing constraint: `docs/SECURITY/05`'s zero-tolerance rule appears as global DoD item 2 (an IDOR test on every `:id` endpoint), as its own Phase 0 task (`P0-11`), as abuse-case tables on individual cards, and as `P6-01`'s unwaivable release gate.

## Abuse Cases Covered

Not applicable to this task. Abuse-case tables were **authored** onto 20 task cards, drawn from `docs/SECURITY/01` § STRIDE, `docs/SECURITY/05` § Attack Surfaces, `docs/SECURITY/06`, `docs/SECURITY/07` and `docs/PLAN/18`.

## Definition of Done Verification

- [x] `TASKS/` contains conventions, eight phase files, a progress board and a backlog
- [x] `MEMORY/` follows the record format with index, changelog, decision log and templates
- [x] `CLAUDE.md` and `AGENTS.md` describe the current structure, with no reference to `MEMORY/STATE.md` or `MEMORY/LOG/`
- [x] Gaps and open questions found while writing are recorded with the task each affects
- [x] Every task card names its specification references, so no implementer has to guess
- [ ] Test layers — not applicable, documentation only
- [ ] CI green — no CI exists yet (`P0-17`)

## What Did Not Work

Writing the larger task files through shell heredocs failed on quoting partway through, and switching to direct file writes was the fix. Worth knowing for anyone scripting document generation in this repository on Windows.

More substantively: an early attempt to organize the plan by system layer — all backend tasks, then all frontend — was abandoned. It read more tidily and would have broken `docs/PLAN/16`'s explicit ordering, which puts the data domain first and then interleaves the UI with the API that serves it. The roadmap's ordering is a decision, not an accident, and the plan follows it.

## Follow-Ups and Open Questions

- **`OQ-01` blocks everything.** `P0-01` cannot start until the stack is chosen, and every other Phase 0 task depends on `P0-01`. This is the single most valuable answer the project owner can give right now.
- **Seven open questions block a specific task**; six more affect sequencing. All are in `TASKS/BACKLOG.md` with recommendations where there is a defensible one.
- **Two specification contradictions need a ruling**, not just a note: `PG-01` (403 versus 404) and `PG-14` (refund target status). `PG-14` has a money consequence — under one reading a refunded customer keeps the ability to republish for free.
- **`OQ-07`** — `TASKS/` and `MEMORY/` are in English to match the corpus. Say the word and they can be translated; the structure is unaffected.
- **The repository is not under version control.** `git status` reports no repository, so none of this is committed. `P0-03` initializes it, and until then there is no history behind these files.

## What to Watch

The failure mode for a plan like this is going stale — `TASKS/PROGRESS.md` saying one thing and the code saying another. Global DoD item 11 requires the board and the phase file to be updated in the same commit as the work, which is the only mechanism that keeps it honest.

The second thing to watch: the 17 specification gaps are recorded, not fixed. If tasks get implemented without resolving the gap they depend on, the fix will be a guess made under deadline pressure, and `docs/` will quietly stop describing the system.
