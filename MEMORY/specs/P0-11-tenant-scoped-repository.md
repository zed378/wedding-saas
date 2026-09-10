# P0-11 — Feature Spec: Tenant-Scoped Repository Layer

| | |
|---|---|
| **Task** | `P0-11` |
| **Date** | 2026-09-10 |
| **Author** | Claude Code session |
| **Status** | Reviewed |

---

## 1. Goal

A data-access layer where fetching a tenant-owned row **without** an owner filter is not something a developer can do by accident — not discouraged, not caught in review, but absent from the exported surface.

Every `:id` endpoint in Phases 1 through 5 is built on this. Adding it afterwards means auditing every endpoint instead of never writing one wrong.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` | whole file | Zero tolerance; the seven attack surfaces; the admin special case |
| `docs/SECURITY/04-AUTHORIZATION-RBAC.md` | Implementation Principles 1–4, Example Pseudocode | Query-level filter; 404 not 403; `adminFind*` separately named |
| `docs/BACKEND/02-SERVICE-LAYER.md` | Principles | Ownership enforced in the service; constructor injection |
| `docs/API/00-API-STANDARDS.md` | — | 404 for "exists but isn't yours" (ADR-018) |

No contradictions found.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| `docs/SECURITY/05` § 1, 2 | A non-owner cannot reach another user's invitation | `WHERE owner_id = $scope` in the query |
| `docs/SECURITY/05` § 5 | List endpoints filter in SQL, never in the response | `findOwnedList` |
| `docs/SECURITY/05` § 6, 7 | A child is validated against a parent already proven owned — **two steps** | `findOwnedChild`, single query joining both conditions |
| `docs/SECURITY/05` § Special Case | Every ownership bypass is audited | The admin function writes the audit row itself |
| ADR-018 | Non-owner gets 404, never 403 | The repository returns `null`; the two cases are indistinguishable |

## 4. API Contract

Not applicable — no endpoint. This is the layer endpoints will be built on.

## 5. Data Model Impact

None. Reads `invitations` and its children; writes `audit_logs` on the admin path only.

## 6. Authorization

The whole task. Four design decisions:

**Ownership is a query predicate, never a post-fetch check.** `findOwned(id, scope)` issues `WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`. A row that exists but belongs to someone else and a row that does not exist produce the identical result — `null`. The service therefore *cannot* accidentally return 403, because it never learns the difference.

**The scope is a branded type, not a string.** `TenantScope` is constructed only by `tenantScope(userId)`. A bare `string` will not type-check where a scope is required, so passing a slug, an invitation id, or an empty string by mistake is a compile error rather than a silent full-table read.

**Child access is one query, not two.** `findOwnedChild` joins the child to its invitation and applies both conditions at once: `child.invitation_id = :parentId AND invitation.owner_id = :scope`. `docs/SECURITY/05` § 7 asks for two validations; doing them as two round trips invites someone to skip the second.

**The admin bypass writes its own audit row, in the same transaction as the read.** `docs/SECURITY/05` § Special Case says every use MUST be logged. Making the caller responsible means the day someone forgets, the bypass is silent — so the function takes an `AdminBypass { adminId, reason }` and writes `audit_logs` itself. There is no way to obtain the data without leaving the trail.

## 7. Validation and Sanitization

Not this layer's concern. The repository takes already-validated ids.

**One thing it does check**: `deleted_at IS NULL` on every owned read. A soft-deleted invitation is gone as far as its owner is concerned, and ADR-033 makes its slug reusable — returning it would let a deleted invitation shadow a live one.

## 8. State Transitions

None.

## 9. Side Effects

One, deliberate: the admin path writes an `audit_logs` row. Inside the transaction, so a failed read leaves no misleading audit entry and a failed audit write blocks the read.

## 10. Failure Modes

If `audit_logs` cannot be written, the admin read **fails closed** — the caller gets an error rather than the data. `docs/SECURITY/00` § Core Security Principles requires failing closed on anything security-relevant, and an unauditable tenant-isolation bypass is exactly that.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| IDOR on a parent | § 1 | `null` | `returns null when the invitation belongs to someone else` |
| Owner reads own | § 1 | the row | `returns the invitation for its owner` |
| Soft-deleted read | ADR-033 | `null` | `returns null for a soft-deleted invitation` |
| List leaks other tenants | § 5 | only own rows | `returns only the caller's invitations` |
| Cross-tenant child via own parent | § 6, 7 | `null` | `returns null for a child that belongs to another invitation` |
| Cross-tenant child via **another's** parent | § 6, 7 | `null` | `returns null when the parent is not owned` |
| Child id valid, parent id swapped | § 7 | `null` | `refuses a child whose parent id does not match` |
| Admin bypass | Special Case | row returned **and** audit row written | `admin path returns the row and writes an audit entry` |
| Admin bypass unlogged | Special Case | impossible | `admin path fails closed when the audit write fails` |
| Direct table access from a service | § 5 | build fails | `scripts/check-tenant-scope.mjs` |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Integration | Every abuse case above, against a real database with **two seeded users** — a single-user fixture cannot demonstrate isolation |
| Guard | The script fails on a deliberately introduced violation, and passes on the repository itself |

## 13. Observability

The admin bypass is the observable event: one `audit_logs` row per use, carrying `admin_id`, `resource_id` and `reason`. A spike is a support-behaviour signal and a possible compromise signal.

## 14. Open Questions

- **`OQ-17` (denormalized `template_id`) is not resolved here.** The repository loads invitations by id and owner; it does not reconcile `template_id` against `template_version_id`. Still open for `P2-*`.
- **Row-Level Security is not used.** `docs/SECURITY/05` specifies application-level isolation and `P0-06` deliberately left the application role unable to bypass RLS *should it later be added*. Adding RLS now would be a second, unspecified mechanism; the groundwork exists if it is ever wanted.
