# P0-10 — Commercial tables: orders, payments, audit logs

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-10 |
| **Phase** | Phase 0 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-10-orders-payments-schema` |
| **Spec** | [`MEMORY/specs/P0-10-orders-payments-schema.md`](../specs/P0-10-orders-payments-schema.md) |
| **Status** | Completed — Phase 0 schema is finished |

---

## What Changed

`packages`, `addons`, `orders`, `payments` and `audit_logs` as `0004`, plus two `updated_at` triggers and the `REVOKE` that makes the audit trail append-only. The seed now writes the master price tables. 30 new integration tests, 123 across four suites.

`scripts/db-roundtrip.sh` gained two checks and a reseed step.

## Why

Two constraints in this migration carry more weight than anything else in the schema:

**`UNIQUE (provider, provider_reference_id)`** is the entire idempotency story for payment webhooks. A provider retrying a delivery is normal traffic, not an error. This lives in the database rather than in application code because a guarantee that depends on every future handler remembering to check first is not a guarantee.

**`REVOKE UPDATE, DELETE ON audit_logs`** is what makes the audit trail an audit trail. `docs/DATABASE/10` § Policy asks for the permission level "where possible", and it is possible here — the migration runs as the owner and the application connects as a different role. An audit trail the application can rewrite is not one, because the code an attacker would be running is exactly the actor it exists to constrain.

## How

**No contradictions in these four documents.** Worth stating after `P0-07` and `P0-09` each turned one up: `docs/DATABASE/07`, `08` and `10` are internally consistent and consistent with `docs/SECURITY/07`.

**Money is `BIGINT` rupiah everywhere** — `packages.price`, `addons.price`, `orders.amount_total`, `payments.amount`. A test asserts all four are `bigint` rather than trusting it, because a single `numeric` or `double precision` among them would be invisible until a rounding complaint.

**`amount_total` is a snapshot, not a lookup.** A test changes the package price and asserts the existing order is untouched. An order history that moves with the price list is not a history.

**`signature_valid` is nullable three-state**: null before verification, false for a forged callback, true for a genuine one. A forged callback is *recorded* rather than dropped — a spike in false is an alerting condition (`docs/DEVOPS/07`), and you cannot alert on rows you threw away.

**The `REVOKE` is guarded on the role existing** and raises a `NOTICE` either way. A deployment whose application role has another name should not fail the migration, but it must also not pass silently — a skipped revoke means the guarantee is simply absent and nothing else would say so.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/infra/db/schema/orders.ts` | Five tables |
| `backend/api/src/infra/db/schema/index.ts` | Exports it |
| `backend/api/migrations/0004_orders_payments_audit.sql` | Generated; triggers and the guarded `REVOKE` appended |
| `backend/api/migrations/0004_orders_payments_audit.down.sql` | Children before parents |
| `backend/api/src/infra/db/seed.mts` | Seeds `packages` and `addons`, idempotently |
| `backend/api/test/integration/orders-schema.itest.ts` | 30 tests |
| `backend/api/test/integration/helpers.ts` | `applicationPool()` — connects as the unprivileged role |
| `scripts/db-roundtrip.sh` | Asserts the append-only grant; reseeds afterwards |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Append-only enforced by `REVOKE`, not convention | `docs/DATABASE/10` asks for the permission level; it is available | — |
| The `REVOKE` is guarded and raises a notice | A differently-named role must not fail the migration, nor pass silently | — |
| No unique index for "one pending order per invitation" | `docs/DATABASE/07` calls it an application-level rule with its own error code | `OQ-18` |
| Price tables seeded, not migrated | `docs/DATABASE/07` § Notes: prices change without a schema change | — |
| Both addons seeded inactive | ADR-022 for `custom_domain`; redundant beside a 12-month package for the other | — |

## Deviations from `docs/`

None. Every column, type, constraint and index matches, including the parts I would have done differently — `orders.addon_ids` is a `VARCHAR(30)[]` and therefore carries no referential integrity, which a test documents explicitly rather than quietly working around.

## Tests Added

30 in `orders-schema.itest.ts`; 123 across four suites.

| Group | Cases |
|---|---|
| Webhook idempotency | duplicate `(provider, reference)` rejected; **same reference under a different provider allowed**; the `ON CONFLICT DO NOTHING` upsert returns `rowCount` 1 then 0; forged callback recorded; `signature_valid` null before verification; bad status rejected |
| Append-only | application role can `INSERT` and `SELECT`; **cannot** `UPDATE` or `DELETE`; **can still `UPDATE` a normal table**; `ip_address` is `inet` |
| Orders | non-existent package rejected; invitation, user and order all refuse deletion while referenced; `amount_total` survives a price change; all money columns are `bigint`; five statuses accepted, unknown rejected; unknown `order_type` rejected; `addon_ids` defaults empty and accepts an unknown id |
| Seed | exactly one active package at 139000/12mo/200 photos/no watermark; `custom_domain` inactive; **no** active addon at all |

**Mutation-checked**, both times catching exactly the right tests:

| Mutation | Result |
|---|---|
| `GRANT UPDATE, DELETE ON audit_logs` back to the application role | 2 tests failed |
| Narrowed the payments unique index to `provider_reference_id` alone | 2 tests failed |

The second mutation is instructive: narrowing the index broke both the "different provider" test *and* the `ON CONFLICT` test, because the conflict target no longer matched an index. Two independent signals for one mistake.

**The append-only tests connect as `wedding_app`, not the owner.** That is the whole reason `applicationPool()` exists. A permission test run as the owner passes whether or not the `REVOKE` ever happened, which would make it worse than no test.

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| A replayed webhook cannot create a second payment | `docs/DATABASE/08` § Critical Notes | `rejects a duplicate (provider, provider_reference_id)`, mutation-checked |
| The audit trail cannot be rewritten by the application | `docs/DATABASE/10` § Policy | `refuses an UPDATE`/`refuses a DELETE`, run as the application role, mutation-checked |
| The revoke is scoped, not global | — | `still allows UPDATE on a normal table` |
| Price cannot come from the client | `docs/SECURITY/07` § Pricing | `packages`/`addons` are the only price source; an order for a non-existent package is rejected |
| A price change cannot rewrite history | `docs/DATABASE/07` § Notes | `leaves amount_total untouched when the package price changes` |
| A forged callback is evidence, not noise | `docs/DATABASE/08`, `docs/DEVOPS/07` | `records a callback with an invalid signature` |
| Payment history cannot be deleted | `docs/DATABASE/01` | Three `RESTRICT` tests |
| An unsellable addon cannot be bought | ADR-022 | `seeds custom_domain as inactive`, `has no active addon at all` |

**Not verified, and not claimed**: that payment status only ever changes from a signature-verified webhook. That is `docs/SECURITY/07`'s central rule and it is enforced in code, not schema — `P3-05`. Nothing here prevents a service from writing `status = 'success'` for the wrong reason.

## Definition of Done Verification

- [x] `packages` and `addons` as master price tables
- [x] `orders` with both CHECKs and three indexes
- [x] `payments` with `UNIQUE (provider, provider_reference_id)`
- [x] `signature_valid` present and recorded
- [x] `audit_logs` with three indexes, and `UPDATE`/`DELETE` revoked from the application role
- [x] `packages`/`addons` seeded, not migrated; `custom_domain` inactive (ADR-022)
- [x] Tests: duplicate `(provider, reference)` rejected; `UPDATE` on `audit_logs` from the application role fails; an order cannot reference a non-existent package

## What Did Not Work

**The round trip left the database unusable, and the round trip is what found it.** `0004`'s down migration drops `packages` and `addons`, so after up→down→up the master price tables were empty. The orders suite then fails on a missing `standard` package — which looks like a schema bug and is not.

Fixed by making `db-roundtrip.sh` reseed at the end. That is the right place: the script exists so a developer can exercise migrations without wrecking their environment, and leaving it wrecked defeats the purpose.

**I called `pass`/`fail` in `db-roundtrip.sh`, where they do not exist.** Those helpers are defined in `deploy/helm/verify.sh`; this script uses `expect`. I copied the idiom across without checking, and `set -euo pipefail` did not catch it because a missing command inside an `if` condition is not a pipeline failure — the script printed `pass: command not found` and carried on to report success. Rewritten to use `expect`, which also turns the reseed into a real assertion (`1 active package`) rather than an unchecked side effect.

**A `python` heredoc anchor failed on a line-continuation backslash** while patching the shell script, so the first attempt silently patched nothing and the second used a shorter anchor. Every patch in this repository asserts its anchor, which is why it failed loudly rather than half-applying.

## Follow-Ups and Open Questions

- **`OQ-18` — one pending order per invitation** is an application-level rule by the document's own words, with its own error code (`ACTIVE_ORDER_EXISTS`). A partial unique index would make it structural but would surface as an opaque 500 rather than the specified error. Decide in `P3-01`.
- **`orders.addon_ids` has no referential integrity.** A `VARCHAR(30)[]` cannot carry a foreign key. The service must validate against `addons` before insert, and `P3-01` owns that.
- **The `REVOKE` depends on the role being named `wedding_app`.** In production it will not be. The migration raises a notice when it skips; `P0-23` must check for it, because a notice in a deploy log is easy to miss.
- **`packages.price` is now seeded at 139000 in two places** — the seed file and ADR-023. If pricing changes, both move.

## What to Watch

**The `REVOKE` is invisible in the schema file.** `orders.ts` describes `auditLogs` as append-only in a comment, but nothing in the Drizzle model enforces it — the guarantee lives in a hand-appended `DO` block in `0004`. A future `db:generate` will not notice if it is missing, and a fresh database built by some other path would not have it. `db-roundtrip.sh` asserts the grant, and that assertion is now the only automated thing standing between "append-only" and "append-only in principle".

**`raw_callback_payload` holds provider data in full and unencrypted, on purpose** (ADR-025) — it is retained so a signature can be re-verified during an investigation. That makes `payments` the most sensitive table in the database after `users`. `docs/API/09` restricts access to a narrower role and logs every read; nothing enforces that yet, and nothing will until `P5-*`.

**Phase 0's schema is complete at 28 tables** — 6 for users and auth, 4 for templates and media, 13 for the invitation aggregate, 5 commercial. The next schema change is a real migration against real data, with expand-contract and the destructive-migration gate actually mattering. Everything up to here has been `CREATE`.
