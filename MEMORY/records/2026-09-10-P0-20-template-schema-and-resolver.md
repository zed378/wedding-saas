# P0-20 — Template schema definition and field resolver

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-20 |
| **Phase** | Phase 0 |
| **Surface** | backend, packages, web-app |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-20-template-schema` |
| **Status** | Completed |
| **Spec** | [`MEMORY/specs/P0-20-template-schema-and-resolver.md`](../specs/P0-20-template-schema-and-resolver.md) |

---

## What Changed

`@wi/schema` stopped being a placeholder. It now holds four things the rest of the product reads:

1. **The canonical field-path registry** — every path a template may reference, derived from `docs/PLAN/08` and checked against the columns `P0-09` actually created.
2. **The section and component registries** — ten section keys, eleven component names, each component bound to the one section it renders.
3. **Zod schemas for `template_versions.sections` and `.theme`**, plus `validateTemplateVersion()` which cross-checks `customizable_theme_keys` against the theme it accompanies.
4. **The dot-notation resolver** — `resolvePath`, `isEmpty`, `isPathMissing`, and `collectMissingRequiredFields`, the implementation of `docs/BACKEND/03`'s publish algorithm.

Plus a build guard, `scripts/check-template-version-writes.mjs`, so `docs/DATABASE/03`'s "validated before being saved" survives contact with Phase 5.

## Why

`docs/PLAN/07` calls itself "the single most critical document for the product's architecture", and `docs/PLAN/16` § Critical Dependencies makes the template system a hard prerequisite for editor work. Everything downstream reads this schema.

The concrete failure it prevents is quiet. A template that asks for `couple.groom.nickmame` is valid JSON, passes every type check, stores happily in a `JSONB` column, and renders an empty hero on every invitation that uses the template — forever, because BR-3.1 locks a version. `sections` and `theme` are `JSONB`, so the database cannot help: Postgres accepts any well-formed JSON at all.

## How

**The registry is validated against something other than itself.** `P0-12`'s redaction test generated its payload from the redactor's own key list, so deleting a key removed it from both sides; `P0-19.1` found the same shape again in the logger suite. So the first test here walks every registered path against a **hand-written** complete invitation (`src/testing/complete-invitation.ts`). A path that names a field the data model does not have resolves to nothing and the test says which.

**Emptiness is a function, not `!value`.** `order: 0` and `is_cover: false` are legitimate stored values and a truthiness check reports both as missing. The three cases that must *not* count as empty carry more weight in the suite than the ones that must.

**A wildcard path is missing when *any* element is empty.** Two events where one has no date is not a publishable invitation. The other reading — "some event has a date, good enough" — publishes a page with a blank event card, which is the outcome BR-4.2 exists to prevent. Fail closed, per `docs/SECURITY/00`.

**The resolver cannot fetch.** It is a pure function over an already-assembled object, in a package with no database dependency. That is structural rather than a rule: a resolver that could load data would be a second data-access path with no tenant scope, which is what `scripts/check-tenant-scope.mjs` exists to prevent.

**Every rejection is reported, not just the first.** Same reasoning as `P0-04`'s environment schema: an admin fixing one rejection per round trip is how validators end up bypassed. The `field` in each detail is a pointer a frontend can display — `sections[1].required_fields[0]` — per `docs/BACKEND/03` § Error Messages.

**Unknown paths get suggestions.** "unknown field path: couple.groom.nickmame" is useful; adding "did you mean couple.groom.nickname?" is the difference between a five-second fix and a trip through `docs/PLAN/08`.

## Files and Components Touched

| Path | Change |
|---|---|
| `packages/schema/src/invitation/field-registry.ts` | **New** — 39 canonical paths, `isCanonicalFieldPath`, `suggestFieldPaths` |
| `packages/schema/src/invitation/invitation-data.ts` | **New** — the runtime shape those paths walk |
| `packages/schema/src/template/component-registry.ts` | **New** — ten section keys, eleven components, each bound to one section |
| `packages/schema/src/template/section.schema.ts` | **New** — the section entry plus six cross-field rules |
| `packages/schema/src/template/theme.schema.ts` | **New** — colours, typography, spacing, radius, and `themeKeyResolves` |
| `packages/schema/src/template/template-version.ts` | **New** — `validateTemplateVersion`, `assertValidTemplateVersion` |
| `packages/schema/src/resolver/resolve-path.ts` | **New** — `resolvePath`, `isEmpty`, `isPathMissing` |
| `packages/schema/src/resolver/completeness.ts` | **New** — `collectMissingRequiredFields`, `isSectionEnabled` |
| `packages/schema/src/testing/complete-invitation.ts` | **New** — every path filled; `P0-21`'s demo seed will need it too |
| `scripts/check-template-version-writes.mjs` | **New guard**, blocking in `verify.sh` and `.githooks/pre-push` |
| `backend/api/test/support/factories.ts` | `createTestTemplateVersion` now validates, and writes `customizable_theme_keys` |
| `backend/api/test/integration/harness.itest.ts` | Fixture updated; new test that the factory **refuses** an invalid definition |
| `backend/api/test/surfaces.spec.ts` | Cross-boundary test asserts registry content, not a pinned literal |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| `section_key` is a closed enum | Template switching matches on it; free text scrambles a user's toggles silently | ADR-037 |
| A component is bound to one section | A real component under the wrong key renders a hero where the gallery belongs | ADR-037 |
| The component registry is append-only | BR-3.1 locks versions forever; removing a name breaks every invitation using it (R5) | ADR-037 |
| `border_radius` and `scale` enumerated with invented values | An unknown CSS token renders as nothing, not as an error | ADR-038, OQ-20 |
| `customizable_theme_keys` is a column, not part of `theme` | `docs/DATABASE/03` and `docs/API/03` agree; `docs/PLAN/07`'s prose is ambiguous | — |
| `event` is one section key | `docs/PLAN/07` draws Akad and Reception beneath it, but those are rows of `invitation_events` | — |
| Only a theme **leaf** may be customizable | A group would let an override replace the whole object, including keys the template never exposed | — |
| `settings.*` and guest-submitted data excluded from the registry | A template selects content; requiring RSVP entries would make publishing impossible | — |

## Deviations from `docs/`

None, and no amendment. Two apparent contradictions were resolved by reading rather than by changing a document:

1. **Where `customizable_theme_keys` lives.** `docs/PLAN/07` mentions it in prose beside the theme block; `docs/DATABASE/03` makes it a column and `docs/API/03` returns it as a sibling of `theme`. Two documents against one, and the physical schema is the tiebreak.
2. **Whether `event` is one section or two.** `docs/PLAN/07` § Section System draws Akad and Reception nested under Event; `docs/PLAN/08` says an invitation has 1..N events. One section key, whose component renders the collection.

`docs/PLAN/07` § Theme Variables is genuinely incomplete on two enumerations — recorded as OQ-20 and decided provisionally in ADR-038 rather than amended, because the answer belongs to whoever owns the design system.

## Tests Added

100 unit in `@wi/schema`, plus one new integration test. Workspace totals after: 100 `@wi/schema`, 47 `@wi/logging`, 47 `@wi/storage`, 74 `@wi/api` unit, 6 `@wi/worker`, **185 `@wi/api` integration**, 7 E2E.

| Group | Cases |
|---|---|
| Registry | no duplicates; **every path resolves against a hand-written complete invitation**; named counts per entity; the three collections; `settings.*` absent; guest-submitted data absent; every path names its table |
| `isCanonicalFieldPath` | accepts a real path; rejects a typo; rejects a *prefix* of a real path; rejects `__proto__`/`constructor` shapes |
| `resolvePath` | nested scalar; collection; wildcard in order; **holes preserved**; absent key; absent parent without throwing; null parent; wildcard over a non-array; numeric index; **refuses `__proto__`, `constructor`, `prototype`**; **an inherited key cannot answer for the object** |
| `isEmpty` | 8 empty cases including whitespace-only and an invalid `Date`; **6 non-empty including `0`, `false` and `"0"`** |
| `isPathMissing` | filled; absent; whitespace; `false`/`0` present; empty collection; wildcard over empty; **wildcard missing when any element is empty**; wildcard present only when all filled; nested wildcard not "present" merely for being an array |
| Section validation | valid accepted; unknown path **naming it**; suggestion offered; unknown path in `optional_fields`; prototype-shaped path; path in both required and optional; unknown component; **component registered for a different section**; valid alternatives named; unknown `section_key`; duplicate `section_key`; non-configurable + default-off; default layout absent from options; single-entry `layout_options`; duplicate options; layout variant carrying a CSS payload; `max_items: 0`; unknown property rejected rather than ignored; empty `sections` |
| Theme | valid; missing colour key; malformed hex; three-digit hex accepted; unknown `spacing`; unknown `border_radius`; font name carrying a CSS payload |
| `customizable_theme_keys` | leaf accepted; unresolvable key; **a whole group rejected**; duplicate; longer than `VARCHAR(60)` |
| Error reporting | every problem at once; section and theme problems together; **an invalid theme does not bury itself under key errors**; pointers a frontend can display |
| Completeness | complete reports nothing; exactly the missing paths with their sections; **a disabled section is skipped (BR-4.1)**; **a non-configurable section is checked even when absent from `enabled_sections`**; one of two events incomplete; optional field does not block; everything at once in deterministic order; a path required by two sections |
| Registries | every component binds to a known section key; every section key has at least one component |
| Integration | the factory round-trips a valid definition; **the factory refuses one the validator rejects** |

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| A template cannot reference a path outside the canonical model | `docs/PLAN/08` § Design Principles | `template-version.spec.ts` → "rejects an unknown field path, naming it". **Mutation**: replacing the registry check with `if (true) return` fails 6 named tests |
| Prototype pollution through a field path | `docs/SECURITY/08` | Two independent locks, each tested: the registry rejects `__proto__.polluted` at validation, and `resolvePath` refuses the segment regardless — "refuses `__proto__`, `constructor` and `prototype` segments" |
| An inherited key cannot masquerade as data | `docs/SECURITY/08` | "does not let an inherited key answer for the object" — `Object.hasOwn`, not `in` |
| A section cannot name a component that does not render it | R5, `docs/PLAN/18` | "rejects a real component registered for a different section". **Mutation**: disabling the binding check fails 2 named tests |
| A theme value cannot carry a CSS payload | `docs/SECURITY/08` | "rejects a layout variant outside the safe character class" and "rejects a font name carrying a CSS payload" |
| Publish is blocked on an empty required field | BR-4.2 | `completeness.spec.ts`, 9 cases. **Mutation**: making `isEmpty` ignore whitespace fails 3 named tests |
| A user cannot publish a half-filled always-on section by disabling it | BR-4.2 + `docs/FRONTEND/04` step 2 | "still checks a non-configurable section absent from enabled_sections" |
| The resolver cannot become an unscoped data path | `docs/SECURITY/05` | Structural: `@wi/schema` has one dependency, `zod`. No database client, no `pg`, no Drizzle |
| A definition cannot reach the database unvalidated | `docs/DATABASE/03` § Schema Validation | `scripts/check-template-version-writes.mjs`, blocking. **Mutation**: adding a file with a raw `INSERT INTO template_versions` and no validator mention fails the guard, exit 1, naming the file |

## Abuse Cases Covered

Every row of the spec's § 11 table became a test, and all nine are listed above. The one worth naming separately: a template definition is admin-authored, and *"the input is trusted"* is the sentence that precedes most prototype-pollution advisories — which is why the resolver refuses `__proto__` even though the registry already did.

## DoD Verification

Task card:

- [x] **A section definition with an unknown field path is rejected with a message naming the path** — and suggesting the near miss.
- [x] **A section definition naming an unregistered component is rejected** — plus the stricter case the card did not ask for: a registered component under the wrong section key.
- [x] **The resolver lives in one shared package imported by both the API and the frontend** — `@wi/schema`. The API imports it (`backend/api/test/surfaces.spec.ts` asserts the import resolves across the workspace boundary over real HTTP). The frontends are `P0-22`; the package is a workspace dependency they will add, and nothing about it is backend-specific — it has no Node-only import at all.
- [x] **Emptiness semantics explicit and tested** — the table is in `resolve-path.ts` and each row is a case.

Global DoD:

- [x] Feature spec written **before** the code (`Spec required: Yes`), and its § 14 open question is now OQ-20.
- [x] `bash scripts/verify.sh` — every step ok, including the new guard.
- [x] Integration suite run against a real PostgreSQL 18: **185 passed**.
- [x] Security controls named with the tests that prove them; three mutations measured.
- [x] MEMORY record, index line, changelog, two ADRs, backlog entry, board and phase card updated.

## What Did Not Work

**1. Two of my own tests contradicted each other, and the contradiction was the design.**

"reports every problem at once" used an invalid theme *and* an unresolvable `customizable_theme_keys` entry, and expected both to be reported. It cannot be: an invalid theme suppresses the key checks deliberately, because running them against a theme that failed to parse would report every key as unresolvable and bury the real cause — which is exactly what the *next* test asserts.

The implementation was right and the expectation was wrong. Split into two tests: one for "many problems at once" with a valid theme, one for "section and theme problems together".

**2. The test factory had been writing definitions nothing could render.**

`createTestTemplateVersion` produced `theme: { "--color-primary": "#b76e79" }` — a CSS custom property, not the documented theme shape — and a section with no `configurable` key. It did not matter while nothing read the column. It would have mattered the moment something did, and by then every integration test would have been carrying invalid data.

Now it calls `assertValidTemplateVersion`, which makes it one of the two writers `docs/DATABASE/03` § Schema Validation is about, and there is a test that it **refuses** an invalid definition.

**3. The guard's first run flagged five test files, and the fix was to exempt tests.**

The `P0-08`/`P0-09`/`P0-10` suites insert `template_versions` with raw SQL to prove foreign keys, CHECK constraints and NOT NULL behaviour. Those tests need a row, not a renderable design, and some need a deliberately malformed one. The exemption is legitimate and it is a hole, written into the guard beside it — the same shape as the logger guard's test exemption from `P0-19.1`, and the same risk: a test can create a state the application cannot.

**4. A pinned literal in an unrelated test.**

`surfaces.spec.ts` asserted `schemaContractVersion === 0`, and bumping the constant to `1` failed a test that was not about the number. Rewritten to assert against the imported constant — plus a second assertion with actual content, because two zeros agreeing across a wire proves nothing.

**5. The integration run pointed at the wrong database, twice.**

`TEST_DATABASE_URL` reached the `P0-19` harness but not the older `P0-08` schema suites, which have their own connection helper defaulting to `localhost:5432` — where an unrelated PostgreSQL was listening and rejecting the password. Both `TEST_DATABASE_URL` and `MIGRATION_DATABASE_URL` have to be set. Two connection helpers is one too many; noted as a follow-up rather than fixed here.

## Follow-Ups and Open Questions

- **OQ-20** — the real vocabulary for `border_radius` and `typography.scale`. Decided provisionally (ADR-038); cheap to change while one template exists.
- **The renderer owes this package a parity test.** Nothing today proves the eleven component names correspond to real components. `packages/template-renderer` (`P0-22`/Phase 2) must assert both directions; the obligation is written into `component-registry.ts`.
- **The Phase 5 admin endpoints must use `validateTemplateVersion`, not `assertValidTemplateVersion`.** An admin pasting JSON deserves `details[]`, not a stack trace. The guard checks that *a* validator is mentioned, not which one.
- **A future tightening of the schema can invalidate stored definitions.** From Phase 5 there will be admin-authored versions in the database, and no mechanism sweeps them. Inventing one now would be speculative; the first schema change after Phase 5 must not be.
- **Two database connection helpers in the API's tests.** `test/support/harness.ts` (`P0-19`) and the older `P0-08` helper read different environment variables and have different defaults. They should be one.
- **`@wi/schema` has no `test:integration` script and needs none** — every export is pure. Stated so the absence is not read as an oversight.

## What to Watch

**The field registry is the fourth hand-maintained list in this repository**, after `check-tenant-scope`'s allowlist, the redactor's key set, and the component registry itself. Unlike the others, this one has a test that walks it against real data — which catches a *wrong* entry but not a *missing* one. When `P1` adds a column to `invitation_events`, nothing will notice that no path names it. The symptom is a field the editor can fill and no template can display.

**`COMPLETE_INVITATION` will be edited to suit a test.** It is exported, and the registry test's whole value depends on it staying complete. A field removed from it to make some other test convenient silently turns the registry test into a weaker claim.

**The wildcard emptiness rule is strict, and someone will want to relax it.** "Two events where one has no end time" is a real support conversation — except `end_time` is optional and would never be in `required_fields`. Relaxing the rule for a required field means allowing a published page with a blank card on it.
