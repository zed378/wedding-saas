# P0-08 — Feature Spec: Template Catalog and Media Schema

| | |
|---|---|
| **Task** | `P0-08` |
| **Date** | 2026-09-10 |
| **Author** | Claude Code session |
| **Status** | Reviewed — one ordering deviation, ADR-032 |

---

## 1. Goal

The template catalog and the media table exist, with the referential rules that stop a published invitation from being broken by a catalog edit. Schema only; no API, no service code.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/DATABASE/03-TEMPLATES.md` | whole file | `templates`, `template_versions`, `template_assets` |
| `docs/DATABASE/06-MEDIA.md` | `media` block | `media`; the other three tables in that file belong to `P0-09` |
| `docs/DATABASE/01-ERD.md` | Key Cardinalities | `template_versions` is `ON DELETE RESTRICT` from invitations |
| `docs/DATABASE/00-DATA-MODEL.md` | Table Groups, Principles | `media` is polymorphic; `deleted_at` on `media` |
| `docs/PLAN/02-BUSINESS-RULES.md` | BR-3.3 | A version in use is deprecated, never deleted |
| `docs/PLAN/07-TEMPLATE-SYSTEM.md` | Section System, Theme Variables | What `sections` and `theme` hold |

### The ordering problem

Three tables reference each other across a task boundary:

```
template_assets.media_id      -> media              (both P0-08)
media.invitation_id           -> invitations        (P0-09)
invitations.template_version_id -> template_versions (P0-08)
```

`media` cannot be created with its `invitation_id` foreign key in this task, because `invitations` does not exist until `P0-09`. The card's step 5 spots half of this ("`media` is created first in the same migration") but not the half that crosses into the next task.

**Resolved as ADR-032**: the `invitation_id` **column** is created here exactly as documented — `UUID`, nullable, with `idx_media_invitation` — and the **foreign key constraint** is added by `P0-09` with `ALTER TABLE ... ADD CONSTRAINT`. The final shape matches `docs/DATABASE/06` exactly; only the moment the constraint appears differs. `P0-09`'s card gains an explicit step so the constraint cannot be forgotten, which is the real risk this creates.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-3.3 | A template version an invitation still uses is deprecated, not deleted | `ON DELETE RESTRICT` on `invitations.template_version_id` (added in `P0-09`); `status = 'deprecated'` here |

## 4. API Contract

Not applicable.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `templates` | new | `category` is `VARCHAR(40)[]`, a real array, not a join table |
| `template_versions` | new | `sections` and `theme` are `JSONB`; `UNIQUE (template_id, version)` |
| `media` | new | `invitation_id` nullable — null is what makes a row a template asset |
| `template_assets` | new | `media_id` nullable, `ON DELETE CASCADE` from its version |

Migration required: **yes**, `0002`. Expand-contract safe: every statement is `CREATE`; nothing is dropped or altered.

**Creation order inside the migration** is forced by the foreign keys: `templates` → `template_versions` → `media` → `template_assets`.

## 6. Authorization

No endpoint. The database-level properties this task owns:

- **`template_versions.template_id` is `ON DELETE RESTRICT`.** Deleting a template that has versions must fail rather than cascade — a cascade here would silently remove versions that published invitations render from.
- **`template_assets.template_version_id` is `ON DELETE CASCADE`**, which is correct and is the opposite rule: assets belong to their version and have no meaning without it.
- **`media.uploaded_by` has no `ON DELETE`**, so it defaults to `NO ACTION`. A user with uploaded media cannot be hard-deleted while it exists, consistent with `docs/DATABASE/01`'s treatment of `users`.

## 7. Validation and Sanitization

Database-level:

- `templates.status` and `template_versions.status` — `CHECK (... IN ('draft','published','deprecated'))`.
- `media.status` — `CHECK (status IN ('processing','ready','failed'))`. Default `'processing'`: a row exists before the file is validated, and nothing may treat it as usable until the pipeline says so (`docs/SECURITY/06`).
- Exact lengths as documented, including `VARCHAR(500)` for `storage_path` and `thumbnail_url`.

**`sections` and `theme` are `JSONB` with no database-level schema.** `docs/DATABASE/03` § Schema Validation is explicit that the JSON Schema lives in application code, not the database. That is `P0-20`. A `CHECK` here would duplicate the rule in a place that cannot be versioned with the validator.

`media.purpose` has **no CHECK**, exactly as documented — the comment lists four values but the column is unconstrained. Left as specified rather than tightened; noted in § 14.

## 8. State Transitions

`templates.status` and `template_versions.status` move `draft → published → deprecated`. No history table is specified for either; `docs/DATABASE/04` reserves `invitation_status_history` for invitations only. Enforcement is `P5-*`.

## 9. Side Effects

None. A migration.

## 10. Failure Modes

Single transaction; a partial failure leaves nothing and no journal row.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Two versions with the same number under one template | `docs/DATABASE/03` | Rejected | `rejects a duplicate (template_id, version)` |
| The same version number under a different template | — | Allowed | `allows the same version string under a different template` |
| Deleting a template that still has versions | `docs/DATABASE/01`, BR-3.3 | Refused | `refuses to delete a template that still has versions` |
| An unknown status value | `docs/DATABASE/03` | CHECK rejects | `rejects a status outside the allowed set` |
| Media treated as usable before validation | `docs/SECURITY/06` | Defaults to `processing` | `defaults media status to processing` |
| Template assets outliving their version | `docs/DATABASE/03` | Cascade removes them | `cascades template assets away with their version` |
| A slug collision in the catalog | `docs/DATABASE/03` | Rejected | `rejects a duplicate template slug` |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit | None — DDL only |
| Integration | Every abuse case above, plus: `category` and `customizable_theme_keys` round-trip as arrays; `sections`/`theme` round-trip as JSONB; `media.invitation_id` accepts null; `idx_media_invitation` exists |
| Security | The RESTRICT/CASCADE asymmetry is the security-relevant part and is covered above |

The DoD's "a `template_versions` row referenced by an invitation cannot be deleted" needs `invitations` and therefore lands in `P0-09` — the card already anticipates this.

## 13. Observability

Nothing runtime. `media.storage_path` should not be logged verbatim in full — it is a path into private object storage. Noted for `P0-12`.

## 14. Open Questions

- **`media.purpose` has no CHECK constraint** while every comparable column in the schema does. `docs/DATABASE/06` lists four values in a comment only. Left exactly as documented; adding one would be inventing a constraint, and removing a value later would be a migration. Raised as `OQ-16` for `P1-17`, when the upload pipeline actually writes the column.
- **`template_assets.media_id` is nullable** and has no `ON DELETE`. An asset row can therefore exist pointing at nothing, and deleting referenced media is refused. Both follow the document; the nullability presumably supports an asset declared before its file is uploaded.
