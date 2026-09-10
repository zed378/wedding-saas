# P0-07 — Users and auth schema

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-07 |
| **Phase** | Phase 0 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-07-users-auth-schema` |
| **Spec** | [`MEMORY/specs/P0-07-users-and-auth-schema.md`](../specs/P0-07-users-and-auth-schema.md) |
| **Status** | Completed |

---

## What Changed

Six tables — `users`, `user_notification_preferences`, `refresh_tokens`, `user_tokens`, `user_mfa_factors`, `user_recovery_codes` — as `0001_users_and_auth.sql`, with their `updated_at` triggers and a down migration. 22 integration tests prove the constraints by violating them, and an integration test runner exists that fails rather than skips when no database is reachable.

One contradiction in `docs/DATABASE/02-USERS.md` was found and resolved (ADR-031), with the document amended in the same commit.

## Why

Everything in Phase 1 authenticates against these tables. A wrong constraint here is not a bug in one endpoint, it is a wrong assumption shared by every endpoint written afterwards.

## How

**Read the document before writing the schema, and found it disagreeing with itself.** `docs/DATABASE/02` declared `email VARCHAR(255) NOT NULL UNIQUE` *and* `CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL`.

Those cannot both be in force. A column-level `UNIQUE` covers every row including soft-deleted ones, which makes the partial index unreachable — an index that can never fire. Worse, they encode opposite intentions: the partial predicate exists so a deleted account releases its address, and the column constraint holds it until the row is physically gone, which `docs/SECURITY/09` says is a retention period later. The task card states the intent plainly ("the partial unique index that makes soft-deleted accounts free their email"), so the partial index wins. ADR-031, and `docs/DATABASE/02` amended.

**The card names three tables; the document defines six.** `user_tokens`, `user_mfa_factors` and `user_recovery_codes` sit in the same file, and the DoD says the schema must match `docs/DATABASE/02` exactly. Shipping three would leave `P1-04` (email verification) and `P5-02` (admin TOTP) adding tables from tasks that are not about schema. All six here.

**The generated SQL was reviewed line by line against the document.** That review is the reason ADR-007 chose Drizzle over Prisma — partial unique indexes, `CHECK` constraints and exact `varchar` lengths all survive into reviewable SQL. It matched, apart from the deliberate ADR-031 difference.

**Triggers were appended by hand**, because drizzle-kit does not generate them. Only `users` and `user_notification_preferences` carry `updated_at`; the other four are written once and then marked spent, so "when did this row last change" has no meaning worth storing.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/infra/db/schema/users.ts` | Six tables, each constraint carrying its reason |
| `backend/api/src/infra/db/schema/index.ts` | Exports the new module |
| `backend/api/migrations/0001_users_and_auth.sql` | Generated, then triggers appended |
| `backend/api/migrations/0001_users_and_auth.down.sql` | Children before parent |
| `backend/api/test/integration/users-schema.itest.ts` | 22 tests |
| `backend/api/vitest.integration.config.mts` | Separate runner; no parallelism across files |
| `backend/api/vitest.config.mts` | Notes why `*.itest.ts` is excluded |
| `backend/api/package.json` | `test:integration` |
| `docs/DATABASE/02-USERS.md` | **Amended** per ADR-031 |
| `MEMORY/specs/P0-07-users-and-auth-schema.md` | Written before the code |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Email unique among active accounts only | The two documented rules were incompatible; the partial index matches the stated intent and the retention model | ADR-031 |
| All six tables, not the three the card names | The DoD says match `docs/DATABASE/02` exactly; the other three are auth support in the same file | — |
| `idx_users_oauth` left non-unique | `docs/API/01` matches OAuth by verified email, not subject id. Adding an unspecified constraint could break account linking | raised as `OQ-15` |
| No `CHECK` on token expiry durations | 24h and 1h are policy (`docs/SECURITY/03`); a CHECK would make changing policy a migration | — |
| `updated_at` triggers on two tables only | The other four are write-once-then-mark-spent | — |
| Integration tests fail, never skip, without a database | A skipped schema suite reports green for constraints nobody checked | — |

## Deviations from `docs/`

**One, recorded and corrected in the same change**: the column-level `UNIQUE` on `users.email` (ADR-031). `docs/DATABASE/02-USERS.md` now says uniqueness comes from `idx_users_email` and explains why the two cannot coexist.

Nothing else. Every column, type, default, length, `CHECK` and index matches the document.

## Tests Added

22 integration tests in `test/integration/users-schema.itest.ts`, run with `pnpm --filter @wi/api test:integration`.

| Group | Cases |
|---|---|
| Email uniqueness | duplicate among active rejected; email freed after soft delete; a **third** active account still refused |
| CHECK constraints | unknown `role` rejected; all three documented roles accepted; unknown `status` rejected; defaults correct and `password_hash` null |
| Cascades | refresh tokens removed with the user; all four child tables cascade; a token for a non-existent user refused |
| `user_tokens` | unknown `type` rejected; duplicate `token_hash` across users rejected |
| `user_mfa_factors` | many unconfirmed factors allowed, only one confirmed; secret stored as `bytea` |
| `updated_at` trigger | real change bumps, genuine no-op does not — both tables |
| Privilege separation | application role refused `ALTER TABLE`, still able to `SELECT` |

**The tests were mutation-checked**, because a constraint test that passes proves nothing until you have seen it fail:

| Mutation | Result |
|---|---|
| `DROP INDEX idx_users_email` | 2 tests failed — duplicate-email and third-account |
| `DROP CONSTRAINT users_role_check` | 1 test failed — unknown role accepted |
| `DROP TRIGGER users_set_updated_at` | 1 test failed — no-op/real-change distinction lost |

All three restored afterwards, and the full suite re-run green.

The `0001` migration also passes `scripts/db-roundtrip.sh`: 2 migrations up, both down, both up again.

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| A role outside the allowed set cannot exist | `docs/SECURITY/04` | `rejects a role outside the allowed set`, mutation-checked |
| No credential recoverable from a database read | `docs/SECURITY/03`, `docs/DATABASE/02` | Only `*_hash` columns and `secret_encrypted BYTEA`; `stores the secret as bytea, not text` asserts the type |
| A refresh token cannot outlive its user | `docs/SECURITY/03` | `deletes refresh tokens when the user is hard-deleted` plus the parameterised cascade test over all four child tables |
| An abandoned TOTP enrolment cannot lock an admin out | `docs/DATABASE/02` | `allows many unconfirmed factors but only one confirmed per type` |
| A redeemed token cannot be replayed into a second identity | `docs/DATABASE/02` | `rejects a duplicate token hash across different users` |
| The request-serving role cannot change the schema | `docs/SECURITY/05` (RLS precondition) | `the application role cannot alter these tables`, asserted from the failing side |

**Not verified here, and not claimed**: object-level authorization. No endpoint exists yet. Nothing in this task satisfies `docs/SECURITY/05` for `:id` access — that is `P0-11`.

## Definition of Done Verification

- [x] Columns, types, defaults, CHECK constraints and indexes match `docs/DATABASE/02` exactly — one deliberate difference, ADR-031
- [x] `password_hash` is nullable — asserted in `defaults role to user, status to active and email_verified to false`
- [x] Constraint behaviour proven by integration tests, not by reading the migration — 22 tests, three of them mutation-checked
- [x] The deviation is recorded as an ADR **and** `docs/DATABASE/02` amended in the same change

## What Did Not Work

**I broke the document while amending it.** Inserting the ADR-031 note used a replace that consumed the closing ``` ``` ``` of the SQL block, so the fence count went odd and the rest of the file would have rendered as code. Caught by counting fence markers rather than by looking at it — the corruption was 15 lines above where the note went in, which is exactly the kind of thing that reads fine in a diff.

The lesson is the same one recorded in `P0-05`: a patch has to assert what it did, not just what it matched.

**`vitest.config.mts` would have picked up the integration tests.** Its include pattern is `test/**/*.spec.ts`, and my first instinct was to name the file `users-schema.spec.ts` — which would have put a database-dependent suite into `pnpm test` and broken it on any machine with nothing running. Naming them `*.itest.ts` under a separate config keeps `pnpm test` honest.

**Integration tests are not in `scripts/verify.sh`.** I considered adding them and did not: `verify.sh` is what runs before every merge and must work with nothing started. A step that fails because Docker is not running would train people to ignore the script, which is the failure mode `P0-17`'s record already warns about. `test:integration` is a separate, deliberate command — and that is a real gap, because nothing forces anyone to run it.

## Follow-Ups and Open Questions

- **`OQ-15` — `idx_users_oauth` is not unique.** Two rows could share `(oauth_provider, oauth_subject_id)`. The documented flow matches by verified email so it cannot arise today, but the moment account linking is designed (`P1-05`), this needs a decision rather than an inherited default.
- **Email lookups must filter `deleted_at IS NULL`.** ADR-031 makes two rows able to share an address legitimately. The index makes the correct query natural; it cannot force it. A rule for `P0-11`.
- **Nothing runs `test:integration` automatically.** `P0-19` should fold it in once Testcontainers removes the "start compose first" precondition, and `P0-17` should run it when CI returns.
- **`secret_encrypted` is only a `BYTEA`.** The schema cannot enforce that what goes in is encrypted. `P5-02` owns that, and a plaintext secret would look identical here.

## What to Watch

**The email-reuse behaviour is now a property people will build on without noticing.** Any `SELECT ... WHERE email = $1` written without `AND deleted_at IS NULL` is a bug that only appears once a real user has deleted an account and someone else has taken the address — which is rare enough to reach production and specific enough to be baffling when it does.

**`beforeEach` truncates `users`**, and the cascades clear everything else. That is fine while this is the only integration suite. When `P0-08` adds its own, two suites sharing one database will delete each other's rows — `fileParallelism: false` prevents them running concurrently, but not a future suite that assumes its data survives. `P0-19` should give each suite its own database or a transaction-per-test.

**The mutation checks were done by hand and are not repeatable.** I dropped constraints in a live database, watched the right tests fail, and put them back. Nothing in the repository re-runs that. If someone later weakens a constraint *and* the corresponding test in the same change, nothing catches it.
