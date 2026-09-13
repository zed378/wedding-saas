# P2-07 — Public Invitation API

| | |
|---|---|
| **Task** | `P2-07` |
| **Date** | 2026-09-13 |
| **Branch** | `feat/P2-07-public-invitation-api` |
| **Status** | DONE |
| **Spec** | [`MEMORY/specs/P2-07-public-invitation-api.md`](../specs/P2-07-public-invitation-api.md) — written **before** the code this time |

---

## What changed

`GET /public/i/:slug` serves a published invitation to anybody, with no authentication:
the template's sections, theme and customizable keys, the couple, events, gallery, gift
accounts, quote and display settings, plus a server-derived `display.watermark`.

Everything that is not currently published — a draft, a `paid` but unpublished invitation,
an unpublished one, an expired one, a soft-deleted one, a slug that never existed, a slug
that could not be valid — answers a byte-identical 404.

## Why

This is the product. Every other endpoint exists so that this one has something to serve.
It is also the only unauthenticated read of user data anywhere in the system, which makes
it the one place where a mistake is visible to strangers rather than to a logged-in owner.

## How

**The query is the authorization model.** There is no owner to check, so
`status = 'published' AND deleted_at IS NULL` carries the whole weight, and it lives in the
SQL `WHERE` clause — `docs/BACKEND/06` § Slug Resolution writes it out in full, for the
same reason `docs/SECURITY/05` insists on query-level owner filters: a branch after the
fetch is a branch somebody can forget, and by then the row is in memory.

**It is a separate repository file**, `shared/tenancy/public-invitation-repository.ts`.
`InvitationRepository`'s stated contract is that *nothing* can be fetched without a
`TenantScope` or a name containing `admin`. This method would be the exception to it, and
an exception buried among forty scoped methods in two thousand lines is an exception
nobody sees. `check-tenant-scope` still requires it to live in `shared/tenancy/`, which is
right — the point is that the one query with no owner predicate sits next to the ones that
have it.

**The DTO is a whitelist, written out field by field.** The alternative — take
`toInvitationDetail` and delete the private parts — is how a field added to the owner's
response in six months silently appears on a page several hundred strangers are reading.

**A disabled section's data is decided by field paths, not by a section table** (ADR-062).
The obvious table maps `bank_accounts -> "gift"` and is wrong three ways; the third only
shows up against a real template, where `hero` lists `gallery.photos.*.media_id` because it
draws a photo behind the couple's names. See the ADR.

**Media is served as URLs.** A guest has no authenticated media endpoint, so a bare
`media_id` is unusable to them. URLs are built as `P1-19`'s gallery read builds them, with
the same rule: only for a `ready` row with a CDN configured, never a bucket URL as a
fallback.

**`display.watermark` has exactly one source** — the `has_watermark` of the package behind
the most recent **paid** order, defaulting to `true`. `docs/API/08` says it must never be
influenced by a client hint; there is no hint to ignore, because the endpoint reads no
input beyond the slug. `pending` does not count, or the watermark comes off by opening a
payment page and walking away. BR-2.8's free trial publish lands on the default, which is
correct: a trial is watermarked.

## Files touched

**New**
- `backend/api/src/shared/tenancy/public-invitation-repository.ts`
- `backend/api/src/modules/publishing/public-invitation.dto.ts`
- `backend/api/src/modules/publishing/public-invitation.service.ts`
- `backend/api/src/modules/publishing/public-invitation.controller.ts`
- `backend/api/src/modules/publishing/publishing.module.ts`
- `backend/api/test/integration/public-invitation.itest.ts`
- `backend/api/test/public-invitation-service.spec.ts`
- `MEMORY/specs/P2-07-public-invitation-api.md`

**Modified**
- `backend/api/src/app.module.ts` — registers `PublishingModule`
- `backend/api/src/modules/template/template.module.ts` — a stale expectation corrected, see below
- `docs/API/08-PUBLIC-INVITATION-API.md` — the three amendments in ADR-062
- `MEMORY/DECISIONS.md` (ADR-062), `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, `TASKS/PROGRESS.md`, `TASKS/PHASE-2-*.md`

## Decisions made

- **ADR-062** — field paths rather than a section table; `customizable_theme_keys` added to
  the response; `seo_indexable` in and `guestbook_moderation` out.
- **`P2-07` does not read the template through `TemplateService`**, against the expectation
  `P2-01` recorded in `template.module.ts`. The public endpoint joins `template_versions`
  on the invitation's own `template_version_id` in the same query that finds the
  invitation. Two reasons: the catalog cache is keyed by slug and semver, neither of which
  this endpoint holds without a further join; and BR-3.1 locks an invitation to a version
  that may since have been **deprecated**, so the catalog's visibility rules are the wrong
  question to ask about it. That module's comment is corrected rather than left claiming
  something untrue.
- **Caching is deliberately not implemented.** Reasoning in the spec § 9 and the ADR's
  last paragraph; the determinism a cache needs is asserted by a test.

## Deviations from `docs/`

Three amendments to `docs/API/08`, all additive and all in ADR-062. No behavioural
deviation.

## Tests added

| File | Count | What it proves |
|---|---|---|
| `backend/api/test/integration/public-invitation.itest.ts` | 28 | The 404 equivalence set; per-section omission with a dedicated `bank_accounts` case and a mirror "serves it when on" for each; the shared-path case; a non-configurable section the settings omit; the forbidden-key list; no owner/template identifier; the top-level key set; three watermark cases; media URLs present and absent; determinism; query parameters ignored; the limiter's headers |
| `backend/api/test/public-invitation-service.spec.ts` | 10 | The slug is validated **before** any query, proved with a repository that throws if called; normalization happens first; an invalid slug and a missing one produce the identical error |

Totals after: API integration **839** (31 files), API unit **554** (20 files).
`pnpm verify` green.

## Security verification

Named tests:

- **Nothing unpublished is served** — `public-invitation.itest.ts` → *"answers a draft, an
  unpublished, an expired and a deleted invitation identically to a slug that never
  existed"*, which asserts the status **and** the body, because a shared status with a
  differing message is still an oracle.
- **The 404 is not vacuous** — *"serves the invitation once it is published"*. Without it
  every assertion above would pass against an endpoint that returns 404 for everything.
- **No owner or commercial data** — *"contains none of the forbidden keys"* (18 keys) and
  *"contains no identifier of the owner, the template or the invitation itself"*.
- **BR-4.1** — *"omits bank_accounts entirely when the gift section is off"*, plus five
  omission cases and five matching inclusion cases.
- **The watermark cannot be influenced** — three tests; there is no client input to test
  against, so what is asserted is that the value follows the paid package and nothing else.
- **Rate limited** — *"is rate limited as a public route"*, from the policy's own headers.

**Mutation-tested**, each reverted after the run:

| Mutation | Test that failed |
|---|---|
| Drop `status = 'published'` | *"answers a draft, an unpublished, an expired and a deleted invitation identically…"* |
| Drop `deleted_at IS NULL` | same test |
| `watermark` defaults to `false` | *"is true for an invitation nobody has paid for"*, *"stays true for an order that is only pending"* |
| A `pending` order counts as paid | *"stays true for an order that is only pending"* |
| Always include `bank_accounts` | *"omits bank_accounts entirely when the gift section is off"*, *"omits gift data when that section is off"* |
| Remove the slug shape check | **nothing, at first** — see below |

## Abuse cases covered

| Abuse case | Expected | Test |
|---|---|---|
| Reading an unpublished invitation by guessing a slug | Identical 404 | the equivalence test |
| Distinguishing "never existed" from "exists but unpublished" | Same status, same body | the equivalence test |
| Harvesting owner or commercial data | Absent | the forbidden-key tests |
| Reading gift accounts with the gift section off | Absent | *"omits bank_accounts entirely…"* |
| Reading any other disabled section's data | Absent | five table-driven cases |
| Learning whether a guestbook is moderated | Absent | the forbidden-key test |
| Dropping the watermark without paying | Server-derived | three watermark tests |
| Flooding the endpoint | 429 | `general-public`, headers asserted |

## Definition of Done

**Card**

- [x] A draft, unpublished, expired or deleted slug returns an identical 404 — asserted on status and body together.
- [x] Disabled sections' data absent, proven per section, with a dedicated `bank_accounts` case — five omission tests, five inclusion mirrors, and one dedicated gift test.
- [x] No owner or commercial fields; a test asserts against an explicit forbidden-key list — 18 keys, checked over the serialized body so a nested field is caught too.

**Global**

1. [x] Tests at the right layer — integration over real HTTP against Postgres and Redis; a unit spec for the one rule HTTP cannot see.
2. [x] IDOR test — not applicable in the usual form (no `:id`, no owner). The equivalence set is its replacement and is the stronger test for this surface.
3. [x] Every abuse case has a test — table above.
4. [x] Field whitelisting — the endpoint accepts nothing; *"ignores query parameters, including personalization"* proves even `?to=` changes nothing.
5. [x] Sanitization — not applicable; nothing is written. Storage is the sanitization boundary (`docs/SECURITY/08`), so a read path cannot be where it is forgotten.
6. [x] Envelope asserted — every success assertion goes through `P0-13`'s `expectSuccess`.
7. [x] State transitions logged — none happen.
8. [x] Nothing sensitive logged — the standard request line only; the limiter hashes the guest IP.
9. [ ] **CI green — waived**, as on every task so far: no pipeline exists (`P0-17`, ADR-028). `pnpm verify` and the full integration suite pass locally.
10. [x] This record, the index, the changelog, ADR-062.
11. [x] `PROGRESS.md` and the phase checkbox, in this commit.

## What did not work

**A mutation that survived, and the test it produced.** Deleting the slug shape check from
the service changed nothing observable: an invalid slug finds no row and 404s anyway. The
check is still required — `docs/BACKEND/06` says validate *before* querying, and the point
is the round trip not taken on the product's only unauthenticated endpoint. So the rule
moved to a unit test with a repository that throws if it is called: an assertion about an
absence needs something that would notice the presence. Ten tests now fail by name when the
check is removed.

**Two runs lost to 429s that looked like a broken endpoint.** The first run of the integration
suite passed. The second returned 429 for two thirds of it. The suite makes well over
`general-public`'s hundred requests a minute from one address, and exceeding the limit earns
an escalating **auto-block** (`docs/SECURITY/10`) stored under `rl:block:*` for fifteen
minutes — so raising the limit in `RATE_LIMIT_OVERRIDES` did not help on its own, because
the block was already there. The fix is both: raise the policy and clear `rl:*` in
`beforeAll`. Worth knowing for every future suite that exercises a public route, and worth
knowing in the other direction too: that block is a real control doing its job.

**A fixture that hid a passing test.** The per-section omission test uses a template whose
sections reference only their own paths, because the reference template shares
`gallery.photos` between `hero` and `gallery`. The first version also gave the gift account
holder the groom's name — so "omit couple data" failed while the couple data was correctly
omitted, because the name was still there as an account holder. Distinct fixture values per
assertion, not realistic ones.

**The invitation id is in the payload after all**, inside every photo URL —
`invitations/{invitation_id}/media/{media_id}/large.webp` is `docs/ARCHITECTURE/05`'s
documented layout. The assertion was narrowed rather than dropped: strip the media URLs and
the id must be gone. It is not a capability — every `:id` endpoint filters on `owner_id`,
and `P1-25`'s sweep is the standing proof — but a record claiming "no identifiers are
exposed" would have been false.

## Follow-ups

- **`P2-08`** renders this payload server-side and is where a browser test belongs. It also
  owns the `/{slug}` → `/public/i/{slug}` proxying that `docs/BACKEND/06` describes.
- **`P2-09`** consumes `settings.seo_indexable`.
- **`P3-09`** should warm and invalidate this response's cache when it lands — the
  invalidation event is what the caching decision is waiting for.
- **`P3-13`**'s expiry sweep is what makes an expired invitation stop being served; until
  it exists, an invitation past `expiry_date` is still `published` and still served. The
  `status` predicate is correct; nothing sets the status yet.
- **`P4-*`** adds the RSVP, guestbook, report and view endpoints on this prefix.

## What to watch in production

- **A rising 404 rate with distinct slugs** is slug enumeration. The `general-public`
  limiter is the control; the 404 rate is how anybody would notice it working.
- **`display.watermark: false` on an invitation with no paid order** would mean the join
  found something it should not have. It cannot today — the query filters on
  `status = 'paid'` — but `P3-09` is about to start writing those rows for real.
- **Photo URLs that 404 at the CDN** mean a media row is `ready` while its variants are
  not. The read is honest about `processing`; it trusts `ready`.
