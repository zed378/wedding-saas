# P2-09 — SEO Metadata, Robots and Structured Data

| | |
|---|---|
| **Task** | `P2-09` |
| **Date** | 2026-09-13 |
| **Branch** | `feat/P2-09-seo-metadata` |
| **Status** | DONE — with one DoD item that only a human can close |
| **Spec** | [`MEMORY/specs/P2-09-seo-metadata.md`](../specs/P2-09-seo-metadata.md) |

---

## What changed

A shared invitation produces a proper preview card — couple, date, venue, cover photo, large
image format — and a search engine is told **not** to index it unless the couple asked. A
crawler that wants structured data gets a schema.org `Event` with the ceremony's time and
place and nothing else.

`template.thumbnail_url` joined the public payload so the `og:image` fallback that
`docs/FRONTEND/07` specifies could actually be built (ADR-064).

## Why

`docs/SECURITY/09` gives the reason in one line: the page carries guest information and RSVP
data, so it must not be indexed without explicit consent. The flip side is that a link
*preview* is the product's entire distribution mechanism — an invitation reaches its guests
by being pasted into WhatsApp, and a card with no image and a generic title is a worse first
impression than the page could ever recover from.

Both audiences are wider and longer-lived than the page itself: Facebook, WhatsApp and
Telegram cache a preview on their own servers, and a search index caches publicly.

## How

**The construction is a pure function** in `lib/metadata.ts`, not inline in
`generateMetadata`. Everything that can reach a scraper is therefore a list somebody can
read in one file, and the test asserts over the whole serialized result rather than
field by field — a check that `og:title` is right says nothing about what else got in.

**`seo_indexable` is read as `=== true`.** Not `!== false`. A missing field, a `null`, a
string `"true"` from some future serializer: all mean "do not index". The asymmetry is
deliberate and ADR-064 argues it — indexing a page that should have been private publishes
a stranger's name into a cache and nobody notices; failing to index a page the couple wanted
indexed is visible to them and fixed by a redeploy.

**`noimageindex` accompanies `noindex`.** `index: false` alone leaves an already-indexed
page's cached image in results, and the image on a wedding invitation is the couple's faces.

**Structured data is a whitelist with an argued absence.** No `performer`, no `attendee`, no
`offers`: the couple are not performers, the guests are not public data, an invitation is not
ticketed — and each of those properties is an invitation to put a name or a price where one
does not belong. The test asserts the exact key set, so adding one is a deliberate act.

**No JSON-LD at all when there is no event or no date.** Structured data that describes
nothing is worse than absent, because a crawler believes it.

**JSON-LD is escaped for its own context**, in `lib/json-ld.ts`. A venue name is user text,
sanitized on the way in against HTML but not against sitting inside a `<script>` element —
where a `<` is not markup and the one sequence that ends the element is `</script`. Every
`<` becomes its JSON unicode escape: identical to a JSON parser, impossible to close the
element with.

## Files touched

**New**
- `frontend/public-invite/src/lib/metadata.ts`, `src/lib/json-ld.ts`
- `frontend/public-invite/test/metadata.spec.ts`
- `MEMORY/specs/P2-09-seo-metadata.md`

**Modified**
- `frontend/public-invite/src/app/[slug]/page.tsx` — `generateMetadata` delegates; the JSON-LD script
- `frontend/public-invite/src/lib/public-invitation.ts` — `template.thumbnail_url`
- `frontend/public-invite/test-ssr/initial-html.ssr.ts` — 6 metadata tests, two stub modes, and the stale-server guard below
- `backend/api/src/shared/tenancy/public-invitation-repository.ts` — joins `templates` for the thumbnail
- `backend/api/src/modules/publishing/public-invitation.dto.ts`, its integration test
- `docs/API/08-PUBLIC-INVITATION-API.md` — `template.thumbnail_url` (ADR-064)
- `scripts/check-no-hardcoded-fields.mjs` — one allowlist entry
- `MEMORY/DECISIONS.md` (ADR-064), index, changelog, `TASKS/PROGRESS.md`, the phase file

## Decisions made

- **ADR-064** — `seo_indexable` fails closed; `template.thumbnail_url` added to the payload;
  `noimageindex` when indexing is off.

## Deviations from `docs/`

One additive amendment to `docs/API/08` (the thumbnail). `docs/PLAN/15` and
`docs/FRONTEND/07` are implemented as written.

## Tests added

| File | Count | What it proves |
|---|---|---|
| `test/metadata.spec.ts` | 24 | The `noindex` default and four malformed shapes; the card's tags; the image fallback chain including "neither"; the JSON-LD's exact key set, its absence without an event or a date, and its escaping against a hostile venue name |
| `test-ssr/initial-html.ssr.ts` | +6 (17) | The tags reach the document; the canonical link; `noindex` present when private and absent when public; the JSON-LD block parsed out of the real HTML; the thumbnail fallback |
| `backend/api/test/integration/public-invitation.itest.ts` | +1 (30) | The payload carries `thumbnail_url` |

Totals after: API integration **841**, public-invite **71** plus **17** SSR.
`pnpm verify` green.

## Security verification

Named tests, and mutation-verified — each mutation reverted after its run:

| Mutation | Test that failed |
|---|---|
| `seo_indexable` read as `!== false` | the four *"is still noindex when …"* cases |
| `noimageindex` dropped | *"also asks Google not to keep an image when indexing is off"* |
| The first photo used instead of the `is_cover` one | *"uses the photo marked as the cover, not the first one"* |
| The thumbnail fallback removed | *"falls back to the template thumbnail when there is no cover photo"* |
| Gift accounts added to the JSON-LD as `offers` | *"contains no account number and no guest information"*, *"exposes only the properties it was designed to"* |

The last one is the one worth keeping: it is exactly the mistake a well-meaning change would
make — `offers` looks like the right schema.org property for a gift registry — and two tests
refuse it.

## Abuse cases covered

Every row of the spec's § 11. The `?to=` case is `P2-08`'s test, which asserts the endpoint
and the page both ignore query parameters, so no crafted value can reach a meta tag.

## Definition of Done

- [x] A shared link shows the cover photo and couple names — **in the emitted document**, asserted from the real HTML. The DoD says "in WhatsApp, Facebook and Telegram", which is step 6 and is below.
- [x] `noindex` is present unless the owner explicitly enabled indexing; a test asserts the default. — five tests, and a mutation that relaxes the check fails four of them.
- [x] Structured data contains no bank account or guest information. — asserted over the serialized object and as an exact key set.
- [x] The fallback image path works for an invitation with no cover photo. — and the second fallback, and the case where there is nothing at all.

**Global DoD**: as `P2-08`, with item 9 (CI) waived for the same reason. This task's own spec
exists and was written before the code.

### Step 6 is not done, and cannot be done from here

The card asks: *"Verify with the real scrapers, not just a unit test: WhatsApp, Facebook and
Telegram link previews on a staging invitation."*

That needs a **published** invitation on staging — which needs `P3-09`'s publish endpoint,
since nothing can currently move an invitation to `published` through the API — and it needs
three external services to fetch a public URL. Neither is something a test suite can do.

It is recorded as an operational item for the project owner rather than marked done, because
the three scrapers genuinely disagree with each other about image dimensions, redirects and
cache behaviour, and a passing unit test is not evidence about any of them.

## What did not work

**The stale-server trap, which `P1-21` already recorded.** Three assertions failed against a
page that was in fact correct, because a `next start` left over from an earlier run was still
answering on the port and serving a build from before the change. The symptom — a feature
missing from the HTML — looks exactly like the feature being broken, and I went looking in
the page component before checking the port.

Two fixes, both in the suite: it now **refuses to start** if anything is already listening,
with the command to clear it; and cleanup uses `taskkill /T` through **`spawnSync`**, because
an asynchronous kill in `afterAll` never runs — the process exits first. Verified by running
the suite twice in a row and confirming nothing is left listening.

The Windows detail worth keeping: with `shell: true`, `child.kill()` reaps `cmd.exe` and
leaves `node` holding the socket. That is structural, not carelessness, and it will happen
to the next suite that spawns a server.

**A mangled escape sequence, twice, in the same hour.** `"\\u003c"` written through a Python
heredoc became a literal `<`, making the JSON-LD escaping a silent no-op; and the same
mistake in a markdown file turned prose about the escape into prose about `<`. The rule from
`P2-04` and `P2-08` applies to *prose about code* as well as to code: anything containing a
backslash escape gets written with the file tools. `check-text-sources.mjs` catches the
control-character version; it cannot catch this one, which is why the unit test asserting
`not.toContain("</script")` matters.

**`replace(/</g, "\\u003c")` would have been wrong even spelled correctly** — a regex
replacement string treats a backslash specially. It is `replaceAll` with two plain strings
for that reason, and the comment says so.

## Follow-ups

- **The three real scrapers**, once `P3-09` can publish. Project owner.
- **`P2-13`** — the budget. This task added no client JavaScript (the JSON-LD is a string in
  the HTML), so the 138.6KB figure stands.
- **`P5-13`**'s slug blocklist should include `preview`, which `P2-08`'s route allowlist
  reserves on this host.
- **A sitemap** is out of scope here and belongs to the marketing pages (`docs/PLAN/15`
  § Marketing Pages), which are `web-app`'s.

## What to watch in production

- **An invitation appearing in Google that the couple did not opt in to.** It should be
  impossible; if it happens, the cause is either the payload losing `seo_indexable` or a
  crawler that indexed the page before the setting was turned off — `noimageindex` limits
  the second, nothing undoes it.
- **A preview card with no image.** Means both the gallery and the template thumbnail were
  empty, which is a seeding problem in the template catalogue rather than a page bug.
- **A JSON-LD parse error reported by Search Console** would mean a value escaped the
  serializer. The escaping is tested against `</script`; it is not tested against every
  possible Unicode line terminator, which is the thing to look at first.
