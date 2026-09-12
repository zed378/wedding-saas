# P2-01 — Template catalog API

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-2-TEMPLATE-RENDERING-AND-PREVIEW.md` § P2-01 |
| **Phase** | Phase 2 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P2-01-template-catalog` |
| **Status** | Completed |
| **Spec** | Not required by the card |

---

## What Changed

The three catalog reads from `docs/API/03`, and the application cache they sit behind —
which did not exist before this task.

| | |
|---|---|
| `GET /api/v1/templates` | filtered, paginated, published-only |
| `GET /api/v1/templates/:slug` | detail with the newest published version |
| `GET /api/v1/templates/:slug/versions/:version` | one named version, deprecated allowed |
| `infra/cache/` | **New** — `CachePort`, `RedisCache`, `CacheModule` |
| Tests | 24 integration + 12 HTTP |

## Why

`P2-01` is the card the rest of Phase 2 waits on, and it is also what unblocks Phase 1's
editor: `frontend/web-app/src/app/(app)/dashboard/new/page.tsx` renders `templates={[]}`
with a comment saying the list is empty until this exists.

## How

**Published means published at both levels.** A template row can be `published` while
every one of its versions is a draft — the normal state between an administrator creating
a template and releasing it — and such a template has nothing to render. The catalog
requires both.

**An `EXISTS`, not a join.** A join to `template_versions` returns one row per published
version, so a template with three published versions appears three times and the count
says three. The page and the count must agree or pagination promises a page that is not
there. There is a test for exactly this.

**Two statements for the list, deliberately.** The single-query version is
`DISTINCT ON (templates.id)` joined to versions — but `DISTINCT ON` requires the leading
`ORDER BY` to be the distinct expression, which forces the catalog to be ordered by uuid.
That is not an ordering, it is a shuffle. So: page the templates on their own terms
(newest first, id as tiebreak), then fetch the newest published version for exactly the
ids on that page.

**Invalidation is a generation counter.** `docs/ARCHITECTURE/06` asks for invalidation on
publish. The obvious implementation is `SCAN` + `DEL` over `tpl:*`, and it is wrong three
ways on a Redis shared with rate limiting and the queue: it walks the whole keyspace, it
is not atomic, and a key written between the scan and the delete survives — which is the
key most likely to be written. Instead every key carries a generation read from
`cache:gen:tpl`, and invalidating is one `INCR`. Orphans expire on their own TTL.

**Every cache operation fails open.** `CachePort` never throws. An unreachable Redis makes
the catalog slower, never unavailable — there is a test that runs the whole service
against a Redis on a dead port.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/infra/cache/cache.port.ts` | **New** — the interface, and why it never throws |
| `backend/api/src/infra/cache/redis-cache.ts` | **New** — generation-counter invalidation |
| `backend/api/src/infra/cache/cache.module.ts` | **New** — own client, connected at init |
| `backend/api/src/modules/template/{controller,service,repository,dto,module}.ts` | **New** |
| `backend/api/src/app.module.ts` | `CacheModule`, `TemplateModule` |
| `backend/api/src/shared/sanitizer/registry.ts` | `category`, `search`, `is_premium` exempted with reasons |
| `docs/API/03-TEMPLATE-API.md` | `supported_sections`, `current_version.status`, four rules |
| `MEMORY/DECISIONS.md` | ADR-059 |
| `backend/api/test/integration/gallery.itest.ts` | A flaky fixture fixed — see below |

## Decisions Made

| Decision | Rationale |
|---|---|
| **Anonymous**, on the `/api/v1` prefix | ADR-059. `docs/UI-UX/11` has a visitor browsing the catalog *before* registering; a 401 blocks the people the catalog exists for |
| `general-public` rate limit, keyed by IP | There is no user to key on |
| `supported_sections` **derived**, never stored | A second copy is one more thing to keep in step; disagreement shows a "Guestbook" badge on a template with no guestbook |
| Canonical section order, not the authored one | A user comparing two templates should find the same badge in the same place |
| Generation counter over `SCAN`/`DEL` | Atomic, one round trip, and does not walk a shared keyspace |
| The generation is held locally for 10s | Otherwise every read costs two round trips. `invalidate()` clears it immediately, so the publishing process never serves what it just replaced |
| Cache keys built with `JSON.stringify` | The search term is user input; any separator can appear inside it, and a key collision serves one filter's results to another |
| Draft versions invisible even to the explicit version endpoint | BR-3.3's licence is for *deprecated* versions, which were released. A draft never was |
| A `.strict()` query schema | A typo in a filter name silently returning the unfiltered catalog is worse than an error — the client believes it filtered |
| Slug and version bounded by regex | Both reach a cache key; an unbounded path parameter behind a cache is a way to fill Redis from an endpoint needing no credentials |

## Deviations from `docs/`

**Two fields added to `docs/API/03`'s example response**, and the document is amended
rather than quietly exceeded — ADR-059. `supported_sections` is required by the card's
step 6 and by `docs/UI-UX/11`; `current_version.status` lets a preview surface say which
version it is showing.

**The catalog is anonymous on a prefix whose own comment says "owners and admins".** Also
ADR-059. `docs/API/03` heads these routes "Public/Authenticated" and `docs/UI-UX/11`
settles what that means; the prefix is a routing namespace whose *default* is
authentication, not a guarantee of it.

## Tests Added

36. Integration 770 → 794, unit +12.

| Group | Cases |
|---|---|
| **Published only** | a published template appears; **draft version hidden**; **deprecated version hidden**; draft template hidden; **counted once however many published versions**; detail 404s without a published version; **the same 404 for a template that does not exist** |
| The detail shape | every field `docs/API/03` names, by exact key set; **`status` never exposed**; badges in canonical order; **the newest version wins, and `1.10.0` beats `1.9.0`** — a string sort gets that backwards |
| A named version | **a deprecated version is served**; **a draft is still refused**; another template's version number is refused |
| **Caching** | the second read is cached; `invalidate()` makes the change visible; **one bump clears list and detail together**; two filter combinations do not collide; **the catalog still answers with Redis on a dead port**; keys stay inside their namespace |
| Filters | one category out of several; search across name and category; **`100%` is text, not a wildcard**; pagination neither repeats nor skips |
| HTTP | **no Authorization header at all**; the documented envelope; 404 shape; `/versions/` not read as a slug; filters forwarded; **unknown filter rejected**; `per_page=100000` rejected; **slug and version shapes bounded**, including a 400-character version |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| Unreleased work is not readable | `docs/API/03`, BR-3.3 | **Mutation**: the published-version requirement removed from the catalog predicate and the status filter removed from the version read. Caught by three named tests — `"hides a template whose only version is a draft"`, `"hides a template whose only version is deprecated"`, `"still refuses a draft version"` |
| No tenant data is exposed | `docs/SECURITY/05` | Not applicable, and stated in the controller so a reviewer can stop: every route addresses a platform-owned template by public slug. There is no `:id` and no owner to check |
| The response cannot grow a column | `docs/SECURITY/05` § 5 | Explicit DTOs assembled field by field, plus `"never exposes the template's own status column"` |
| A cache key cannot be forced unbounded | — | `slugParamSchema` and `versionParamSchema`, with a 400-character version asserted rejected |
| A search term cannot abuse `LIKE` | — | `"treats a percent sign in a search as text, not a wildcard"` — without `escapeLike` that search returns everything |
| Filter values are not prose | `docs/SECURITY/08`, `P1-16` | Registered in `NOT_USER_TEXT` with the reason the guard demands, including why sanitizing `search` would be *wrong* rather than merely unnecessary — it would silently change what the user searched for |

## Abuse Cases Covered

- Reading an unreleased template by guessing its slug.
- Reading a draft version by naming it explicitly.
- Filling Redis by varying a path parameter, from an endpoint with no credentials.
- A `%` or `_` in a search term forcing a full scan or matching everything.
- A typo'd filter name silently returning the unfiltered catalog.

## DoD Verification

- [x] **A draft or deprecated version never appears in the catalog list.** Four tests, and
      a mutation that removes the rule fails three of them by name.
- [x] **The detail response matches `docs/API/03`'s example shape exactly** — asserted as
      an exact key set, with the document amended for the two fields the card's own step 6
      requires (ADR-059).
- [x] **The version endpoint can serve a deprecated version by explicit request** —
      `"serves a deprecated version on explicit request"`, with `"still refuses a draft
      version"` as the boundary.
- [x] **Cache invalidation on version publish is covered by a test** — three:
      the cached read, the invalidated read, and one bump clearing list and detail together.
      The admin publish endpoint that will call `invalidate()` is `P5-02`'s; the seam
      exists and is tested rather than described.

## What Did Not Work

**1. The Write tool put a literal NUL byte in a source file.** A comment mentioning
` ` as a separator was written as the actual control character, producing a file git
would treat as binary. `check-text-sources.mjs` — written after the same thing happened
during `P1-17` — is what makes this a thirty-second fix rather than a confusing diff.
Second time this exact hazard has fired, and the second time the guard caught it.

**2. `P1-16`'s sanitizer guard flagged the catalog's read filters**, and was right to ask.
`category`, `search` and `is_premium` are request strings. They are also never stored and
never rendered — the response is a list of templates, not an echo. Registered as
`NOT_USER_TEXT` with reasons, and the reason for `search` is the interesting one:
sanitizing it would be **wrong**, not merely unnecessary. A search for `<3` would silently
become a search for nothing. Its real hazards are SQL injection and `LIKE` wildcards, and
both are handled where they live.

**3. A pre-existing flaky test surfaced during the full-suite run**, failed once, then
passed twice. Worth chasing rather than shrugging at, and the cause was worth the time:
`gallery.itest.ts` built its "foreign id" as `ids[2].replace(/.$/, "0")` — a real uuid
with its last character rewritten to `"0"`. When that uuid already ended in `0`, the
"foreign" id was the **same id**, the list was a valid complete permutation, the reorder
correctly succeeded, and the test failed. One run in sixteen. Replaced with a constant no
factory produces.

That is a third distinct failure mode for this project's collection: not a test that
verified less than its name, nor code that did less than the document — a test whose
**fixture** was occasionally not the thing the test was named after.

## Follow-Ups and Open Questions

- **Nothing calls `invalidate()` yet.** `P5-02`'s admin publish and deprecate endpoints
  are its only intended callers. Until then a template published directly into the
  database is visible within the hour TTL, not immediately — fine for the seeded demo,
  and worth knowing before someone inserts a row and wonders.
- **`docs/UI-UX/11` asks for sort options** — Newest, Most Popular — and neither is
  implemented. The card's step 1 lists only the filters, and "Most Popular" needs a usage
  count that does not exist. `P2-11` builds the UI and is where this should be settled.
- **No `ETag` or `Cache-Control` on these responses.** `docs/ARCHITECTURE/06` puts a CDN
  in front of the public invitation, not the catalog API. Worth revisiting with `P2-13`'s
  performance budget.
- **The cache has no stampede protection.** `docs/ARCHITECTURE/06` § Cache Stampede asks
  for singleflight on high-traffic *invitations*; the catalog is a handful of rows and a
  simultaneous miss costs one extra query each. If the catalog ever grows, revisit.

## What to Watch

**The generation counter is held locally for ten seconds.** A publish is therefore visible
to the process that made it immediately, and to every other process within ten seconds.
That is a deliberate trade for halving the round trips, and it is the kind of number that
looks like a bug to whoever first sees a stale catalog in a second container.

**`invalidateNamespace` returning `-1` means the invalidation failed.** It logs at error
and does not throw, because the publish itself succeeded — so stale data is served until
the TTL expires. That is the one cache failure that is not self-correcting within a
request, and it is the line to grep for when someone reports "I published and nothing
changed".
