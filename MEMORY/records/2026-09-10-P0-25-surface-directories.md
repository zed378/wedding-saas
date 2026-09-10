# P0-25 — Surfaces separated into `backend/`, `frontend/`, `admin/`

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-25 |
| **Phase** | Phase 0 |
| **Surface** | infra |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-25-surface-directories` |
| **Status** | Completed |

---

## What Changed

The single `apps/` directory is gone. The five deployable surfaces now sit in three top-level groups — `backend/{api,worker}`, `frontend/{web-app,public-invite}` and `admin/` — beside the unchanged `packages/`.

`docs/FRONTEND/00` § Project Structure still describes `apps/` and was **deliberately left unamended**.

## Why

Requested by the project owner, in two parts: separate the frontend, admin and backend directories; and do not amend the specification to match.

## How

**`git mv` throughout**, so git recorded renames rather than delete-plus-add and `git log --follow` still traces every moved file back through `P0-02` and `P0-04`.

**`admin/` sits beside `frontend/`, not inside it.** It is a React application like the other two, so grouping by language would put it under `frontend/`. Grouping by trust boundary does not: `docs/SECURITY/02` § boundary 3→4 places the admin panel behind its own boundary, on its own hostname, with a session deliberately separate from the user application (ADR-024). Filing it next to the surface it is isolated from would make the directory tree argue against the architecture. The layout now reflects what deploys together and what is isolated from what.

**The move was verified by deletion, not by inspection.** Every `dist/`, the turbo cache and the resolved workspace were cleared before running build, typecheck, test and format, so nothing could pass on stale artifacts pointing at the old paths.

## Files and Components Touched

| Path | Change |
|---|---|
| `apps/api` → `backend/api` | Moved |
| `apps/worker` → `backend/worker` | Moved |
| `apps/web-app` → `frontend/web-app` | Moved |
| `apps/public-invite` → `frontend/public-invite` | Moved |
| `apps/admin` → `admin` | Moved; relative links lost a segment and were fixed |
| `pnpm-workspace.yaml` | Globs: `backend/*`, `frontend/*`, `admin`, `packages/*` |
| `README.md`, `packages/README.md` | Layout and folder table |
| `CLAUDE.md`, `AGENTS.md` | Real layout, plus an explicit note that `docs/FRONTEND/00` disagrees |
| `TASKS/PHASE-0-FOUNDATION.md` | `P0-25` card; `P0-02`'s superseded step annotated rather than rewritten |
| `TASKS/PHASE-2-...md` | Renderer import paths |
| `MEMORY/DECISIONS.md` | ADR-027 |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Three top-level groups instead of `apps/` | Owner's request | ADR-027 |
| `admin/` beside `frontend/`, not inside it | Grouping follows trust boundaries, not languages | ADR-027 |
| `docs/` left unamended | Owner's explicit instruction; carried as a recorded deviation instead | ADR-027 |
| Prior records and ADR-005 keep their old paths | They describe what was true when written; rewriting history is what makes a record untrustworthy | — |

## Deviations from `docs/`

**One, deliberate and unresolved by design.** `docs/FRONTEND/00-FRONTEND-STANDARDS.md` § Project Structure specifies `apps/web-app`, `apps/public-invite` and `packages/*`. The repository no longer matches it.

`CLAUDE.md` § "When docs and reality disagree" and the deviation protocol in `TASKS/00-TASK-CONVENTIONS.md` both say to fix the document in the same change. The project owner instructed otherwise. The divergence is therefore recorded here and in ADR-027 rather than closed, which is the weaker of the two options and is stated as such.

The compensating control is narrow but real: `CLAUDE.md` and `AGENTS.md` are read first by every session, and both now state the true layout **and** that the specification disagrees, so nobody has to discover it by building the wrong thing.

`docs/DEVOPS/02-CONTAINERIZATION.md`'s compose example also still names `./apps/api`. Same situation, same reason.

## Tests Added

None — this is a move, not behaviour. The existing 16 tests are the check that matters, and they were run against a fully cleared cache.

| Verification | Result |
|---|---|
| `pnpm build` from deleted `dist/` and cleared turbo cache | pass |
| `pnpm typecheck` | pass |
| `pnpm test` (16 tests) | pass |
| `pnpm format:check` | pass |
| Workspace resolution | all ten projects resolve from their new paths |
| `git status` | renames, not delete-plus-add |

## Security Verification

Not a behavioural change. One security-relevant property was preserved deliberately rather than incidentally: the admin panel's isolation from the user application is now visible in the layout instead of only in `docs/SECURITY/02`. That does not enforce anything on its own, but a structure that suggests the wrong grouping is how the wrong thing eventually gets built.

## Definition of Done Verification

- [x] `apps/` no longer exists; all five surfaces resolve as workspace projects
- [x] `git status` shows renames, so `git log --follow` still works
- [x] Build, typecheck, test and format pass from a cleared cache
- [x] `CLAUDE.md` and `AGENTS.md` state the real layout and that `docs/FRONTEND/00` disagrees
- [x] The deviation is recorded as an ADR

## What Did Not Work

**The first `git mv` failed with `Permission denied`.** Three `node.exe` processes from the `P0-04` runtime verification were still running and holding files under `apps/api`. My earlier `kill %1` had not actually stopped them — a background job killed through the shell does not necessarily take the Node process with it on Windows.

Worth recording twice over: it cost a confusing failure here, and it means the `P0-04` verification left processes running on the machine after the task was reported complete. Any future task that starts the service by hand should stop it by PID and confirm, rather than assuming a shell job control signal did the job.

## Follow-Ups and Open Questions

- **`docs/FRONTEND/00` and `docs/DEVOPS/02` now describe a layout the repository does not use.** One line in each would close it. Left open at the owner's instruction; raising it once here is the honest thing, pressing further would not be.
- The `P0-02` record still describes `apps/` paths. Correct — it says what was true then — but a reader jumping straight to it without the index will get stale paths. The index line for this record is the pointer that prevents that.

## What to Watch

A directory move is the kind of change that looks complete and leaves one broken reference somewhere nobody runs until later. Build, typecheck, test and format all pass, but four of the six surfaces still have placeholder scripts that do nothing (`worker`, `web-app`, `public-invite`, `admin`), so a path error inside those would not surface yet. The first real build of each — `P0-15` and `P0-22` — is where a missed reference would appear.
