# P2-08 — Feature Spec: Public Invitation SSR App and Host Routing

| | |
|---|---|
| **Task** | `P2-08` |
| **Date** | 2026-09-13 |
| **Author** | Claude Opus 5 |
| **Status** | Implemented |

---

## 1. Goal

A guest opening `invitation.vizunicum.my.id/andi-sarah` gets the whole invitation in the
HTML the server sends — content, theme and sharing meta tags — before any JavaScript runs.
An address with no published invitation gets a friendly page instead of a framework error,
and nothing else on the host can take an address away from an invitation.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/FRONTEND/07-PUBLIC-INVITATION.md` | whole file | SSR is mandatory because sharing bots do not run JS; a server-side fetch during render; the 404 page; `og:image` from the cover photo |
| `docs/BACKEND/06-PUBLISHING.md` | § Slug Resolution & Routing | One resolution implementation behind a configured strategy; validate the shape before querying; only three paths routed to this app |
| `docs/UI-UX/15-RESPONSIVE-DESIGN.md` | § Responsive Strategy | The public invitation is letterboxed on desktop |
| `docs/UI-UX/14-PUBLIC-INVITATION-UX.md` | § Special States | A friendly fallback page, not a technical error |
| `docs/FRONTEND/09-PERFORMANCE.md` | § Budget | Under 150KB gzip initial JS; section components loaded only for the active template |
| `docs/API/08` | whole file | The payload, and the rule that 404 reasons are indistinguishable |
| `docs/PLAN/18-RISK-REGISTER.md` | R15 | An unreserved route would silently shadow a published invitation |

## 3. Business Rules Implemented

No new rules. The page renders what `P2-07` decided a guest may see; BR-4.1's section
gating already happened server-side, and re-applying it here would be a second
authorization layer that the first would eventually be trusted to have done.

## 4. API Contract

This task consumes rather than defines. `GET /public/i/:slug`, `anonymous`, per `docs/API/08`.

**What the page sends**: nothing. No query parameters are forwarded — `?to=Nama`
personalization is read client-side (`P2-10`) precisely so the server response stays
identical for every guest and remains cacheable.

## 5. Data Model Impact

None. This application has no database access at all, by design: the trust boundary in
`docs/SECURITY/02` puts guest-facing rendering on its own host with no credentials.

## 6. Authorization

There is none here either, and that is the correct answer rather than an omission: the
`status = 'published'` predicate lives in `P2-07`'s query. What this application must not
do is *undo* it — which is why it renders whatever the API returned and never asks for
anything by id.

The one security-relevant decision in this task is that **the internal API address never
reaches the browser**. `lib/config.ts` and `lib/public-invitation.ts` both import
`server-only`, making a client-side import a build error rather than a code review note.

## 7. Validation and Sanitization

- **The slug is untrusted**, whether it arrives as a path segment or as a `Host` label.
  `resolveSlug` normalizes and validates before anything is fetched, and a malformed
  percent sequence produces "not a slug" rather than a 500 — a 500 is a different response
  from a 404, and a different response is an oracle.
- **The API response is not trusted either.** `fetchPublicInvitation` checks the envelope
  and the shape rather than casting; a page that trusted `body.data` would render
  `undefined` into an invitation on any shape it did not expect, including an error
  envelope arriving with a 200 from a misconfigured proxy.
- **No sanitization here.** `P1-16` sanitizes on the way in and React escapes on the way
  out. Sanitizing again would suggest the server's sanitizer is optional.

## 8. State Transitions

None.

## 9. Side Effects

None. No view counting on `GET` — a cached response would stop counting and an uncached
one would count crawlers; `POST /public/i/:slug/view` is `P4`'s.

**No caching**, deliberately, and the same reasoning as `P2-07`: `docs/ARCHITECTURE/06`
wants event-driven invalidation and the event lands with `P3-09`. The fetch is
`cache: "no-store"` with a test asserting it, so switching it on is a deliberate change
with a failing test attached rather than a default nobody chose.

## 10. Failure Modes

The distinction this task exists to get right:

| Failure | Response | Why |
|---|---|---|
| Slug cannot be valid | 404, friendly page, no request made | A rejected request never reaches the database |
| API answers 404 | 404, friendly page | Not published, for any of the five reasons, indistinguishably |
| API answers 5xx, times out, or is unreachable | 500, error document | An outage must not tell a couple's guests their invitation does not exist |
| API answers a shape the page does not understand | 404 | Nothing useful can be rendered; half an invitation is worse than none |
| A section component throws | That section is blank, the rest renders | `P2-04`'s boundary, with no fallback text — a guest cannot act on it |

## 11. Abuse Cases

| Abuse case | Source | Expected | Test |
|---|---|---|---|
| Walking the slug space for unpublished invitations | `SECURITY/01` | Identical 404 page, and malformed slugs answered without a request | slug suite; "answers a malformed slug identically" |
| A `Host` header forged to address another invitation | `BACKEND/06` | Same validation as a path segment | "applies the same shape rule as the path strategy" |
| Path traversal in the slug | `SECURITY/08` | Rejected by shape | "refuses a traversal attempt" |
| A new app route silently taking an invitation's address | `PLAN/18` R15 | Build-time failure | "has no top-level route that could shadow a slug" |
| Learning the internal API address from the page | `SECURITY/02` | Impossible — `server-only` | build-enforced |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit | `slug.spec.ts` — both strategies, every malformed shape, normalization order. `public-invitation.spec.ts` — 404 vs error vs malformed envelope. `lazy-registry.spec.ts` — parity with the renderer's registry, and the route allowlist |
| SSR (its own suite, after the build) | The invitation's content and `og:*` in the raw HTML; only enabled sections; the theme; the letterbox; the not-found page and its `noindex`; an outage is not a not-found; the 150KB budget; the section library's size |
| E2E | None added. `P2-10` adds the interactions a browser test would drive; a Playwright test here would assert what the SSR suite already reads from the bytes |

## 13. Observability

Nothing is logged by this application yet. `onSectionIssue` and `onSectionError` are
available on the renderer and are **not** wired — `P2-04` recorded that seam, and nothing
forwards to Sentry until `P6`. Worth stating rather than implying: a section silently
failing to render on a live invitation is currently invisible.

## 14. Open Questions

None blocking. One finding recorded rather than resolved: `next/dynamic` does not produce
per-template chunks under Turbopack, so the whole section library ships as one 7.5KB chunk.
Measured, pinned by a test, and left to `P2-13`.
