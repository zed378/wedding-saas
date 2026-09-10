# P0-14 — Feature Spec: Audit Log and Status History Writers

| | |
|---|---|
| **Task** | `P0-14` |
| **Date** | 2026-09-10 |
| **Author** | Claude Code session |
| **Status** | Reviewed |

---

## 1. Goal

Two services that make "log the transition, do not merely mutate it" structural rather than remembered. After this, a status change without a history row, or an admin action without an audit row, is not something a developer can express.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/DATABASE/10-AUDIT-LOGS.md` | whole file + Policy | Append-only; every admin mutation writes a row "before/within the same transaction"; trimmed state snapshots |
| `docs/DATABASE/04-INVITATIONS.md` | Notes | Every status transition writes history, **at the service layer, not a trigger**, so `changed_by`/`reason` carry application context |
| `docs/PLAN/06-INVITATION-LIFECYCLE.md` | State Machine, Transition Rules | The legal transitions and who may perform them |
| `docs/API/04-INVITATION-API.md` | line 11 | `DELETE /invitations/:id` is a soft-delete |
| ADR-019 | — | A refund returns the invitation to `draft`, from any state |
| `docs/DEVOPS/06` | Mandatory Redaction | What must not reach a stored snapshot |

### One gap between two documents

`docs/PLAN/06`'s state diagram has no edge into `soft_deleted` except from `expired` after 90 days. `docs/API/04` offers `DELETE /invitations/:id` as a soft-delete, which a user may call at any time.

These are not in conflict — the diagram draws the *automatic* lifecycle, the API adds an explicit user action — but the transition table has to carry both or the endpoint cannot work. Encoded as `* → soft_deleted`, allowed to an owner or an admin, and noted here so the next reader does not think it was invented.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| `docs/PLAN/06` | `pending_payment → paid` only via the payment webhook | `SYSTEM` actor required for that edge |
| `docs/PLAN/06` | `published → expired` only by the scheduled job | `SYSTEM` actor required |
| `docs/PLAN/06` | Backward transitions are admin-only **and must include a reason** | `ADMIN` actor + non-empty reason enforced |
| ADR-019 | A refund sets `draft` from any state | `* → draft` allowed to `ADMIN` with a reason |
| BR-1.2 | A user acts only on their own invitation | Ownership is `P0-11`'s; this layer takes an already-authorised id |
| `docs/DATABASE/10` | Audit rows are append-only and atomic with their change | `record()` requires a transaction handle |

## 4. API Contract

Not applicable. Two services.

## 5. Data Model Impact

Writes `invitation_status_history` and `audit_logs`; updates `invitations.status`. No migration.

## 6. Authorization

Not this layer's job, and that boundary matters: the status service takes an invitation id that `P0-11` has already proven the caller owns. Duplicating the ownership check here would create a second place for it to be wrong.

What this layer *does* enforce is **who may perform which transition** — a different question from *whose invitation it is*. `pending_payment → paid` requires the `SYSTEM` actor even for an admin, because `docs/PLAN/06` says only the verified webhook may make it and `docs/SECURITY/07` says payment status is server-decided.

## 7. Validation and Sanitization

`before_state`/`after_state` are trimmed before storage. `docs/DATABASE/10` § Policy: "store only the relevant fields' snapshots (not the entire row if it contains highly sensitive data) — avoid unnecessarily duplicating bank account data".

The mechanism reuses `P0-12`'s redactor rather than a second list. A bank account number that must not reach a 90-day log certainly must not reach a **2-year** audit table, and maintaining two lists guarantees they diverge.

## 8. State Transitions

The whole task. Encoded as an explicit map; anything absent is rejected with a `BusinessRuleError`.

## 9. Side Effects

Each service writes exactly one row per call, inside the caller's transaction.

## 10. Failure Modes

**Fails closed.** If the history or audit insert fails, the transaction aborts and the status change does not happen. An audit row that commits when the action rolled back is a lie; a status change that commits without its history row is worse, because the invitation is then in a state nobody can explain.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Status changed with no history row | `docs/DATABASE/04` | Not expressible; guard script fails the build | `check-status-writes.mjs` |
| History row survives a rolled-back change | `docs/DATABASE/10` | Both roll back | `writes no history row when the transaction rolls back` |
| A user marking their own invitation `paid` | `docs/PLAN/06`, `docs/SECURITY/07` | Rejected | `refuses pending_payment -> paid from a user` |
| An illegal jump, e.g. `draft → published` | `docs/PLAN/06` | Rejected | `rejects a transition the state machine does not allow` |
| A backward transition with no reason | `docs/PLAN/06` | Rejected | `refuses a backward transition without a reason` |
| Bank account number copied into an audit row | `docs/DATABASE/10` § Policy | Redacted | `redacts sensitive fields from before/after state` |
| Audit row written outside a transaction | `docs/DATABASE/10` | Not expressible — the method requires a `tx` | (type-level) |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Integration | Every abuse case, against a real database — a rollback test is meaningless without one |
| Guard | The script fails on a deliberately introduced direct status write |

## 13. Observability

A status transition and an admin bypass are both worth a log line at `info`/`warn` with the `request_id` from `P0-12`. The audit table is the durable record; the log is what makes it findable during an incident.

## 14. Open Questions

- **No `hard_deleted` status exists**, and correctly so — `docs/PLAN/06` shows it as an outcome, not a state, and `docs/DATABASE/04`'s CHECK omits it. The row is deleted rather than marked. The sweep is `P4-*`.
- **Nothing yet calls either service.** `P1-*` and `P3-*` do. The guard script is what stops something writing `status` directly in the meantime.
