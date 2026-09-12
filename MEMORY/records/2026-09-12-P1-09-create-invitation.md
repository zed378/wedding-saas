# P1-09 — Create an invitation

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-09 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-09-create-invitation` |
| **Status** | Completed |
| **Spec** | Written into this record. The card's eight steps are themselves the specification; a separate document would have restated them |

---

## What Changed

`POST /invitations`, which creates a five-row aggregate in one transaction: the invitation
locked to a concrete template version, its settings with sections from the template, its
quote row, and **both** people rows empty.

Plus the `slug_blocklist` table (migration `0006`) and its seed, which `docs/DATABASE/12`
specifies and nothing had built yet.

## Why

`docs/API/04`, BR-1.4, BR-3.1, BR-3.3 and `docs/PLAN/10` § Subdomain. Three of those are
business rules with identifiers, and each is a rule somebody will eventually be tempted to
simplify into something that looks equivalent and is not.

## How

**The template version is resolved once, here.** BR-3.1 requires a concrete
`template_version_id` rather than "latest", because an admin editing a template must not
change the appearance of an invitation already sent to three hundred guests. Resolving at
read time *is* the bug the rule was written to prevent, so the resolution happens in this
method and nowhere else.

**A draft or deprecated version is refused for new invitations only.** BR-3.3 says a
deprecated template "can still be rendered for existing invitations that reference it", so
the check lives at creation and nowhere near the read path.

**The free-draft quota counts what has never been paid.** Not "how many drafts do you
have" — BR-1.4 and ADR-023 are explicit that "the quota limits unpaid inventory, not
customers", which is what lets a wedding organiser with five paid invitations start a
sixth. The predicate excludes the paid statuses **and** checks `invitation_status_history`,
so an invitation that was paid and later unpublished does not start counting again.

**Both people rows are created empty.** The card's step 4: every later `PATCH
/couple/groom` is then a simple `UPDATE` rather than an upsert with a race between two
tabs.

**Uppercase slugs are rejected, not normalised.** A URL path is case-sensitive. Silently
storing `budi-dan-ani` for somebody who typed `Budi-Dan-Ani` hands them an address that
does not resolve — and they may print it on a card before finding out.

**`owner_id` is not a field.** The schema is `.strict()` with three keys and the service's
input type has no owner. `docs/SECURITY/05` § 3's abuse case is not rejected so much as
inexpressible.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/shared/tenancy/invitation-repository.ts` | `createAggregate`, `slugTaken`, `findUnpaidInvitation` — see below |
| `backend/api/src/modules/invitation/invitation-create.service.ts` | **New** — the decisions; the writes are the repository's |
| `backend/api/src/modules/invitation/slug.service.ts` | **New** — format, blocklist, uniqueness |
| `backend/api/src/modules/invitation/invitation.controller.ts` | **New** |
| `backend/api/src/modules/invitation/invitation.module.ts` | **New** |
| `backend/api/migrations/0006_slug_blocklist.{sql,down.sql}` | **New** — `docs/DATABASE/12` |
| `backend/api/src/infra/db/schema/templates.ts` | `slugBlocklist` |
| `backend/api/src/infra/db/seed-data/slug-blocklist.json` | **New** — 59 reserved, 16 profanity |
| `backend/api/src/infra/db/seed.mts` | Seeds the blocklist |
| `backend/api/test/support/factories.ts` | `createTestTemplateVersion` takes a `templateId`, so two versions of one template are constructible |
| `backend/api/test/integration/invitation-create.itest.ts` | **New** — 46 tests |
| `backend/api/test/invitation-http.spec.ts` | **New** — 20 tests |

## Decisions Made

| Decision | Rationale |
|---|---|
| `slug_blocklist` ships now, not in Phase 5 | `P1-09` validates every slug against it, and a validation reading an empty table passes `admin` and `api` |
| Its seed runs in production too | Same reason. Noted in `seed.mts`: the production guards refuse the full seed, so this needs a separate path until `P5-13` |
| Uppercase slugs are rejected | A URL path is case-sensitive; silent normalisation hands the user a dead address |
| Leetspeak folding applies to substring matches only | `r0sa` must not fold into a reserved `rosa`; a stylised spelling is not evasion when the term is a routing concern |
| The newest **published** version wins for a new invitation | A template may have several published versions over time |
| The slug is checked before the quota | A rejected address should not depend on how many drafts the caller happens to have |
| An unknown template is 404, an unpublishable one is 422 | One is "no such thing", the other is "not for you, now" |

## Deviations from `docs/`

None. `slug_blocklist` is built to `docs/DATABASE/12` column for column, including the
`lower(term)` unique index and both CHECK constraints.

## Tests Added

66 (46 integration, 20 HTTP). API integration 401 → 447; unit 248 → 268.

| Group | Cases |
|---|---|
| The aggregate | settings, quote and **exactly two** people rows; **the people rows are empty, not absent**; draft status; **not indexable**; sections from the template; the initial history row; **a failure leaves nothing behind** |
| **BR-3.1** | a concrete version id; **a later published version does not move an existing invitation**; a NEW invitation gets the newest |
| **BR-3.3** | a `draft` and a `deprecated` version each refused; an unknown template is 404 |
| Slug format | ten rejections — length, case, dashes, spaces, underscores, dots, slashes, non-ascii |
| Slug blocklist | a reserved word rejected; **an exact term does not reject a slug containing it**; a substring term rejects padding; **and survives leetspeak**; **folding is not applied to exact terms**; the folding map itself |
| Slug uniqueness | **409 `SLUG_TAKEN`, not 400**; a soft-deleted invitation releases its slug |
| Owner | the service writes the token's user even when handed another id |
| **BR-1.4** | one allowed; a second refused **naming the existing one**; **a user with a PAID invitation can still create a draft**; three paid statuses each free the quota; **a `pending_payment` invitation still counts**; paid-then-unpublished does not; a soft-deleted draft frees it; another user's draft is irrelevant; nothing is written on refusal |
| HTTP | 201 and the documented fields; 401 without a token; **three owner-id spellings rejected**; the scope is the token's user; only three fields reach the service; **four non-writable fields rejected**; seven shape cases; **an unverified user may still create a draft**; 429 when limited |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| `owner_id` cannot be set from the body | `docs/SECURITY/05` § 3 | Three HTTP tests for different spellings, plus a service test that passes `ownerId` and asserts the token's user was written |
| `template_version_id` cannot be set from the body | BR-3.1/BR-3.3 | `"a body carrying template_version_id is rejected"`. Without it a client could pin an invitation to a draft version and bypass BR-3.3 |
| A deprecated template is unavailable for new invitations | BR-3.3 | Two parameterised tests. **Mutation**: removing `eq(templateVersions.status, "published")` fails both |
| The free-draft quota counts unpaid, not drafts | BR-1.4 | **Mutation**: replacing the never-paid predicate with `status = 'draft'` **passed every test in the block** on the first attempt. `"a pending_payment invitation STILL counts against the quota"` was added, and the mutation now fails |
| A reserved slug cannot shadow a public route | `docs/PLAN/10` § 2 | `"rejects a reserved word"`, and the seed covers every segment the public host serves |
| Profanity cannot be padded or leet-spelled past the filter | `docs/SECURITY/10` | Two tests, plus one asserting folding does **not** apply to reserved words |
| The aggregate is atomic | — | `"a failure leaves nothing behind"` and `"the quota is checked before anything is written"` |

## Abuse Cases Covered

All three from the card: `owner_id` in the body, a reserved slug, and bulk creation (rate
limited at 10/day, asserted at HTTP).

## DoD Verification

- [x] A created invitation has a settings row, a quote row, and exactly two people rows.
- [x] `template_version_id` points at a concrete published version, never resolved dynamically at read time. Plus the test that a later version does not move it.
- [x] A draft or deprecated template version is refused for new invitations. Two tests and a mutation.
- [x] Slug validation covers format, blocklist and uniqueness, each with a test. Ten format cases, five blocklist cases, two uniqueness cases.
- [x] `owner_id` comes from the token and cannot be set from the body.
- [x] The free-draft quota is enforced and counts only never-paid invitations, proven by a test where a user with a paid invitation can still create a draft. **And** by the `pending_payment` test the mutation forced.

## What Did Not Work

**1. `enabled_sections` was silently empty on every invitation.** The reader looked for
`section.key`; the schema's field is `section_key`. Every new invitation would have been
created with **no sections enabled** — which renders as a blank invitation rather than an
error, so nothing would have failed until somebody opened one. Caught by the test that
compares against the template's own sections; that test now also asserts the expected list
is non-empty, because comparing `[]` to `[]` is how this bug would have survived.

**2. The free-draft quota mutation passed.** Replacing the never-paid predicate with
`status = 'draft'` broke nothing, because every test set `status = 'paid'` — and a paid
invitation is not a draft either way. The distinguishing case is `pending_payment`: never
paid, not a draft, and therefore still unpaid inventory that should count. A quota written
as `status = 'draft'` would have let a user park an invitation at `pending_payment` and
start another. **Fifth time in this project a test has verified less than its name
suggested, and the fifth time only the mutation found it.**

**3. Uppercase slugs were being silently accepted and lowercased.** The service normalised
before validating. Caught by `"rejects uppercase"`; the format check now sees the raw
value.

**4. `check-tenant-scope` refused the first version of the service, and was right to.**
The aggregate insert, the slug-uniqueness query and the quota predicate all imported
`invitations` directly. Adding `modules/invitation/` to the script's ALLOWED list was the
one-line fix; the script's own comment forbids exactly that reasoning — "every future
addition deserves the same scrutiny and a sentence here saying what it costs". The cost
here would have been that the tenancy layer stops owning the column every other query
filters on, at the moment the first `owner_id` write appears.

So the writes moved. `createAggregate`, `slugTaken` and `findUnpaidInvitation` are now in
`InvitationRepository`, which is a better home for them anyway: `slugTaken` is the one read
in that file with **no owner predicate** — the slug is a global public namespace — and it
now carries the paragraph saying so, where a reviewer reading the tenancy layer will see
it rather than finding it in a service where it would look unremarkable.

## Follow-Ups and Open Questions

- **The blocklist seed needs a production path.** `seed.mts` refuses to run in production
  by design, but the blocklist is needed there — an empty table accepts `admin` and `api`
  as slugs. Until `P5-13` gives admins a write path, it must be seeded deliberately. Noted
  in `seed.mts` itself.
- **The blocklist is not cached.** `docs/DATABASE/12` § Seeding and Caching asks for Redis
  caching invalidated on admin edit. Two queries per slug check is fine at this volume;
  `P5-13` should add the cache when it adds the writes.
- **The starter profanity list is small and Indonesian-plus-English.** It is a starting
  point, not a curation. `P5-13` owns growing it.
- **`P1-10` must apply `expectIdorSafe`** to list, detail, update and delete. This task has
  no `:id` route, which is why `check-id-endpoint-tests` had nothing to say about it.

## What to Watch

**Anything that resolves a template version at read time is a BR-3.1 regression.** The rule
looks like an optimisation waiting to happen — "why store the version when we can look it
up?" — and the answer is that a published invitation's appearance must not change. The
test named `"a later published version does not move an existing invitation"` is what
stands between that instinct and three hundred guests seeing a different page.

**The quota predicate is longer than it looks like it needs to be.** The `NOT EXISTS` on
`invitation_status_history` handles paid-then-unpublished, and the status exclusion handles
the common case. Collapsing either into `status = 'draft'` is the exact mutation that
passed here before the `pending_payment` test existed.
