# P1-06 — Feature Spec: Auth, Role and Ownership Middleware

| | |
|---|---|
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-06 |
| **Date** | 2026-09-12 |
| **Author** | Claude Code session |
| **Status** | Draft |

---

## 1. Goal

The three names `docs/SECURITY/04` mandates exist and work, ownership lives where no
caller can route around it, and writing the IDOR test for a new endpoint costs one line —
because a mandatory test that is expensive is a mandatory test that gets skipped.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/SECURITY/04` | Mandatory Middleware | The three names and their signatures, `requireOwnership(resourceLoader)` included |
| `docs/SECURITY/04` | Implementation Principles 1–4 | A role check is never sufficient for `:id`; ownership in the service; the filter in the query; admins use a separately-named path |
| `docs/SECURITY/04` | Example Pseudocode + Note | 404 for "exists but isn't yours" |
| `docs/SECURITY/05` | §§ 1, 4, 5, 6, 7, Special Case | The attack surfaces and the admin bypass |
| `docs/PLAN/03` | — | `guest → user → admin → super_admin` |

**No contradictions.** `P0-11` already implements principles 3 and 4 and the 404 rule;
this task adds the two request-level guards, the ownership helper the documented name
refers to, and the test helper.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| — | A suspended or deleted user is not authenticated, whatever their token says | `requireAuth` via `SessionService` |
| — | A role grants a **category** of access, never a specific resource | `requireRole` is documented and tested as insufficient alone |
| — | "Not yours" is indistinguishable from "does not exist" | `requireOwnership`, which only ever sees `null` |

## 4. API Contract

Not an endpoint. Three exports, named exactly as `docs/SECURITY/04` writes them:

```ts
requireAuth()                       // a Nest guard; resolves and injects the current user
requireRole(...roles)               // a Nest guard; role must be one of those listed
requireOwnership(resourceLoader)    // a SERVICE-LAYER function; null -> NotFoundError
```

`requireOwnership` is deliberately **not** a guard. The document writes all three together
under "Mandatory Middleware", but its own Implementation Principle 2 says ownership is
checked in the service "so no code path can accidentally bypass it when the service is
called from elsewhere (e.g., from a job/worker)". A guard only runs on an HTTP request; a
guard is therefore the one shape this function must not have. The name is kept because the
document mandates the name.

## 5. Data Model Impact

None. No migration.

## 6. Authorization

This *is* the authorization. The properties that must hold:

- `requireAuth` re-reads the user row on every request (`P1-03`'s `SessionService`), so
  suspension takes effect immediately rather than at token expiry.
- `requireRole` reads the role from the **resolved user**, which came from the database —
  never from the token's claim.
- `requireOwnership` receives a loader that has already applied `WHERE owner_id = :scope`.
  It never sees a row it has to judge, so it cannot judge one wrongly; it only ever turns
  `null` into `NotFoundError`.

## 7. Validation and Sanitization

Not applicable.

## 8. State Transitions

None. The admin bypass writes an `audit_logs` row, which `P0-11` already does inside the
same transaction as the read.

## 9. Side Effects

| Effect | When | Why there |
|---|---|---|
| `authz.idor_attempt` security event | A non-owner is refused a specific resource | `docs/SECURITY/05` — a single 404 is noise, a pattern of them is an attack |

## 10. Failure Modes

| Failure | Behaviour |
|---|---|
| No token, bad token, expired token | `401 UNAUTHENTICATED` |
| Suspended or deleted user with a valid token | `401`, identical |
| Authenticated but wrong role | `403 FORBIDDEN`. Safe: a role is a property of the caller and reveals nothing about a resource |
| Authenticated, right role, someone else's resource | **`404`**, empty body |
| Authenticated, right role, resource does not exist | **`404`**, identical |
| A service called with no scope | A compile error — `TenantScope` is branded and cannot be omitted |

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| IDOR via path parameter | `docs/SECURITY/05` § 1 | 404, empty body | "a non-owner gets 404 and no data" |
| 403/404 discrepancy reveals existence | `docs/SECURITY/04` Note | Byte-identical responses | "'absent' and 'not yours' are the same response" |
| Service called from a job with no user context | `docs/SECURITY/04` § 2 | No implicit bypass; scope is required | "the service cannot be called without a scope" |
| Role check mistaken for an ownership check | `docs/SECURITY/04` § 1 | A `user` role passes `requireRole` and still cannot reach another user's row | "requireRole alone does not protect a resource" |
| Admin reads another tenant's data | `docs/SECURITY/05` Special Case | Allowed, audited, every time | "the admin bypass writes an audit row every time" |
| Token claims `role: admin` | `docs/SECURITY/01` | Ignored; the row decides | "requireRole reads the database role, not the token's" |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Integration | the guards against a real user row; ownership through the service; the admin bypass and its audit row |
| **The helper itself** | `expectIdorSafe` must fail when given a deliberately insecure loader — a test helper that cannot fail is a helper that proves nothing |
| Mutation | make `findOwned` drop its owner predicate and confirm every `expectIdorSafe` call fails |

## 13. Observability

`authz.idor_attempt` with the acting user id, the resource type and the resource id. The
id is included deliberately: the resource is not the attacker's, so it is not their data
being logged, and without it a reviewer cannot tell enumeration from a stale bookmark.

## 14. Open Questions

- **`requireOwnership` takes a loader, not a resource.** `docs/SECURITY/04` writes
  `requireOwnership(resourceLoader)`, which is the shape that makes principle 3 possible:
  a function receiving a resource would imply it had already been fetched unscoped.
- **Nothing calls these yet.** `P1-09` is the first `:id` endpoint. This task's value is
  entirely in what it makes cheap, so the helper and its self-test matter more than the
  guards.
