# P0-10 — Feature Spec: Commercial Tables

| | |
|---|---|
| **Task** | `P0-10` |
| **Date** | 2026-09-10 |
| **Author** | Claude Code session |
| **Status** | Reviewed |

---

## 1. Goal

The commercial tables exist: the master price tables that are the only source of an order's amount, the orders and payments that record money, and the append-only audit log. Schema and seed only — no endpoint, no payment code.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/DATABASE/07-ORDERS.md` | whole file | `packages`, `addons`, `orders` |
| `docs/DATABASE/08-PAYMENTS.md` | whole file | `payments` and the idempotency index |
| `docs/DATABASE/10-AUDIT-LOGS.md` | whole file + Policy | `audit_logs`, append-only |
| `docs/SECURITY/07-PAYMENT-SECURITY.md` | Pricing | `packages`/`addons` are the only source of an amount |
| `docs/PLAN/09` + ADR-023 | Packages | One active package: `standard`, Rp 139,000, 12 months, 200 photos, no watermark |
| ADR-022 | — | `custom_domain` seeded inactive |

No contradictions found in these four documents. That is worth stating explicitly after `P0-07` and `P0-09` each turned one up.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| `docs/SECURITY/07` | Price is never accepted from the client | `packages.price` / `addons.price` are the master; `orders.amount_total` is a server-written snapshot |
| — | An order's amount survives a later price change | `amount_total` is stored, not recalculated on read |
| — | A replayed webhook must not create a second payment | `UNIQUE (provider, provider_reference_id)` |
| — | A forged callback is recorded, not discarded | `signature_valid BOOLEAN`, nullable |
| `docs/DATABASE/10` | Audit rows are append-only | `REVOKE UPDATE, DELETE ON audit_logs FROM` the application role |
| ADR-022 | `custom_domain` is not sellable yet | Seeded `is_active = false` |

**Not enforced here, deliberately**: only one `pending` order per invitation. `docs/DATABASE/07` § Notes calls this an application-level constraint checked in the service layer (`ACTIVE_ORDER_EXISTS`). A partial unique index could express it, but the document is explicit, and inventing a database constraint the service does not expect would surface as an opaque 500 instead of the specified error code. Raised as `OQ-18`.

## 4. API Contract

Not applicable.

## 5. Data Model Impact

| Table | Notes |
|---|---|
| `packages` | PK is `VARCHAR(30)`, not UUID — the id *is* the business identifier (`standard`) |
| `addons` | Same |
| `orders` | `addon_ids` is a `VARCHAR(30)[]`, so add-ons carry **no** foreign key |
| `payments` | `raw_callback_payload` JSONB, retained in full and deliberately not encrypted |
| `audit_logs` | `ip_address INET`; append-only by permission |

Migration required: **yes**, `0004`. Expand-contract safe: all `CREATE`, plus one `REVOKE`.

`orders.invitation_id` and `user_id` are both `ON DELETE RESTRICT` — payment history must never be lost (`docs/DATABASE/01`). Same for `payments.order_id`.

## 6. Authorization

- **`audit_logs` is append-only at the permission level**, not by convention. `docs/DATABASE/10` § Policy asks for this "where possible", and it is possible: the migration runs as the owner and can `REVOKE UPDATE, DELETE` from the application role. An audit trail the application can rewrite is not an audit trail.
- The `REVOKE` is guarded — it runs only if the role exists, so a deployment whose application role has a different name does not fail the migration. It raises a **notice** rather than passing silently, because a skipped revoke means the guarantee is absent.
- `payments.raw_callback_payload` holds provider data. `docs/API/09` restricts access to a narrower role and logs every read; that is a `P5-*` concern, not a schema one.

## 7. Validation and Sanitization

`orders.status`, `orders.order_type` and `payments.status` carry CHECKs exactly as documented. `packages.id` and `addons.id` are free-form `VARCHAR(30)` — no CHECK, because the set is data, not schema.

`amount_total` and `price` are `BIGINT`, holding rupiah as an integer. No floating point anywhere near money.

## 8. State Transitions

`orders.status`: `pending → paid | failed | expired | refunded`. `payments.status`: `pending → success | failed`. Neither has a history table — `invitation_status_history` covers invitations only. Payment status changes only from a signature-verified webhook (`docs/SECURITY/07`), which is `P3-05`.

## 9. Side Effects

The seed writes `packages` and `addons`. It is idempotent (`ON CONFLICT DO UPDATE`) so re-running does not duplicate or fail — but it deliberately does **not** touch `orders.amount_total`, which is a snapshot.

## 10. Failure Modes

Migration is a single transaction. The seed is separate and re-runnable.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| A webhook replayed by the provider | `docs/DATABASE/08` | Second insert rejected | `rejects a duplicate (provider, provider_reference_id)` |
| The same reference id from a different provider | — | Allowed | `allows the same reference id under a different provider` |
| The application rewriting an audit row | `docs/DATABASE/10` | `UPDATE` refused | `refuses an UPDATE on audit_logs from the application role` |
| The application deleting an audit row | `docs/DATABASE/10` | `DELETE` refused | `refuses a DELETE on audit_logs from the application role` |
| An order referencing a package that does not exist | `docs/SECURITY/07` | Rejected | `refuses an order for a non-existent package` |
| Deleting an invitation that has orders | `docs/DATABASE/01` | Refused | `refuses to delete an invitation that has orders` |
| A price change rewriting historical orders | `docs/DATABASE/07` Notes | `amount_total` unchanged | `leaves amount_total untouched when the package price changes` |
| An unknown order or payment status | `docs/DATABASE/07`, `08` | CHECK rejects | `rejects a status outside the allowed set` |
| A forged callback discarded silently | `docs/DATABASE/08` | Row stored with `signature_valid = false` | `records a callback with an invalid signature` |
| An addon sold before its feature exists | ADR-022 | Seeded inactive | `seeds custom_domain as inactive` |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Integration | Every abuse case above. The append-only tests must connect **as the application role**, since the owner can always update |
| Security | The idempotency index and the append-only permission are the two that matter most in the whole schema |

## 13. Observability

A spike in `signature_valid = false` is an alerting condition (`docs/DEVOPS/07`). The column exists so that spike is measurable; the alert is `P3-*`.

## 14. Open Questions

- **`OQ-18` — one pending order per invitation** is an application-level rule by the document's own words. A partial unique index would make it structural. Deliberately not added; decide in `P3-01`.
- **`orders.addon_ids` has no referential integrity.** It is a `VARCHAR(30)[]`, so an order can name an addon that does not exist. Follows the document. The service validates against `addons` before insert.
