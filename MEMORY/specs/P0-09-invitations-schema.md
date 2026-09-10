# P0-09 — Feature Spec: The Invitation Aggregate

| | |
|---|---|
| **Task** | `P0-09` |
| **Date** | 2026-09-10 |
| **Author** | Claude Code session |
| **Status** | Reviewed — one contradiction found (ADR-033), one deferred constraint closed (ADR-032) |

---

## 1. Goal

The invitation aggregate exists in full: the parent, every child table, the status history that makes the lifecycle auditable, and the referential rules that stop a published invitation being broken from any direction. Schema only.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/DATABASE/04-INVITATIONS.md` | whole file | `invitations`, `invitation_settings`, `invitation_status_history`, `invitation_preview_tokens`, `invitation_custom_domains` |
| `docs/DATABASE/05-EVENTS.md` | whole file | `invitation_people`, `invitation_events` |
| `docs/DATABASE/06-MEDIA.md` | invitation children | `invitation_gallery`, `invitation_bank_accounts`, `invitation_quote` |
| `docs/DATABASE/09-GUESTS.md` | whole file | `invitation_guests`, `invitation_guestbook` |
| `docs/DATABASE/11-ANALYTICS.md` | whole file | `invitation_view_counts` |
| `docs/DATABASE/01-ERD.md` | Key Cardinalities | `owner_id` and `template_version_id` are `RESTRICT` |
| `docs/PLAN/15-SEO.md` | — | `seo_indexable` defaults to **false** |
| `docs/ARCHITECTURE/04` | Indexing | `idx_guestbook_invitation` is the composite `(invitation_id, status)` |

### Contradiction found — the same one as `P0-07`

`docs/DATABASE/04` declares:

```sql
slug VARCHAR(50) UNIQUE,
CREATE UNIQUE INDEX idx_invitations_slug ON invitations(slug) WHERE deleted_at IS NULL;
```

and then, in its own **Notes** section, states the intent outright:

> The `slug` unique constraint only applies to rows where `deleted_at IS NULL` (partial unique index) so a slug can be reused after the old invitation is truly deleted.

A column-level `UNIQUE` covers every row including soft-deleted ones, so the two cannot both be in force and the Notes describe only one of them. This is the identical mistake `ADR-031` resolved for `users.email`, in a different file.

**Resolved as ADR-033**, following ADR-031's precedent: the partial unique index is the only rule, the column-level `UNIQUE` is dropped, and `docs/DATABASE/04` is amended.

### Two tables the card does not mention

The card's step list names ten tables. `docs/DATABASE/04` also defines **`invitation_preview_tokens`**, and `docs/DATABASE/11` defines **`invitation_view_counts`** — which `docs/DATABASE/00` lists as an invitation child.

No other schema task owns either. `P0-10` is the commercial tables. Leaving them out means `P2-*` and `P4-09` would each add a table from a task about endpoints. Both ship here; the goal says the aggregate exists **in full**.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-3.3 | A template version in use is deprecated, not deleted | `template_version_id` and `template_id` are `ON DELETE RESTRICT` |
| — | A user with invitations cannot be hard-deleted | `owner_id` is `ON DELETE RESTRICT` |
| — | Exactly two people per invitation, groom and bride | `UNIQUE (invitation_id, role)` + `CHECK (role IN ('groom','bride'))` |
| — | An RSVP party is 1..10 | `CHECK (guest_count BETWEEN 1 AND 10)` |
| BR-4.1 | Gift details are published only when the section is enabled | `invitation_settings.enabled_sections`; enforcement is `P3-*` |
| — | A published invitation is not indexed unless the owner opts in | `seo_indexable` defaults `false` (`docs/PLAN/15`) |

## 4. API Contract

Not applicable.

## 5. Data Model Impact

Thirteen new tables, plus one `ALTER TABLE` closing ADR-032:

```sql
ALTER TABLE media ADD CONSTRAINT media_invitation_id_invitations_id_fk
  FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE;
```

Migration required: **yes**, `0003`. Expand-contract safe: `CREATE` plus one `ADD CONSTRAINT`; nothing dropped or altered destructively.

**Creation order** is forced by foreign keys: `invitations` first (it references `users`, `templates`, `template_versions`, all existing), then every child, then the `media` ALTER.

## 6. Authorization

No endpoint. The database-level properties this task owns:

- **`owner_id` is `RESTRICT`, every child is `CASCADE`.** Opposite directions, both correct: an invitation must not vanish because its owner row was deleted, but a child must not outlive its invitation.
- **`media.invitation_id` becomes `CASCADE`**, so deleting an invitation removes its media rows rather than orphaning them.
- **`invitation_status_history.changed_by` is nullable** — system jobs change status with no acting user, and a `NOT NULL` would force a fake actor into the audit trail.

Object-level authorization for `:id` access is `P0-11`. Nothing here satisfies `docs/SECURITY/05`.

## 7. Validation and Sanitization

Database-level: `status`, `role`, `type`, `attendance_status`, `guestbook.status` and `verification_status` all carry CHECKs; `guest_count BETWEEN 1 AND 10`.

**Not database-level, and deliberately so**: `invitation_guestbook.message` and `invitation_guests.message` are free text rendered on a public page. Sanitization against HTML/script happens before storage at the service layer (`docs/SECURITY/08`), not in a CHECK — a regex constraint would be both bypassable and wrong.

`submitted_ip_hash` is `VARCHAR(64)` and stores a hash, never a raw IP (`docs/SECURITY/09`).

## 8. State Transitions

`invitations.status` moves through `draft → pending_payment → paid → published → expired`, plus `soft_deleted`. Every transition writes an `invitation_status_history` row **at the service layer, not via a trigger** — `docs/DATABASE/04` is explicit, because `changed_by` and `reason` come from application context a trigger cannot see. This task creates the table; `P0-14` writes the writer.

## 9. Side Effects

None. A migration.

## 10. Failure Modes

Single transaction. A partial failure leaves nothing.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Two live invitations on one slug | `docs/DATABASE/04` | Rejected | `rejects a duplicate slug among live invitations` |
| A deleted invitation holds its slug forever | ADR-033, `docs/DATABASE/04` Notes | Slug reusable after soft delete | `frees the slug once the invitation is soft-deleted` |
| A third person on an invitation | `docs/DATABASE/05` Notes | Rejected | `rejects a third person on one invitation` |
| An RSVP claiming 50 seats | `docs/DATABASE/09` | Rejected | `rejects a guest_count outside 1..10` |
| Deleting a user who still has invitations | `docs/DATABASE/01` | Refused | `refuses to delete a user who still owns an invitation` |
| Deleting a template version an invitation uses | BR-3.3 | Refused | `refuses to delete a template version an invitation still uses` |
| Children outliving their invitation | `docs/DATABASE/01` | Cascade | `cascades every child away with its invitation` |
| Media orphaned by invitation deletion | ADR-032 | Cascade | `cascades media away with its invitation` |
| An invitation indexed by search engines without consent | `docs/PLAN/15` | Default `false` | `defaults seo_indexable to false` |
| A preview token stored in the clear | `docs/DATABASE/04` | Only a hash column exists | `stores only a preview token hash` |
| Two invitations claiming one custom domain | `docs/DATABASE/04` | Rejected | `rejects a duplicate custom domain` |
| Duplicate view rows for one day | `docs/DATABASE/11` | Composite PK rejects | `rejects a duplicate (invitation_id, view_date)` |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Integration | Every abuse case above, plus the `media` FK from ADR-032 now rejecting a bad `invitation_id` — **replacing** the `P0-08` test that asserted the constraint was absent |
| Security | The RESTRICT/CASCADE directions and the `seo_indexable` default are the security-relevant ones |

## 13. Observability

`invitation_bank_accounts.account_number` is masked to the last four digits in every log (`docs/DEVOPS/06`). `submitted_ip_hash` is already a hash. Both are `P0-12`'s to enforce.

## 14. Open Questions

- **`invitations.template_id` and `template_version_id` are both stored**, which is denormalized — the version already knows its template. Kept exactly as documented; a mismatch between the two is possible and nothing prevents it. Raised as `OQ-17` for `P0-11`.
- **`invitation_custom_domains.ssl_status` has no CHECK** while `verification_status` does. Left as documented.
