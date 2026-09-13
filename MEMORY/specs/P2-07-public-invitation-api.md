# P2-07 — Feature Spec: Public Invitation API

| | |
|---|---|
| **Task** | `P2-07` |
| **Date** | 2026-09-13 |
| **Author** | Claude Opus 5 |
| **Status** | Draft — written before implementation |

---

## 1. Goal

A guest holding `invitation.vizunicum.my.id/andi-sarah` can be served everything needed to
render that invitation — the template's sections and theme, the couple, events, gallery,
gift accounts, quote and display settings — without authenticating, and **nothing else**.
Every invitation that is not currently published answers with an identical 404, whatever
the reason.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/08-PUBLIC-INVITATION-API.md` | whole file | The path, the response shape, the 404 rule, `display.watermark`, the `bank_accounts` gating, the caching requirement |
| `docs/BACKEND/06-PUBLISHING.md` | § Slug Resolution & Routing | Normalize and validate the slug **before** querying; `WHERE slug = :slug AND status = 'published' AND deleted_at IS NULL` |
| `docs/SECURITY/02-TRUST-BOUNDARIES.md` | Public surface | This is the only unauthenticated read of user data in the product |
| `docs/SECURITY/01-THREAT-MODEL.md` | Information disclosure | Leaking an unpublished invitation is the named risk on this surface |
| `docs/PLAN/02-BUSINESS-RULES.md` | BR-4.1, BR-2.8, BR-2.6 | A disabled section's data is not displayed; a trial publish is a real publish; expiry ends service |
| `docs/DATABASE/07-ORDERS.md` | `packages.has_watermark` | The watermark flag's only source |
| `docs/ARCHITECTURE/06-CACHING-ARCHITECTURE.md` | § Cache layers | The response must be deterministic per `invitation_id + template_version_id` |
| `docs/API/00-API-STANDARDS.md` | § Envelope | `{ success, data }` |
| `docs/SECURITY/10-ABUSE-PREVENTION.md` | § Rate Limiting | `general-public`, keyed on the IP |

**One thing `docs/API/08` leaves implicit** and this spec settles: the example shows
`template: { sections, theme }`, but `P1-14` lets an owner override theme values and the
renderer (`P2-02`) validates an override against `customizable_theme_keys`. Serving the
override without the whitelist would make the public page unable to apply the rule the
editor applied. `customizable_theme_keys` is therefore included in `template`. It is
template metadata, already public through `GET /templates/:slug`, so this exposes nothing
new.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-4.1 | A section the owner disabled is not displayed publicly, and its data stays in the database | `PublicInvitationService` omits the data of any disabled section — proven per section, with a dedicated test for `bank_accounts` |
| BR-2.6 | An expired invitation stops being served | The `status = 'published'` predicate in SQL; the expiry sweep is `P3-13`'s |
| BR-2.8 | A free trial publish is an ordinary publish | Nothing special here: a trial-published invitation is `published` and is served, watermarked |
| BR-3.1 | The invitation renders from the version it locked | The join is on `invitations.template_version_id`, never the newest published version |

## 4. API Contract

- **Method and path**: `GET /public/i/:slug` — **not** under `/api/v1`. `docs/API/08` puts
  it on its own prefix so caching and policy differ without a per-route exception.
- **Request**: a slug in the path. No body, no query parameters. `?to=Name` personalization
  is a frontend concern and must never reach this handler, or the response stops being
  cacheable.
- **Success**:

```json
{
  "success": true,
  "data": {
    "status": "published",
    "template": { "sections": [...], "theme": {...}, "customizable_theme_keys": [...] },
    "display": { "watermark": true },
    "invitation": {
      "couple": { "groom": {...}, "bride": {...} },
      "events": [...],
      "gallery": [...],
      "bank_accounts": [...],
      "quote": { "text": null, "source": null },
      "settings": {
        "enabled_sections": [...],
        "theme_override": {},
        "rsvp_enabled": true,
        "guestbook_enabled": true,
        "seo_indexable": false
      }
    }
  }
}
```

`status` is always the literal `"published"` — anything else is a 404, so the field carries
no information and exists because `docs/API/08` shows it.

**Every field is whitelisted by construction.** The public DTO is built field by field from
the rows, **not** by taking `InvitationDetail` and deleting things. Subtraction is how a
field added to the owner's response two months from now silently appears on the public page.

**Never present**, and asserted against an explicit forbidden-key list:
`id`, `owner_id`, `internal_name`, `template_id`, `template_version_id`, `published_at`,
`expiry_date`, `created_at`, `updated_at`, `slug`, `guestbook_moderation`, and anything
order-, payment- or guest-related.

`guestbook_moderation` is the interesting exclusion: it is a *setting*, so it looks like it
belongs beside its two neighbours, but it tells a guest whether their message appears
immediately or waits for approval — which is exactly the knowledge that makes moderation
worth evading. `rsvp_enabled` and `guestbook_enabled` are included because the page cannot
render the right controls without them.

`seo_indexable` is included: `P2-09` needs it to emit `robots`, it is the owner's own
instruction about their own page, and it is inferable from the rendered output anyway.

**Media** is served as URLs, not ids. A guest has no authenticated media endpoint, so a bare
`media_id` is unusable. Gallery entries and couple photos carry `url` and `thumbnail_url`
built from `CDN_BASE_URL` + `mediaKey(...)`, exactly as `P1-19`'s gallery read does — and,
with the same rule, **only** for a `ready` media row when a CDN is configured, because
`docs/ARCHITECTURE/05` § Access Control forbids handing out a bucket URL as a fallback.

- **Errors**: **404 `NOT_FOUND`** — one code, one message, for every one of: no such slug, a
  malformed slug, a draft, a `paid`-but-unpublished invitation, an unpublished one, an
  expired one, a soft-deleted one. `docs/API/08` requires the API not to distinguish these.
  **429** from the `general-public` policy.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `invitations` | Read | `slug`, `status = 'published'`, `deleted_at IS NULL` — all three in SQL |
| `invitation_people`, `invitation_events`, `invitation_gallery`, `invitation_bank_accounts`, `invitation_settings`, `invitation_quote` | Read | The aggregate |
| `template_versions` | Read | The locked version's `sections`, `theme`, `customizable_theme_keys` |
| `media` | Read | Status, dimensions and key material for the URLs |
| `orders`, `packages` | Read | `display.watermark` only |

**Migration required: no.**

## 6. Authorization

There is none, and that is the point — which makes the *query* the entire security control.

- **Who may call this?** Anybody. No token, no session.
- **What replaces the ownership filter?** `status = 'published' AND deleted_at IS NULL`, in
  the SQL `WHERE` clause, in one repository method. Not fetched and then checked: a branch
  after the fetch is a branch somebody can forget, and the row is already in memory when
  they do.
- **Where does the query live?** `shared/tenancy/`. `scripts/check-tenant-scope.mjs` refuses
  a direct import of the invitation tables anywhere else, and that rule is *more* important
  here than for an owner-scoped read, not less: this is the query with no `owner_id`
  predicate at all, and it belongs beside the ones that have it so the difference is
  visible.
- **What does a stranger receive for someone's draft?** 404, identical to a slug that has
  never existed.
- **Admin path?** None.

## 7. Validation and Sanitization

- **The slug is untrusted input** and is validated against the same shape rule `P1-21`
  applies at creation *before* it reaches the database. A slug that cannot be valid is a
  404, not a query.
- **Nothing is written**, so nothing is sanitized here. Every free-text field was sanitized
  on the way in (`P1-10` .. `P1-14`); `docs/SECURITY/08` makes storage the sanitization
  boundary precisely so that a read path cannot be the place it is forgotten.
- **Nothing is accepted from the client** beyond the slug. No query parameters are read.

## 8. State Transitions

None. This endpoint is a pure read.

## 9. Side Effects

None in this task. `POST /public/i/:slug/view` (`P4-*`) counts views; a `GET` must not,
or a cached response would stop counting and an uncached one would count crawlers.

Cache **population** is deliberately out of scope. `docs/ARCHITECTURE/06` wants this
response cached with event-driven invalidation, and the invalidation half needs a publish
event that does not exist until `P3-09`. Caching a page with no way to invalidate it is
worse than not caching it: a couple fixing a typo on their wedding morning would watch the
old page serve for an hour. The response is built to be deterministic so the cache can be
added without changing it; `P2-08`'s ISR is the first consumer.

## 10. Failure Modes

- **Database down** — 500. Fail closed: nothing is served.
- **Template version row missing** — 404 rather than a partial render. An invitation whose
  template cannot be read has nothing to display, and a half-rendered wedding page is worse
  than an honest "not found".
- **`CDN_BASE_URL` unset** — media URLs are omitted and the rest of the payload is served.
  The page renders without photos rather than with links to a private bucket.
- **No paid order** — `watermark: true`. Fail closed in the commercially meaningful
  direction: the failure of "we could not confirm payment" must be the watermarked page,
  never the premium one.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Reading an unpublished invitation by guessing its slug | `SECURITY/01` § Information disclosure | 404, byte-identical to an unknown slug | "answers a draft, an unpublished, an expired and a deleted invitation identically to a slug that never existed" |
| Distinguishing "never existed" from "exists but unpublished" | `API/08` | Same status, same body | same test |
| Harvesting owner or commercial data from the public payload | `SECURITY/05` | Absent | "the payload contains no owner, commercial or internal field" (explicit forbidden-key list) |
| Reading gift account numbers from an invitation with the gift section off | BR-4.1, `API/08` | `bank_accounts` absent | "omits bank_accounts entirely when the gift section is disabled" |
| Reading any other disabled section's data | BR-4.1 | Absent | "omits each disabled section's data", table-driven per section |
| Learning whether a guestbook is moderated, to time a message | `PLAN/12` | `guestbook_moderation` absent | the forbidden-key test |
| Client claiming a premium package to drop the watermark | `API/08`, `SECURITY/07` | Server-derived only; no input is read | "derives the watermark from the paid package and ignores everything else" |
| Flooding the endpoint | `SECURITY/10` | 429 from `general-public` | "is rate limited as a public route" |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit | Slug shape rejection before any query; the public DTO's key set |
| Integration | The full 404 equivalence set; per-section omission with a dedicated `bank_accounts` case; the forbidden-key list; watermark from a paid order, from no order, from an order that is only `pending`; determinism (two identical requests, byte-identical bodies); the envelope; media URLs present for `ready` and absent for `processing` |
| Security | The 404 equivalence set **is** the security test here, since there is no authorization to test |
| E2E | None. `P2-08` renders this payload and is where a browser test belongs. |

## 13. Observability

The standard request log. **No slug-level logging beyond it**, and no guest IP in the clear
(`docs/SECURITY/09`) — the rate limiter already hashes it.

Worth watching in production: a rising 404 rate on this route with distinct slugs is slug
enumeration; the `general-public` limiter is the control, and the 404 rate is how anyone
would notice it working.

## 14. Open Questions

None blocking. One note for a later task: `display.watermark` reads `orders`/`packages`,
which Phase 3 owns. Reading a Phase 3 **table** from a Phase 2 service is not building a
Phase 3 feature — the tables exist from `P0-10` and the field is required by `docs/API/08`
— but `P3-09`'s publish flow should confirm the join still says what this assumes once real
orders exist.
