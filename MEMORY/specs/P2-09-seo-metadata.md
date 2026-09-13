# P2-09 — Feature Spec: SEO Metadata, Robots and Structured Data

| | |
|---|---|
| **Task** | `P2-09` |
| **Date** | 2026-09-13 |
| **Author** | Claude Opus 5 |
| **Status** | Implemented |

---

## 1. Goal

An invitation shared into WhatsApp, Facebook or Telegram produces a preview card with the
couple's names, the date, the venue and the cover photo. A search engine is told **not** to
index it unless the couple explicitly asked to be indexed. A crawler that wants structured
data gets the ceremony's time and place and nothing about anybody's money or guests.

This task is `Spec required: Yes — privacy`, and privacy is the whole of why: a link preview
is cached on three companies' servers and a search index is cached publicly, both for far
longer than the page itself lives.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/PLAN/15-SEO.md` | § Public Invitation Page | The tag list; canonical on the active address; **default `noindex`**; schema.org `Event` optional and without sensitive data |
| `docs/FRONTEND/07-PUBLIC-INVITATION.md` | § SEO Meta Generation | `og:image` from the `is_cover` photo, falling back to the template thumbnail; `robots` follows `seo_indexable` |
| `docs/SECURITY/09-PRIVACY-DATA-PROTECTION.md` | line 22 | `seo_indexable = false` by default, because the page contains guest info and RSVP data |
| `docs/API/08` | response | Where the values come from |

The three agree. `docs/PLAN/15` phrases the robots rule as *"`noindex` can optionally be
enabled by the user … Default: `noindex`"*, which reads ambiguously on first pass — the
default is `noindex`, and what the user opts into is indexing. `docs/SECURITY/09` settles it
in one line.

## 3. Business Rules Implemented

No `BR-x.x` rule covers SEO. The governing rule is the privacy default in
`docs/SECURITY/09`, implemented as `isIndexable()`.

## 4. API Contract

Consumes `GET /public/i/:slug`. One **addition** to it, in this task: `template.thumbnail_url`,
so the `og:image` fallback `docs/FRONTEND/07` specifies can actually be implemented (ADR-064).
`docs/API/08` amended.

Emits, in the document `head`:

| Tag | Value |
|---|---|
| `<title>` | `Undangan Pernikahan {nicknames}` |
| `description`, `og:description`, `twitter:description` | `{names} mengundang Anda · {date} · {venue}.` |
| `og:title`, `twitter:title` | as the title |
| `og:url`, `link rel=canonical` | `{origin}/{slug}` |
| `og:type` | `website` |
| `og:locale` | `id_ID` |
| `og:image`, `twitter:image` | the `is_cover` photo, else the first photo, else the template thumbnail, else absent |
| `twitter:card` | `summary_large_image` |
| `robots` | `noindex, nofollow` unless `seo_indexable === true` |
| `<script type="application/ld+json">` | schema.org `Event`, or absent |

## 5. Data Model Impact

One additional column read: `templates.thumbnail_url`, joined in
`PublicInvitationRepository`. No migration.

## 6. Authorization

None. Everything emitted is already on the page a guest can read. The relevant control is
the opposite of authorization: deciding what **not** to emit to an audience that never
opens the page.

## 7. Validation and Sanitization

- **`seo_indexable` fails closed** — `=== true`, so a missing field, a `null` or a string
  means "do not index". ADR-064 explains why the asymmetry is deliberate.
- **JSON-LD is escaped for its context.** A venue name is user text, sanitized on the way in
  against HTML but not against being inside a `<script>` element, where the only sequence
  that ends the element is `</script`. `safeJsonLd` replaces every `<` with its JSON
  unicode escape — identical to a JSON parser, and impossible to close the element with.
- **Nothing is accepted from the client.** No query parameters are read; a `?to=` value must
  never reach a meta tag, or a crafted link would produce a preview card carrying an
  attacker's text under the couple's name.

## 8. State Transitions

None.

## 9. Side Effects

None.

## 10. Failure Modes

| Failure | Behaviour |
|---|---|
| No cover photo | The first photo; then the template thumbnail |
| No photos and no thumbnail | `og:image` absent — a card with no image rather than a broken one |
| No event | No description date, and **no** JSON-LD: structured data describing nothing is worse than absent, because a crawler believes it |
| An event with no date | No JSON-LD, same reason |
| No names at all | `Undangan Pernikahan`, and a generic description |
| The `seo_indexable` field is absent or malformed | `noindex` |

## 11. Abuse Cases

| Abuse case | Source | Expected | Test |
|---|---|---|---|
| A wedding page indexed by Google with guest names in it | `SECURITY/09` | `noindex` by default | "is noindex when the owner has not enabled indexing", plus four malformed-value cases |
| An already-indexed page keeping its cached cover photo after indexing is turned off | `PLAN/15` | `noimageindex` | "also asks Google not to keep an image when indexing is off" |
| Account numbers or guest data reaching a crawler through structured data | `PLAN/15`, `SECURITY/09` | Absent | "contains no account number and no guest information"; "exposes only the properties it was designed to" |
| A venue name closing the JSON-LD script element | `SECURITY/08` | Escaped | "escapes a venue name that tries to end the element" |
| A crafted `?to=` value appearing in a preview card | `API/08` § Caching | No query parameter is read | `P2-08`'s "ignores query parameters, including personalization" |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit | `metadata.spec.ts` — 24: the default and four malformed shapes, the card's tags, the image fallback chain, the JSON-LD's exact key set and its escaping |
| SSR | 6 added to `initial-html.ssr.ts` — the tags, the canonical link, `noindex` and its absence, the JSON-LD block parsed out of the document, the thumbnail fallback |
| Integration | 1 added to `public-invitation.itest.ts` — the payload carries `thumbnail_url` |
| Manual | **Step 6 of the card cannot be automated**: real WhatsApp, Facebook and Telegram scrapers against a staging invitation. Recorded as an open operational item. |

## 13. Observability

Nothing new. A preview that renders wrongly is visible only by sharing a link, which is why
step 6 exists.

## 14. Open Questions

None. One **operational** item, not an open question: the real-scraper check needs a
published invitation on staging and three external services, and it belongs to the project
owner rather than to a test suite.
