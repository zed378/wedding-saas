# P3-10 — Feature Spec: Unpublish, Republish, Slug Change After Publish

| | |
|---|---|
| **Task** | `P3-10` |
| **Date** | 2026-09-15 |
| **Author** | Claude (autonomous run) |
| **Status** | Implemented |

---

## 1. Goal

An owner can take a published invitation offline and put it back without paying again and without
gaining validity they did not buy; the slug stays theirs while it is offline; a slug change after publish
is confirmed, rate limited and tells the client that old links broke.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/BACKEND/06` | § Unpublish | guard published; → `paid`; `published_at` kept; cache invalidated immediately; history |
| `docs/PLAN/02` | BR-2.5, BR-6.2 | unpublish keeps `paid`; slug change after publish confirmed and rate limited |
| `docs/PLAN/10` | § Unpublish | slug stays reserved while the invitation exists |
| ADR-052, ADR-080 | — | trial publish; `draft → published` |

**Gaps (ADR-081):**

1. **Unpublishing a trial.** BR-2.5 says unpublish returns to `paid` — correct for a paid invitation, a free
   product for a trial (which was never paid). A trial unpublishes to `draft`.
2. **Republishing a trial.** BR-2.8 is "once, for three days". Unpublishing inside those three days and
   republishing is the same trial resumed, not a second one: allowed while the original `expiry_date` has not
   passed, with that expiry kept. After it, `TRIAL_ALREADY_USED`.
3. **Republish must not extend validity.** `P3-09` set `expiry_date = today + package months` on every paid
   publish, so unpublish-then-republish renewed for free. A paid republish keeps the existing `expiry_date`
   unless a newer paid order exists than the last publish (a fresh purchase — e.g. after a refund).

## 3. Business Rules Implemented

| Rule | Enforced in |
|---|---|
| BR-2.5 | `UnpublishService`: paid → `paid`; trial → `draft` |
| BR-6.2 | `SettingsService` (since `P1-14`) + response names the broken link |
| BR-2.8 | `PublishService` trial resume within the original window |

## 4. API Contract

- `POST /api/v1/invitations/:id/unpublish` — no body. `200 { status: "paid" | "draft", slug }`.
  404 not the caller's; 422 `INVITATION_NOT_PUBLISHED`.
- `POST /publish` on an unpublished invitation — as `P3-09`, with `expiry_date` kept (see § 2).
- `PATCH /settings` with a slug change on a previously published invitation now also returns
  `slug_change: { previous_slug, links_broken: true }`.

## 5. Data Model Impact

None. `invitations.status` via the status service; `published_at` untouched by unpublish and republish.

## 6. Authorization

Owner-scoped lock; 404 for anyone else.

## 7. Validation and Sanitization

No body.

## 8. State Transitions

`published → paid` (USER, existing) when the history ever reached `paid`; `published → draft` (USER, new,
ADR-081) when it did not. Republish: `paid → published` (existing), `draft → published` (existing trial edge,
resume rule).

## 9. Side Effects

`cache.invalidate` job `{ slug, reason: "unpublished" }` queued after commit (consumed by `P3-12`); the public
read is `no-store` today, so the page 404s on the next request.

## 10. Failure Modes

Double unpublish: second sees `paid`/`draft` → 422.

## 11. Abuse Cases

| Abuse case | Expected | Test |
|---|---|---|
| Unpublish a trial to obtain `paid` | `draft` | `unpublish.itest.ts` › "unpublishes a trial to draft, never to paid" |
| Unpublish + republish to extend 12 months | expiry kept | "republishing keeps the expiry date it had" |
| Unpublish + republish a trial to restart 3 days | expiry kept; refused after the window | "resumes a trial inside its window without extending it", "refuses to resume a trial after its window" |
| Claim an unpublished couple's slug | 409 | "keeps the slug reserved while unpublished" |
| Unpublish someone else's | 404 | IDOR test + sweep |

## 12. Test Plan

Integration: all of § 11; public read 404 right after unpublish; republish without a new order; fresh purchase
after refund gets a new expiry; history rows. HTTP: body refused. Settings: `slug_change` in the response.

## 13. Observability

`invitation.unpublished` info.

## 14. Open Questions

None blocking; the trial rules in § 2 extend ADR-052 and are recorded for the project owner in ADR-081.
