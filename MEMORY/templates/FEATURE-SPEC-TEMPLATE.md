# <Task ID> — Feature Spec: <Name>

Written **before** implementation for any task marked `Spec required: Yes` in `TASKS/` — anything touching authentication, authorization, payment, file upload, the public surface, or the data model. Saved as `MEMORY/specs/<task-id>-<slug>.md`.

The point is not ceremony. These are the areas where `docs/` already contains the answer and where getting it wrong is expensive, so this document is mostly an act of reading the specification carefully and writing down what it says, before the code makes an accidental decision instead.

| | |
|---|---|
| **Task** | |
| **Date** | YYYY-MM-DD |
| **Author** | |
| **Status** | Draft / Reviewed / Implemented |

---

## 1. Goal

One paragraph. What a user or another system can do afterwards that it cannot do now.

## 2. Specification Sources

Every `docs/` document this implements, with the specific section. If two of them disagree, say so here and stop — that is a `TASKS/BACKLOG.md` gap, not something to resolve while coding.

| Document | Section | What it dictates |
|---|---|---|
| | | |

## 3. Business Rules Implemented

Rule IDs from `docs/PLAN/02-BUSINESS-RULES.md`, and where each is enforced. These IDs also appear in code comments and test descriptions (`docs/BACKEND/02` § Principles).

| Rule | Statement | Enforced in |
|---|---|---|
| BR-x.x | | |

## 4. API Contract

Exactly as specified in `docs/API/`. Do not invent shapes; if the contract is missing something the feature needs, that is a gap for `BACKLOG.md`.

- Method and path:
- Request schema (with the accepted-field whitelist):
- Success response (per the `docs/API/00` envelope):
- Error cases with codes and status:

## 5. Data Model Impact

Tables read and written, exactly as `docs/DATABASE/` defines them. Any new column, table or index needs an ADR and a `docs/DATABASE/` amendment in the same change.

| Table | Read / Write | Notes |
|---|---|---|

Migration required: yes / no. If yes, is it expand-contract safe (`docs/DEVOPS/08`)?

## 6. Authorization

The section that must never be left vague.

- Who may call this?
- How is ownership enforced, and **at which layer**? (Query-level filter through the `P0-11` repository layer, per `docs/SECURITY/04` § Implementation Principles.)
- What does a non-owner receive? (404, per `docs/SECURITY/05`.)
- Are there nested ids? For each, how is its relationship to the parent validated? (`docs/SECURITY/05` § Attack Surfaces 6 and 7.)
- Is there an admin path? If so, is it separately named and audited?

## 7. Validation and Sanitization

- Structural validation schema (controller layer, `docs/BACKEND/03`):
- Business validation (service layer, and what it depends on):
- Which fields are free text, and therefore sanitized before storage:
- Which fields are explicitly **not** accepted from the client:

## 8. State Transitions

If this changes an invitation, order or payment status: the transition, its precondition, and where the history row is written (`docs/PLAN/06`, `docs/DATABASE/04`).

## 9. Side Effects

Events emitted, jobs enqueued, cache invalidated, notifications sent. For each: does it happen inside or after the transaction, and why? (An event emitted before commit can describe something that never happened.)

## 10. Failure Modes

What happens when the database is down, Redis is down, the provider times out, the job fails permanently. Fail open or fail closed, and the reasoning — `docs/SECURITY/00` § Core Security Principles says fail closed on anything security-relevant.

## 11. Abuse Cases

From `docs/SECURITY/01-THREAT-MODEL.md` and the relevant `docs/SECURITY/` document. Every row becomes an automated test.

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit | |
| Integration | |
| E2E | |
| Security | |

## 13. Observability

What is logged (with redaction), what is measured, and what would alert if this broke in production.

## 14. Open Questions

Anything unresolved. If one blocks implementation, it belongs in `TASKS/BACKLOG.md` and the task stays `BLOCKED` rather than proceeding on a guess.
