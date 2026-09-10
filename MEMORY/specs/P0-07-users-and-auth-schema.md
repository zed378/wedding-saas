# P0-07 — Feature Spec: Users and Auth Support Schema

| | |
|---|---|
| **Task** | `P0-07` |
| **Date** | 2026-09-10 |
| **Author** | Claude Code session |
| **Status** | Reviewed — one contradiction found, resolved as ADR-031 |

---

## 1. Goal

The tables that every authenticated request in Phase 1 depends on exist, with their constraints enforced by the database rather than by application discipline: account identity, notification preferences, refresh-token rotation state, single-use email and password-reset tokens, and admin TOTP enrolment with recovery codes.

No API and no service code — this is schema only. What it buys is that `P1-01` onwards cannot accidentally invent a different shape.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/DATABASE/02-USERS.md` | whole file | Six tables, column for column |
| `docs/DATABASE/00-DATA-MODEL.md` | Principles, Naming | `deleted_at` on `users`; `snake_case` plural; UUID `id`; varchar + CHECK for enums |
| `docs/SECURITY/03-AUTHENTICATION-SECURITY.md` | Password Reset, Google OAuth, Admin Session | Reset token 1 hour, single use; TOTP mandatory for admin |
| `docs/API/01-AUTHENTICATION.md` | Google OAuth | A user is matched or registered by **verified Google email** |
| `docs/API/02-USER-API.md` | `DELETE /users/me` | Account deletion is a soft delete |
| `docs/SECURITY/09-PRIVACY-DATA-PROTECTION.md` | line 16 | Soft delete, then hard delete after a retention period |
| `docs/DEVOPS/06-LOGGING.md` | Mandatory Redaction | Nothing in these tables may be logged |

### Contradiction found

`docs/DATABASE/02-USERS.md` defines both:

```sql
email VARCHAR(255) NOT NULL UNIQUE,
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
```

These cannot both be intended. A column-level `UNIQUE` constrains **every** row, including soft-deleted ones, which makes the partial index unreachable — and it contradicts the `P0-07` card's own stated goal, "the partial unique index that makes soft-deleted accounts free their email", as well as the soft-delete-then-hard-delete retention window in `docs/SECURITY/09`.

Under the doc as literally written, a user who deletes their account can never register again with the same address until the hard delete runs, days or weeks later, and the failure would surface as a duplicate-key error rather than anything a user could understand.

**Resolved as ADR-031**: the partial unique index wins, the column-level `UNIQUE` is dropped, and `docs/DATABASE/02-USERS.md` is amended in the same change (the `P0-07` DoD requires exactly this).

## 3. Business Rules Implemented

None directly — this task adds no behaviour. The rules it makes enforceable later:

| Rule | Statement | Enforced in |
|---|---|---|
| BR-9 / BR-9.1 | Soft delete precedes hard delete after a retention period | `users.deleted_at` + the partial unique index; the sweep is `P4-*` |
| `docs/SECURITY/03` | TOTP mandatory for `admin`/`super_admin` | `user_mfa_factors`; enforcement is `P5-02` |

## 4. API Contract

Not applicable. No endpoint is added by this task.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `users` | new | `password_hash` nullable — OAuth-only accounts have none |
| `user_notification_preferences` | new | PK **is** `user_id`, so the 1..1 is structural, not a convention |
| `refresh_tokens` | new | `token_hash` only; a database read must not yield a usable credential |
| `user_tokens` | new | Email verification and password reset; hashed, single use via `used_at` |
| `user_mfa_factors` | new | `secret_encrypted BYTEA`, application-layer encrypted |
| `user_recovery_codes` | new | Hashed, single use |

**The card names three tables; the document defines six.** `user_tokens`, `user_mfa_factors` and `user_recovery_codes` are in the same file under "Auth support", and the DoD says the schema must match `docs/DATABASE/02` exactly. Implementing three would leave `P1-04` (email verification) and `P5-02` (admin TOTP) to add tables in a task that is not about schema. All six ship here.

Migration required: **yes**. Expand-contract safe: trivially — every statement is `CREATE`, nothing is dropped or altered, so `docs/DEVOPS/08` phase 1 is the whole migration.

## 6. Authorization

No endpoint, so no request-time authorization. Two database-level properties this task is responsible for:

- **The application role cannot alter these tables.** Migrations run as `wedding_owner`; the API connects as `wedding_app`, which holds `SELECT/INSERT/UPDATE/DELETE` and no DDL (`P0-06`, `deploy/postgres/init/01-app-role.sql`). Verified in `scripts/db-roundtrip.sh`.
- **Every child table cascades from `users`.** `ON DELETE CASCADE` on all five, so a hard delete cannot leave an orphaned refresh token that still authenticates, or an orphaned TOTP secret.

Ownership scoping for the `:id` endpoints that read these tables is `P0-11` and is out of scope here. Nothing in this task should be read as satisfying `docs/SECURITY/05`.

## 7. Validation and Sanitization

Database-level only:

- `role` — `CHECK (role IN ('user','admin','super_admin'))`. A typo'd role must not become a new privilege tier by accident.
- `status` — `CHECK (status IN ('active','suspended'))`.
- `user_tokens.type` — `CHECK (type IN ('email_verification','password_reset'))`.
- `user_mfa_factors.type` — `CHECK (type IN ('totp'))`.
- Lengths exactly as documented: `email` 255, `full_name` 100, `phone` 20, `role`/`status`/`oauth_provider` 20, hashes 255.

No free text renders publicly from these tables, so sanitization is not this task's concern. `full_name` does reach a public page via the invitation, but through `invitation_people` (`P0-09`), not from here.

## 8. State Transitions

None. No status column here writes history.

## 9. Side Effects

None. A migration.

## 10. Failure Modes

The migration is a single transaction (Drizzle wraps it), so a failure part-way leaves no tables and no journal row — the next run starts clean. There is no partial-schema state to recover from.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Two active accounts on one email | `docs/API/01` user enumeration / identity | Second insert rejected | `rejects a duplicate email among active users` |
| Deleted account permanently blocks its own email | ADR-031, `docs/SECURITY/09` | Re-registration succeeds after soft delete | `frees the email once the first account is soft-deleted` |
| Privilege escalation by writing an unknown role | `docs/SECURITY/04` | CHECK rejects | `rejects a role outside the allowed set` |
| Refresh token outlives its user | `docs/SECURITY/03` | Cascade removes it | `deletes refresh tokens when the user is hard-deleted` |
| A token replayed after use | `docs/DATABASE/02` single-use | `used_at` set; app enforces. Schema provides the column and the partial index | `keeps only unused tokens in the partial index` |
| Two confirmed TOTP factors on one account | `docs/DATABASE/02` | Unique index on `(user_id, type) WHERE confirmed_at IS NOT NULL` rejects the second | `allows many unconfirmed factors but only one confirmed` |
| Plaintext secret recoverable from a dump | `docs/DATABASE/02` | Column is `BYTEA`, encrypted by the application | Not testable at schema level — noted, enforced in `P5-02` |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit | None meaningful — there is no code, only DDL. Asserting the migration text would test the file against itself |
| Integration | Every abuse case above, against a real PostgreSQL 18. **The constraints must be proven by their failure**, not by reading the migration: a `CHECK` that was never applied looks identical to one that was, until it is violated |
| E2E | Not applicable |
| Security | Cascade behaviour and the partial unique index are the security-relevant ones and are covered above |

`P0-19` owns the general test harness, which does not exist yet. These run as a separate `test:integration` command against a running container, and **fail loudly rather than skip** when no database is reachable — a suite that quietly skips is worse than no suite, because the board says it passed.

## 13. Observability

Nothing runtime. `docs/DEVOPS/06` § Mandatory Redaction covers every column here — `password_hash`, `token_hash`, `code_hash` and `secret_encrypted` must never reach a log. That is enforced by the logger in `P0-12`, not by this task; the spec records it so `P0-12` has the list.

## 14. Open Questions

- **`idx_users_oauth` is not unique**, so two rows could share `(oauth_provider, oauth_subject_id)`. The specified flow matches by verified Google **email** (`docs/API/01`), so it cannot arise through the documented path, and adding an unspecified unique constraint could break account-linking behaviour that has not been designed yet. Left exactly as documented and raised as `OQ-15` rather than decided here.
- **Email reuse after soft delete has a subtle hazard**: any query that looks a user up by email *without* filtering `deleted_at IS NULL` could match the deleted account instead of the live one. The index makes the correct query the natural one, but it does not force it. This belongs in `P0-11`'s repository layer as a rule.
