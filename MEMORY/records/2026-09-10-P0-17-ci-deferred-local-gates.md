# P0-17 — CI deferred, and the gates that had to move

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-17 |
| **Phase** | Phase 0 |
| **Surface** | infra |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-17-defer-ci-local-gates` |
| **Status** | **Deferred**, not completed. Compensating controls in place. |

---

## What Changed

`P0-17` is marked `DEFERRED` rather than done, and two local mechanisms now carry the checks the pipeline would have carried:

- `.githooks/pre-push` **blocks** a push that adds an `:id` endpoint without touching a test file.
- `scripts/verify.sh` runs format, lint, typecheck, tests, the `:id` gate, the Helm chart check and build — one command, meant to be run before merging to `main`.

No GitHub Actions workflow was written.

## Why

The project owner asked to skip GitHub CI for now. That is a defensible call and I am not arguing with it: this project merges locally, so a `pull_request` workflow would have triggered on nothing. A workflow that runs on no event, while sitting in the repository looking authoritative, is worse than no workflow — it makes people stop asking whether the check happened.

The part that could not be left alone is narrower.

`scripts/check-id-endpoint-tests.mjs` was written in `P0-03` for one reason: `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` is the project's highest-priority document and declares zero tolerance for cross-tenant leaks, and a rule that lives only in a checklist gets skipped under deadline pressure — invisibly. The script converts it into a failure. It was going to be wired into the pull-request pipeline, and it had **no other caller**.

So deferring CI without moving that script would have quietly returned the project's most important security rule to being a sentence in a document. That is not a consequence the owner asked for; it is one that would have arrived as a side effect. Moving it took ten minutes.

## How

**The pre-push hook blocks now, and the branch-name check still does not.** That split is deliberate and I want it recorded, because a future reader will be tempted to make both severities the same. A hook that obstructs over cosmetics gets disabled, and a disabled hook enforces nothing — the naming check stays a warning for exactly that reason. The `:id` gate earns a block because what it catches is silent and reaches real users' data.

The refusal message names ADR-028 and says explicitly that nothing else will catch this, because the moment someone hits it they are deciding whether to reach for `--no-verify`, and that is the moment the reasoning is needed.

**`scripts/verify.sh` puts the security gate first and runs it even in `--fast` mode.** Every other step can be skipped for speed; that one cannot. Its output ends by listing what it does *not* cover, so a green run cannot be mistaken for "CI passed".

## Files and Components Touched

| Path | Change |
|---|---|
| `.githooks/pre-push` | Now blocks on the `:id` gate; branch naming stays a warning |
| `scripts/verify.sh` | New — the local stand-in for the pipeline |
| `.prettierignore` | Helm templates excluded (see below) |
| `deploy/helm/README.md` | Reformatted by prettier |
| `MEMORY/DECISIONS.md` | ADR-028 |
| `TASKS/PHASE-0-FOUNDATION.md` | `P0-17` marked deferred with what moved and what was lost |
| `TASKS/PROGRESS.md` | Board status, and `P0-23` no longer blocked on `P0-17` |
| `TASKS/BACKLOG.md` | `DF-10` |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| `P0-17` deferred, not dropped | The DoD is unchanged and unmet; the pipeline is still the target | ADR-028 |
| The `:id` gate blocks on pre-push | Its only caller was going to be CI; without this it enforces nothing | ADR-028 |
| Branch-name check stays non-blocking | A hook that obstructs gets disabled, and then nothing is enforced | — |
| `P0-23` re-pointed at `P0-04` | It depended on `P0-17` for a deploy pipeline that no longer exists; leaving the dependency would have blocked it on a deferred task | — |
| No GitHub Actions workflow written at all | A workflow triggering on an event that never fires is a false signal | ADR-028 |

## Deviations from `docs/`

`docs/DEVOPS/01-CI-CD.md` describes a pipeline that does not exist. The document was **not** amended — it is the target, and it remains accurate as a specification of where this is going. The board and ADR-028 carry the fact that it is unimplemented. This follows the owner's standing instruction not to amend `docs/` for workflow decisions.

## Tests Added

None in the codebase. The hook itself was tested both directions, which is the part that matters — a gate nobody has seen fail is not known to work:

| Case | Method | Result |
|---|---|---|
| Adds an `:id` route, no test | Temporary `probe.controller.ts` with `@Get(':id')`, committed, hook run | **Refused**, exit 1, message names the file and the offending line |
| Same diff plus a test file | Added `probe.spec.ts`, hook re-run | **Passed**, exit 0 |

Both probe commits were then reset and the working tree confirmed clean.

`scripts/verify.sh --fast` runs green across all six steps.

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| Every `:id` endpoint has an IDOR test | `docs/SECURITY/05` (zero tolerance), global DoD item 2 | The gate was made to fire on a real diff and then made to pass — see the table above |

**What is now unverified by anything**, stated plainly because a record that omits this is the kind `MEMORY/README.md` calls worse than silence:

| Gate | Status |
|---|---|
| Integration tests against real Postgres and Redis | Not run automatically |
| Service-layer coverage floor, 80% | Not enforced |
| SAST | Not run |
| Dependency CVE scanning | Not run |
| Reviewer approval before merge | Not enforced |

## Definition of Done Verification

The task's own DoD is **not** met and is not claimed to be — all four items remain unchecked on the card. The global DoD applies to this record and the board update, which are done.

## What Did Not Work

**I reset away my own work.** After testing the hook with a temporary probe controller, I ran `git reset --hard HEAD~2` to remove the probe commits — but I had staged the probe with `git add -A`, which swept `scripts/verify.sh` and the rewritten `.githooks/pre-push` into the same commits. The reset took them with it and both files had to be rewritten.

The lesson is about ordering, not about `-A`: commit the real work **first**, then create the throwaway on top of it. Testing a change by committing scratch files alongside it means the cleanup and the work share a boundary.

**`format:check` was not in my P0-26 pipeline, and it should have been.** The first real run of `scripts/verify.sh` failed on formatting — prettier was parsing the Helm templates as YAML, which they are not:

```
deploy/helm/wedding-invitation/templates/ingress.yaml: SyntaxError:
  Block collections are not allowed within flow collections (1:3)
> 1 | {{- if .Values.ingress.enabled }}
```

That error points at line 1 of a valid Go template and explains nothing. More to the point: **it was already merged to `main`**. I ran lint, typecheck and test before committing `P0-26` and did not run `format:check`, so a broken repository-wide command shipped.

This is the argument for `scripts/verify.sh` existing, made by the thing itself on its first run. A pipeline is not valuable because it is thorough; it is valuable because it runs the checks you would not have thought to run. Fixed by excluding `deploy/helm/*/templates/` in `.prettierignore` — `helm lint` is the right checker for those files, and `deploy/helm/verify.sh` runs it.

## Follow-Ups and Open Questions

- **`P0-17` must be picked up before Phase 3 payment code.** `docs/SECURITY/07` and `P3-16` assume a pipeline that can reject a change. "A reviewer approved it" is not a control that exists in this repository today.
- **`P0-19` (test harness) should add `test:integration` to `scripts/verify.sh`** once there is a Testcontainers setup to run.
- **Dependency CVE scanning has no substitute right now.** `pnpm audit` in `verify.sh` would be a partial one and is worth considering; it was not added here because it would fail the build on advisories with no fix available, and a check that cries wolf gets removed.
- **`P0-23` should wire `deploy/helm/verify.sh` into whatever automation it builds**, per the `P0-26` record.

## What to Watch

**The `--no-verify` escape hatch is documented in the hook's own message.** That was a choice: an undocumented bypass gets found anyway and used silently, while a documented one at least carries the instruction to say so in the record. Watch for a merge to `main` that adds an `:id` endpoint with no test — that is what a bypass looks like from the outside, and `scripts/check-id-endpoint-tests.mjs` can be run by hand against any range to check.

**Hooks are absent on a fresh clone** until `pnpm install` runs the `prepare` script that sets `core.hooksPath`. Anyone who builds without installing dependencies first has no gates at all, and nothing announces that.

**The deferral will get comfortable.** Nothing about the current setup feels broken day to day, which is precisely how a missing coverage floor and missing dependency scanning survive to launch. `DF-10` and the `P0-17` card both carry "revisit before Phase 3" so the trigger is written down rather than remembered.
