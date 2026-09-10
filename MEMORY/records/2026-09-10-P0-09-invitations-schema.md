# P0-09 — The invitation aggregate

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-09 |
| **Phase** | Phase 0 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-09-invitations-schema` |
| **Spec** | [`MEMORY/specs/P0-09-invitations-schema.md`](../specs/P0-09-invitations-schema.md) |
| **Status** | Completed |

---

## What Changed

Thirteen tables as `0003_invitations.sql` — the invitation parent, eleven children, the daily view counter — plus six `updated_at` triggers and the `ALTER TABLE` that closes ADR-032. 51 new integration tests; 93 across the three schema suites.

`docs/DATABASE/04` contradicted itself the same way `docs/DATABASE/02` did in `P0-07`, and is amended (ADR-033).

## Why

This is the aggregate the whole product is about. Every endpoint in Phases 1 through 4 reads or writes some part of it, and the referential rules here are what stop a live wedding page breaking from any direction.

## How

**Two directions of referential rule meet here, and they are opposites.** Everything an invitation *owns* cascades away with it — eleven children plus its media. Everything an invitation *depends on* refuses deletion while in use — owner, template, template version, all `RESTRICT`.

Both are tested, in both directions, because neither is visible from reading the migration and getting either backwards is silent until it matters.

**`docs/DATABASE/04` disagreed with its own Notes.** It declared `slug VARCHAR(50) UNIQUE` and then wrote, in prose two sections later, "a slug can be reused after the old invitation is truly deleted". A column-level `UNIQUE` covers soft-deleted rows and makes that sentence false. ADR-033, following ADR-031's precedent from `P0-07`.

That is now the same correction in two files, which makes it a pattern rather than a coincidence: the specification used `UNIQUE` as a reflex on anything that ought to be unique, without accounting for soft delete. I checked the remaining tables — `media` is the only other soft-deleted one and has no unique column, so `users` and `invitations` are the entire set.

**Two tables the card does not mention.** `invitation_preview_tokens` (in `docs/DATABASE/04`, an explicit spec ref) and `invitation_view_counts` (`docs/DATABASE/11`, listed as an invitation child in `docs/DATABASE/00`). No other schema task owns either — `P0-10` is the commercial tables. Without them, `P2-*` and `P4-09` would each add a table from a task about endpoints. Both ship here; the card's goal says the aggregate exists **in full**.

**ADR-032 is closed.** `media.invitation_id` now has its foreign key, `ON DELETE CASCADE`. drizzle-kit emitted it as an `ALTER TABLE ADD CONSTRAINT` from the schema diff, exactly as planned — no table rewrite.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/infra/db/schema/invitations.ts` | Thirteen tables |
| `backend/api/src/infra/db/schema/templates.ts` | `media.invitation_id` gains its `.references()` |
| `backend/api/src/infra/db/schema/index.ts` | Exports the new module |
| `backend/api/migrations/0003_invitations.sql` | Generated, six triggers appended |
| `backend/api/migrations/0003_invitations.down.sql` | Drops the `media` constraint **first**, then children before parent |
| `backend/api/test/integration/invitations-schema.itest.ts` | 51 tests |
| `backend/api/test/integration/templates-schema.itest.ts` | The ADR-032 test **replaced**, not deleted |
| `docs/DATABASE/04-INVITATIONS.md` | **Amended** per ADR-033 |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Slug unique among live invitations only | The document's own Notes describe this; a column `UNIQUE` contradicts them | ADR-033 |
| `invitation_preview_tokens` and `invitation_view_counts` included | No other schema task owns them; the goal says "in full" | — |
| `media.invitation_id` FK declared in Drizzle, not hand-written SQL | A hand-written constraint absent from the schema model would be dropped by the next `db:generate` | ADR-032 |
| `view_count` default written as `sql\`0\`` | drizzle-kit serialises snapshots to JSON and `JSON.stringify` throws on a BigInt literal | — |
| Six triggers, seven tables without | The other seven are append-only or write-once-then-mark | — |

## Deviations from `docs/`

**One, corrected in the same change**: the column-level `UNIQUE` on `invitations.slug` (ADR-033). `docs/DATABASE/04` amended.

Everything else matches the documents column for column, including the parts I would have written differently — `ssl_status` has no CHECK while `verification_status` beside it does, and `template_id` is stored alongside `template_version_id` even though the version already knows its template.

## Tests Added

51 in `invitations-schema.itest.ts`; 93 across all three suites.

| Group | Cases |
|---|---|
| Slug uniqueness | duplicate among live rejected; freed after soft delete; **third** live still refused; many NULL slugs allowed; all six statuses accepted, an unknown one rejected |
| Dependencies refuse deletion | user with an invitation; template version in use; template in use — all `23001` |
| Children cascade | eleven child tables parameterised, plus media and gallery |
| `media` FK (ADR-032) | a dangling `invitation_id` rejected; NULL still accepted for template assets |
| `invitation_people` | duplicate role rejected; **third person** rejected by the role CHECK; same role under a different invitation allowed |
| RSVP | `guest_count` of 0, 11, 5000, −1 rejected; 1, 5, 10 accepted; unknown attendance status rejected |
| Privacy defaults | `seo_indexable` false, and the four other settings defaults, asserted as one object |
| Status history | null `changed_by`; null `from_status` |
| Guestbook | the composite `(invitation_id, status)` index verified from `pg_indexes`; default `approved` |
| Custom domains, view counts | duplicate domain rejected; duplicate `(invitation_id, view_date)` rejected; `view_count` is bigint |
| Events | coordinates exact to six decimals; unknown type rejected |
| Triggers | `invitations` no-op vs real change; **and a sweep asserting every table with `updated_at` has a trigger** |

**Mutation-checked**, four times:

| Mutation | Result |
|---|---|
| Dropped `guest_count BETWEEN 1 AND 10` | 4 tests failed |
| Dropped `UNIQUE (invitation_id, role)` | 1 test failed |
| Flipped `seo_indexable` default to `true` | 1 test failed |
| Dropped the ADR-032 `media` foreign key | 3 tests failed |

The last one is the important one: it confirms the deferred constraint is genuinely covered from three angles, so it cannot quietly disappear.

The trigger-sweep test deserves its own note. It queries `information_schema` for any table with an `updated_at` column and no trigger referencing `set_updated_at`, and asserts the list is empty. That catches the mistake this project is most likely to repeat — adding a table and forgetting the trigger, after which the column silently reports creation time forever. It will keep working for tables that do not exist yet.

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| An invitation is not search-indexed without consent | `docs/PLAN/15` | `defaults seo_indexable to false`, mutation-checked |
| A user with invitations cannot be hard-deleted | `docs/DATABASE/01` | `refuses to delete a user who still owns an invitation` |
| A template version in use cannot be deleted | BR-3.3 | `refuses to delete a template version an invitation still uses` — the invitation-side half `P0-08` could not test |
| Guest data cannot outlive its invitation | `docs/DATABASE/01`, `docs/SECURITY/09` | Eleven cascade tests plus media |
| No media orphaned by invitation deletion | ADR-032 | `cascades media and gallery rows away with the invitation`, mutation-checked |
| RSVP input cannot claim an absurd party size | `docs/DATABASE/09` | Four rejection cases, mutation-checked |
| Preview tokens are stored hashed | `docs/DATABASE/04` | Only `token_hash` exists; there is no plaintext column to store one in |
| Moderation queue is indexed for its real filter | `docs/ARCHITECTURE/04` | `indexdef` matched against `(invitation_id, status)` |

**Not verified, and not claimed**: object-level authorization. There is still no endpoint. `docs/SECURITY/05` is `P0-11`'s to satisfy, and nothing in this task touches it.

## Definition of Done Verification

- [x] Every table, column, constraint and index in `docs/DATABASE/04`, `05`, `06` (invitation children), `09` — and `11`, which the card did not list
- [x] `invitation_settings.seo_indexable` defaults to `false`
- [x] The constraint tests pass — 51 of them
- [x] `invitation_status_history` accepts a null `changed_by`
- [x] `media.invitation_id` has its foreign key (ADR-032), and the `P0-08` test was **replaced** rather than deleted

## What Did Not Work

**drizzle-kit could not serialise a BigInt default.** `viewCount: bigint(...).default(0n)` produced `TypeError: Do not know how to serialize a BigInt` from inside the snapshot diff — drizzle-kit writes its schema snapshot as JSON, and `JSON.stringify` throws on a BigInt. Writing the default as `` sql`0` `` fixes it while keeping the column `BIGINT` as documented.

**The circular import worked, and I checked rather than assumed.** `templates.ts` now imports `invitations.ts` and vice versa. Drizzle's `.references(() => ...)` stores a callback rather than reading the table at module-evaluation time, so the cycle resolves — but that is a property of the library, not a general truth about ES modules, and it was worth confirming with a real `db:generate` before building thirteen tables on top of it.

**The down migration needs the `media` constraint dropped first.** ADR-032's `ALTER TABLE` adds a constraint to a table `0003` does not own. Dropping the invitation tables without removing it first leaves `invitations` undroppable and the rollback fails halfway — which is exactly the state `db:rollback`'s single transaction exists to prevent, but only if the SQL is right.

## Follow-Ups and Open Questions

- **`OQ-17` — `invitations.template_id` is denormalized.** It is stored alongside `template_version_id` even though the version already knows its template, and nothing stops the two disagreeing. Kept as documented. A `P0-11` repository concern, or a composite foreign key if it turns out to matter.
- **`invitation_custom_domains.ssl_status` has no CHECK** while `verification_status` does. Left as documented; same class as `OQ-16`.
- **Three suites now share one database.** `fileParallelism: false` keeps them from racing, and each truncates what it uses. This is the third task in a row where that has been noted; `P0-19` should give each suite real isolation before a fourth arrives.
- **Nothing enforces that a status change writes a history row.** `docs/DATABASE/04` puts that at the service layer deliberately, so `changed_by` and `reason` can be filled. `P0-14` builds the writer, and until it does the table can be bypassed silently.

## What to Watch

**The RESTRICT/CASCADE asymmetry is now three levels deep** — templates, invitations, and their children. It will look inconsistent to anyone reading one table at a time. The comments and the tests are the defence; the tests are the half that cannot be skimmed.

**`invitation_view_counts` has an `updated_at` trigger on an upserted counter.** The `WHEN (OLD.* IS DISTINCT FROM NEW.*)` clause matters more here than anywhere else in the schema: the flush job writes every minute, and without that clause `updated_at` would record when the job last ran rather than when activity last happened. If `P4-09` ever switches to an unconditional `UPDATE ... SET view_count = view_count`, the column stops meaning anything.

**The trigger-sweep test will catch the next missing trigger, but only for tables that have `updated_at`.** A table that should have the column and does not is still invisible to it.
