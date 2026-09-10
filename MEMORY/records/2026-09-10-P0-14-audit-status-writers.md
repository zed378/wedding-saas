# P0-14 — Audit log and status history writers

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-14 |
| **Phase** | Phase 0 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-14-audit-status-writers` |
| **Spec** | [`MEMORY/specs/P0-14-audit-and-status-writers.md`](../specs/P0-14-audit-and-status-writers.md) |
| **Status** | Completed |

---

## What Changed

Two services that make an unrecorded change inexpressible: `AuditLogService`, which can only write inside a caller's transaction, and `InvitationStatusService`, which is now the only path that writes `invitations.status` — enforced by a build guard. 19 integration tests.

## Why

`docs/DATABASE/04` § Notes: every status transition writes an `invitation_status_history` row, **at the service layer rather than a database trigger**, so `changed_by` and `reason` carry application context. A trigger would guarantee the row exists but could not say who caused it or why — and "the status changed at 03:14 and nobody knows why" is the exact question an audit trail exists to answer.

## How

**The audit service takes a transaction handle and cannot open one.** `record(tx, entry)` — a caller physically cannot record an action and then have that action fail separately. An audit row that commits when the change rolled back is a false record, and the worst kind: indistinguishable from a true one.

**The status service is the only writer, and a script enforces it.** `scripts/check-status-writes.mjs` fails the build on a Drizzle `.set({ status })` against `invitations` or raw `UPDATE invitations SET status` anywhere outside the service. The guarantee is only worth its exclusivity: one direct update in a hotfix produces an invitation whose journey nobody can reconstruct, and the diff looks like two lines of obvious code.

**The state machine is an allowlist.** Every edge in `docs/PLAN/06` plus the two other documents add — the refund edge from ADR-019 and the `DELETE /invitations/:id` soft-delete from `docs/API/04`. Anything absent is rejected, so a transition nobody designed cannot happen by accident.

**Some edges are reserved to `SYSTEM`, including against admins.** `pending_payment → paid` is SYSTEM-only: `docs/PLAN/06` allows it solely through validated webhook processing and `docs/SECURITY/07` makes payment status server-decided. An admin who can mark an order paid by hand can grant a free product — a fraud path wearing a helpful hat.

**The row is locked `FOR UPDATE` for the transaction.** Without it, two concurrent requests both read `paid`, both decide their transition is legal, and both write — producing two history rows describing incompatible journeys. The `UPDATE ... WHERE status = from` is a second guard behind the lock.

**Snapshot trimming reuses `P0-12`'s redactor.** `docs/DATABASE/10` § Policy says not to duplicate bank account data into the audit table. A value that must not sit in a 90-day log certainly must not sit in one with **2-year** retention, and maintaining a second list guarantees the two drift.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/shared/audit/audit-log.service.ts` | Transaction-scoped, redacting |
| `backend/api/src/shared/invitation-status/invitation-status.service.ts` | The state machine and the only status writer |
| `backend/api/src/shared/db/transaction.ts` | The `Transaction` type that makes "inside a transaction" a compile-time requirement |
| `backend/api/src/shared/audit/audit.module.ts` | Global module |
| `backend/api/src/app.module.ts` | Wired |
| `scripts/check-status-writes.mjs` | The guard |
| `scripts/verify.sh`, `.githooks/pre-push`, `package.json` | Guard wired in, blocking |
| `backend/api/test/integration/audit-status.itest.ts` | 19 tests |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| `record()` requires a `tx` parameter | A method that needs a transaction cannot be called outside one | — |
| The status service is the sole writer, guarded by a script | Convention lasts until the first hotfix | — |
| Transitions are an allowlist | An undesigned transition should be impossible, not merely unusual | — |
| `pending_payment → paid` is SYSTEM-only, admins included | An admin who can grant `paid` can grant a free product | — |
| `SELECT ... FOR UPDATE` before deciding | Two concurrent transitions would write incompatible history | — |
| Trimming reuses the `P0-12` redactor | Two lists of sensitive keys would drift within a phase | — |
| Errors do not say which actor *would* be allowed | Internal policy; "an admin could do this" invites the next request | — |

## Deviations from `docs/`

None, but one gap between two documents is worth naming: `docs/PLAN/06`'s state diagram has no edge into `soft_deleted` except the 90-day sweep from `expired`, while `docs/API/04` offers `DELETE /invitations/:id` as a soft-delete at any time. These are not in conflict — the diagram draws the automatic lifecycle, the API adds an explicit user action — but the transition table needs both or the endpoint cannot work. Encoded as `* → soft_deleted` for `USER` and `ADMIN`.

## Tests Added

19 integration tests; 169 across seven suites.

| Group | Cases |
|---|---|
| State machine | one history row per transition, with a non-empty reason; illegal jump rejected; same-state rejected; **`pending_payment → paid` refused for USER and for ADMIN**, allowed for SYSTEM with a null `changed_by`; `published → expired` refused for a user; unpublish goes to `paid`, not `draft` |
| Backward transitions | admin refund `published → draft` (ADR-019); **refused without a reason**, and with a whitespace-only one; refused for a user; user soft-delete works from **four** states; `soft_deleted` is terminal |
| Atomicity | **no history row survives a rolled-back transaction**; a failing history insert leaves the status unchanged; unknown invitation is a `NotFoundError` |
| Audit | row written inside the caller's transaction; **nothing written when it rolls back**; sensitive fields redacted while non-sensitive context survives |

**Mutation-checked**, both catching the right test:

| Mutation | Result |
|---|---|
| Allowed `ADMIN` on `pending_payment → paid` | `refuses pending_payment -> paid from an ADMIN too` failed |
| Removed the `reasonRequired` check | `refuses a backward transition without a reason` failed |

The guard was tested both ways: a clean tree passes (32 files), and a probe file doing `db.update(invitations).set({ status })` fails with an explanation.

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| Payment status is server-decided only | `docs/SECURITY/07`, `docs/PLAN/06` | Two tests: USER and ADMIN both refused; mutation-checked |
| Every status change is recorded | `docs/DATABASE/04` § Notes | One row per transition asserted; the guard makes any other path fail the build |
| An audit row cannot outlive a failed action | `docs/DATABASE/10` | Rollback tests on both services |
| A refund is attributable | `docs/PLAN/06` | Reason required, mutation-checked |
| Bank data does not reach a 2-year table | `docs/DATABASE/10` § Policy | `account_number` stored as `******7890`; the raw value asserted absent |
| System transitions carry no fake actor | `docs/DATABASE/04` | `changed_by` null for SYSTEM, reason names it instead |

## Definition of Done Verification

- [x] `invitations.status` cannot be written except through the service — guard in place, blocking, tested both ways
- [x] Audit and history rows commit atomically with their change — proven by three rollback tests
- [x] Sensitive fields never reach `before_state`/`after_state`

## What Did Not Work

**A shadowing bug in the transition lookup, found by a test I nearly did not write.** The original lookup was `TRANSITIONS[from].find(...) ?? FROM_ANY.find(...)`. From `expired`, the state-specific `soft_deleted` rule (SYSTEM, the 90-day sweep) matched first and the from-any rule (USER, an explicit delete) was never consulted — so a user could delete an invitation in every state **except** `expired`, which is the state they are most likely to want gone.

The test that caught it loops over four starting states rather than checking one. A single-state test would have passed and the bug would have surfaced in Phase 1 as "delete doesn't work sometimes".

The fix collects *all* rules for an edge and picks one that permits the actor. One edge can legitimately have several rules, because it happens for several reasons.

**Three layers of escaping mangled a backslash in the guard script.** `/\\/g` inside a bash heredoc inside a Python string came out as `/\/g` — a syntax error — and two attempts to repair it with more escaping made it worse. Sidestepped by importing `sep` from `node:path` and using `split(sep).join("/")`, which needs no backslash literal at all. The general lesson: when escaping is fighting through more than two layers, change the approach rather than the escaping.

**The P0-11 warning came true one task later.** That record ended with: "`ALLOWED` in the guard is a list that will be asked to grow. Every entry is a module permitted to query tenant tables directly. Adding one is the cheapest possible way to reintroduce the hole, and it will look like a small config change."

It was asked for by the next task. `InvitationStatusService` needs `SELECT ... FOR UPDATE` and `UPDATE` on `invitations` inside one transaction, which the read-oriented tenancy repository does not expose — so `shared/invitation-status/` is now on the allowlist.

**It is a genuine hole and it is documented as one**, at both sites. The status service takes an invitation id and does **not** check ownership; it assumes the caller proved it through `P0-11`. A caller that forgets will transition someone else's invitation and neither guard will object. The alternative — adding write methods to `InvitationRepository` — would have widened the one file that is supposed to stay small and heavily read, which seemed worse. But it is a trade, not a clean answer.

## Follow-Ups and Open Questions

- **Nothing calls either service yet.** `P1-*` creates invitations, `P3-*` handles payment, `P4-*` runs the expiry sweep. The guard is what stops something writing `status` directly in the meantime.
- **`recordCreation` is untested** because nothing creates invitations through a service yet. It is three lines and takes a `tx`; `P1-09` should cover it.
- **The guard is a text check and can be evaded** — a table referenced through a variable, or SQL assembled from fragments. It is aimed at the ordinary author doing the natural thing, not a determined one.
- **Nothing enforces that callers of `transition()` proved ownership first.** The type system could: a `TenantScope`-carrying "proven owned" token, the way `P0-11` used a branded type. Worth considering in `P1-09`, when the first real caller exists and the shape of the need is visible.
- **`AuditLogService` has no `ipAddress` source.** The column exists and the parameter is plumbed; `P1-06` should attach the request IP when it establishes the authenticated context.

## What to Watch

**The SYSTEM-only rule on `pending_payment → paid` will be questioned by support.** The scenario is real: a customer says they paid, the webhook did not arrive, and an admin wants to fix it. The correct fix is a server-initiated provider query that produces a genuine SYSTEM transition (`docs/SECURITY/07` allows exactly that), not widening the rule. Widening it is a one-word change to an array.

**The `FOR UPDATE` lock is invisible in a diff.** Removing `.for("update")` looks like removing a redundancy — the `WHERE status = from` guard is still there, and tests pass either way, because a race needs concurrency to show. The comment says why; nothing else does.

**Redaction of snapshots means the audit table cannot answer "what was the old account number".** That is deliberate and follows `docs/DATABASE/10`, but someone investigating a gift-diversion incident (risk R16) will want exactly that. The answer is the masked suffix plus the fact that a change occurred and who made it — which is what R16's mitigation actually requires.
