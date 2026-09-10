# P0-08 — Template catalog and media schema

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-08 |
| **Phase** | Phase 0 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-08-templates-media-schema` |
| **Spec** | [`MEMORY/specs/P0-08-templates-and-media-schema.md`](../specs/P0-08-templates-and-media-schema.md) |
| **Status** | Completed, with one constraint deliberately deferred to `P0-09` |

---

## What Changed

`templates`, `template_versions`, `media` and `template_assets` as `0002_templates_and_media.sql`, with the `templates` `updated_at` trigger and a down migration. 20 new integration tests (42 total across both schema suites). A shared `test/integration/helpers.ts` now carries the connect-or-fail logic.

## Why

This is the half of the schema that protects published invitations from catalog edits. The rule that matters is BR-3.3: a template version an invitation still renders from is **deprecated**, never deleted.

## How

**The two delete rules are deliberately opposite, and that is the most fragile thing in this migration.** `template_versions → templates` is `RESTRICT`; `template_assets → template_versions` is `CASCADE`. Both are correct. A cascade on the first would let a catalog tidy-up silently delete the versions that live wedding pages render from; a restrict on the second would leave asset rows that mean nothing without their version.

The danger is that they look inconsistent, and inconsistency invites "fixing". Three tests pin the asymmetry and the schema file says why at each site.

**`sections` and `theme` are JSONB with no database-level validation.** `docs/DATABASE/03` § Schema Validation is explicit that the JSON Schema lives in application code (`P0-20`). A `CHECK` here would duplicate the rule somewhere that cannot be versioned with the validator.

**`category` and `customizable_theme_keys` are real Postgres arrays** — `varchar(40)[]` and `varchar(60)[]`, not `text[]`. This is one of the concrete reasons ADR-007 chose Drizzle over Prisma, and it is asserted rather than assumed: the test checks `data_type = 'ARRAY'` and round-trips the values.

**`media.status` defaults to `processing`.** A row exists before the file has been through the `docs/SECURITY/06` validation pipeline. Defaulting to `ready` would make a failed scan invisible — the row would look usable the moment it was created.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/infra/db/schema/templates.ts` | Four tables |
| `backend/api/src/infra/db/schema/index.ts` | Exports it |
| `backend/api/migrations/0002_templates_and_media.sql` | Generated, trigger appended |
| `backend/api/migrations/0002_templates_and_media.down.sql` | Children before parents |
| `backend/api/test/integration/templates-schema.itest.ts` | 20 tests |
| `backend/api/test/integration/helpers.ts` | New — connect-or-fail, shared |
| `TASKS/PHASE-0-FOUNDATION.md` | `P0-08` closed; **`P0-09` gained a step and a DoD line** for the deferred FK |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| `media.invitation_id`'s FK deferred to `P0-09` | `invitations` does not exist yet and `template_assets` needs `media` now; no ordering satisfies every FK in one migration | ADR-032 |
| `RESTRICT` and `CASCADE` kept opposite | BR-3.3 for the first; assets are meaningless without their version for the second | — |
| No `CHECK` on `sections`/`theme` | `docs/DATABASE/03` puts the JSON Schema in application code | — |
| `media.purpose` left unconstrained | Documented as a comment only; inventing a CHECK would be adding a rule | `OQ-16` |

## Deviations from `docs/`

**One, ordering only (ADR-032).** `media.invitation_id`'s foreign key arrives in `P0-09`. The column, type, nullability and index are exactly as documented; the end state after `0003` matches `docs/DATABASE/06` precisely.

No document was amended, because none is wrong — this is a sequencing constraint of building the schema in four tasks, not a disagreement with the specification.

## Tests Added

20 tests in `test/integration/templates-schema.itest.ts`; 42 across both suites.

| Group | Cases |
|---|---|
| `templates` | duplicate slug rejected; bad status rejected; `category` is a real ARRAY and round-trips; defaults correct |
| `template_versions` | duplicate `(template_id, version)` rejected; **same version under a different template allowed**; `sections`/`theme` round-trip as JSONB with the type asserted; `customizable_theme_keys` array and default; bad status rejected |
| Delete rules | template with versions cannot be deleted; one without can; assets cascade with their version; media referenced by an asset cannot be deleted |
| `media` | null `invitation_id` accepted; `idx_media_invitation` exists; status defaults to `processing`; bad status rejected; `size_bytes` is `bigint`; **FK currently absent (ADR-032)** |
| Trigger | `templates` bumps `updated_at` on a real change, not on a no-op |

**Mutation-checked**, both times catching exactly the right test:

| Mutation | Result |
|---|---|
| `template_versions.template_id` `RESTRICT` → `CASCADE` | `refuses to delete a template that still has versions` failed |
| Dropped `UNIQUE (template_id, version)` | `rejects a duplicate (template_id, version)` failed |

Round trip passes across all three migrations.

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| A version in use cannot be deleted | BR-3.3, `docs/DATABASE/01` | `refuses to delete a template that still has versions`, mutation-checked |
| Media referenced by a template cannot vanish | `docs/DATABASE/03` | `refuses to delete media that a template asset still references` |
| An upload is not usable before validation | `docs/SECURITY/06` | `defaults media status to processing` |
| Status values are constrained | `docs/DATABASE/03`, `06` | Three separate CHECK tests |

**Not verified, and not claimed**: that `media.invitation_id` points at a real invitation. It cannot be, until `P0-09` adds the constraint. A test asserts the gap explicitly rather than leaving it unmentioned.

## Definition of Done Verification

- [x] `docs/DATABASE/03` and `06` reproduced exactly — one ordering deviation, ADR-032
- [x] A `template_versions` row cannot be deleted while referenced (template side; invitation side moves to `P0-09` as the card allows)
- [x] Duplicate `(template_id, version)` rejected
- [x] `media.invitation_id` accepts null; `idx_media_invitation` exists

## What Did Not Work

**I asserted the wrong SQLSTATE, and the mistake was worth making.** The test for `RESTRICT` expected `23503` (`foreign_key_violation`). PostgreSQL raises **`23001` (`restrict_violation`)** for `RESTRICT`, and reserves `23503` for `NO ACTION`. Both codes occur in this schema — `template_versions → templates` is RESTRICT, `template_assets → media` is NO ACTION — and the tests now assert each exactly.

This matters beyond the test. Application code that maps only `23503` to a friendly "this template is still in use" message would return a 500 for the RESTRICT case, which is the more common one. I would have written that mapping and not found out until a real admin hit it.

Confirming it took an extra step: the database *was* correct (`confdeltype = 'r'`), so the failure had to be my assertion rather than the migration. Checking the constraint metadata before rewriting the test is what made that obvious, rather than "fixing" the migration.

**The connect-or-fail block was about to be copy-pasted** into a second suite. Extracted to `helpers.ts` first, with the table-existence check improved: an empty but reachable database used to produce twenty "relation does not exist" failures instead of one message naming the command to run.

**A stale `OQ-09` reference** survived into `users.ts` from `P0-07` — the renumber to `OQ-15` had touched the docs but not the schema comment. Found by grepping for the old number rather than trusting the earlier pass.

## Follow-Ups and Open Questions

- **`P0-09` must add `media.invitation_id`'s foreign key.** Its card now has a numbered step and a DoD line, and the `P0-08` test asserting the constraint is absent will fail the moment it lands — which is the point. It must be **replaced**, not deleted.
- **`OQ-16` — `media.purpose` has no CHECK** while every comparable column does. `docs/DATABASE/06` lists four values in a comment only. Decide in `P1-17`, when the upload pipeline actually writes it.
- **`template_assets.media_id` is nullable with no `ON DELETE`**, so an asset can point at nothing. Follows the document; presumably supports declaring an asset before uploading its file.
- **Two suites now share one database** and each truncates its own tables. `fileParallelism: false` keeps them from racing. `P0-19` should give each suite isolation rather than relying on that flag.

## What to Watch

**Someone will try to make the two delete rules consistent.** They read as a mistake — one RESTRICT, one CASCADE, on tables one level apart. The comment at each site and the tests are the defence, and the tests are the half that cannot be skimmed past.

**The deferred foreign key is the real risk in this task**, not the missing constraint itself. Nothing writes to `media` before `P0-09`, so the window is theoretical. The failure mode is forgetting: the ALTER never happens, `media.invitation_id` stays unconstrained forever, and orphaned rows accumulate quietly once uploads start in `P1-17`. Three reminders exist — the card step, the DoD line, and a test that flips from passing to failing.

**`media` has `deleted_at` but no `updated_at`**, so it gets no trigger. If a later task adds `updated_at` to it, the trigger must be added in the same migration or the column will silently record creation time forever.
