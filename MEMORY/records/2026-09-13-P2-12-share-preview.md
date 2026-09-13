# P2-12 — Share-Preview Links

| | |
|---|---|
| **Task** | `P2-12` |
| **Date** | 2026-09-13 |
| **Branch** | `feat/P2-12-share-preview` |
| **Status** | DONE |
| **Spec** | [`MEMORY/specs/P2-12-share-preview.md`](../specs/P2-12-share-preview.md) |

---

## What changed

A couple can create a seven-day link that shows their unpublished invitation, watermarked
"PRATINJAU — BELUM DITERBITKAN", never indexed, never cached, and revoke it from the editor.
The link is shown once; only its SHA-256 is stored. Every dead or invented token gets the same
404 as a slug that never existed.

## Why

`docs/DATABASE/04` puts it in one line: the token *"is the only thing between an unpublished
invitation and the public internet"*. Everything here is about treating it as a credential.

## How

**Owner routes** (`PreviewLinkService`, invitation module): create is a single
`INSERT … SELECT … WHERE owner_id` so there is no window to mint a token for someone else's
invitation; list checks ownership first so a stranger gets 404 rather than `[]`; revoke validates
token, invitation and owner in one `UPDATE … WHERE EXISTS`. Revocation is a timestamp, so
`last_accessed_at` still tells the owner whether the link was opened.

**Public route** (`PublicPreviewController`, `GET /public/preview/:token`): shape-check, hash,
then one query whose predicates — hash, not revoked, `expires_at > now()` in the database, invitation
not deleted — are the whole authorization model. The aggregate load was split out of
`findPublishedBySlug` so both routes build the payload with the same code. The response forces
`status: "preview"`, `watermark`, `preview`, `seo_indexable: false` and both submission flags off,
and is sent with `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow`.

**Public page** (`/preview/[token]`): the same renderer, a sticky watermark banner plus a tiled
`aria-hidden` overlay so any screenshot still says PREVIEW, `noindex` metadata, `referrer:
no-referrer` so the token does not leak to a linked site, no share bar (the public address does
not exist yet). The fetcher accepts only `status: "preview"` on this route and only `"published"`
on the slug route.

**Editor** (`SharePreview`): the card's surface is backend and public page, but neither is usable
without a control that creates a link. A minimal dialog beside the publish button creates a link,
shows it once with a warning, lists active links with last-opened time, and revokes.

## Files touched

**New**: `preview-link.service.ts`, `public-preview.controller.ts`,
`test/integration/preview-link.itest.ts`, `public-invite/src/app/preview/[token]/page.tsx`,
`public-invite/src/components/PreviewWatermark.tsx`, `web-app/src/editor/SharePreview.tsx`,
`web-app/test/share-preview.spec.tsx`, `MEMORY/specs/P2-12-share-preview.md`.

**Modified**: `invitation-repository.ts` (three scoped token methods), `public-invitation-repository.ts`
(`findPreviewByTokenHash`, shared `#assemble`), `invitation.controller.ts`/`.module.ts`,
`public-invitation.service.ts`/`.dto.ts`, `publishing.module.ts`, `invitation-http.spec.ts` (stub),
`public-invitation-service.spec.ts`, `idor-sweep.itest.ts` + `phase-one-tenant.ts` (three endpoints),
`public-invite/src/lib/public-invitation.ts`, `initial-html.ssr.ts`, `web-app/src/lib/invitations.ts`,
`EditorShell.tsx`, `docs/API/04`, `docs/API/08`, `TASKS/PHASE-4-ENGAGEMENT.md` (P4-03 DoD line),
`MEMORY/DECISIONS.md` (ADR-066), index, changelog, progress, phase file.

## Decisions made

**ADR-066** — the preview payload is the public payload with four fields forced and
`status: "preview"`; SHA-256 like `P1-02`'s tokens; revocation as a timestamp; database `now()`
for expiry; a minimal editor control ships with the card.

## Deviations from `docs/`

Response shapes added to `docs/API/04` and `docs/API/08` (additive; the documents named the routes
without bodies).

## Tests added

| File | Count | What it proves |
|---|---|---|
| `test/integration/preview-link.itest.ts` | 16 | Hash-only storage; entropy and URL; 7-day expiry; list never carries a token; revoke is immediate and drops from the list; five dead-token kinds identical to an invented one; draft served as `"preview"`; watermark; `noindex` despite an opted-in invitation; submissions off; `no-store`; `last_accessed_at`; no owner fields; non-owner cannot mint or cross-revoke |
| `test/integration/idor-sweep.itest.ts` | +3 endpoints (28) | 404 for strangers on all three; cross-parent and same-owner cases on revoke |
| `test/public-invitation-service.spec.ts` | +7 (17) | Malformed tokens rejected without a query; the same error object as the slug route |
| `test-ssr/initial-html.ssr.ts` | +6 (30) | Watermark and content in HTML; `noindex`; `no-referrer`; token absent from `<head>`; no share bar; friendly 404 |
| `web-app/test/share-preview.spec.tsx` | 4 | Link shown once with a warning, not recoverable after reopening; list shows expiry and last-opened; revoke calls the API |

Totals after: API integration **869**, API unit **561**, web-app **300**, public-invite **107** + **30** SSR. `pnpm verify` green.

## Security verification

Mutation-tested, each reverted:

| Mutation | Test that failed |
|---|---|
| Drop `revoked_at IS NULL` from the resolve | "stops working the moment it is revoked"; the indistinguishability test |
| Drop `expires_at > now()` | the indistinguishability test |
| Drop the invitation `deleted_at IS NULL` | the indistinguishability test |
| Do not force `seo_indexable: false` | "is always noindex, whatever the invitation's own setting says" |
| Do not force `rsvp_enabled: false` | "turns RSVP and the guestbook off in the payload" |

The IDOR sweep's regenerated matrix shows 404 for non-owners on all three owner routes and 404 on
revoke's cross-parent and same-owner cases.

## Definition of Done

- [x] Preview tokens are hashed at rest, expire in 7 days, and are revocable. — three named tests above.
- [x] A preview page is always `noindex` and always watermarked. — payload, header and SSR page, each tested.
- [x] RSVP and guestbook submissions from a preview create no rows. — **structurally**: no submission route exists yet, and the routes `P4` builds address a *published* invitation by slug. The payload also turns both flags off (tested). `P4-01`'s DoD already refuses a draft; `P4-03`'s now does too.
- [x] An expired token and an invented token produce identical responses. — status and body, with revoked, malformed and deleted-invitation cases as well.

Global DoD: item 9 (CI) waived as on every task.

## What did not work

**Two tests passed vacuously and a mutation proved it.** The noindex and submission tests `UPDATE`d
`invitation_settings`, but the tenant fixture never creates that row — the update changed nothing,
and the noindex test passed against a default that was already `false`. Removing the override from
the service survived. Both now upsert and assert the precondition.

**The payload lied about status.** The public DTO's `status` was the literal `"published"`, so the
first preview of a draft reported `"published"`. Now `"preview"`, and each page's fetcher accepts
only its own.

**The IDOR fixture's own token skewed the list tests.** Adding a live token per invitation to the
tenant fixture (for the sweep) made "the list has one link" count two. The tests now filter the
fixture's id and assert it is still present.

**The environment moved twice.** Docker restarted and Postgres's port 55432 fell into a Windows
reserved range; the whole integration suite failed with `role "wedding_app" does not exist` and
`ECONNREFUSED`. Postgres now runs on 54432 locally. A verify run in the middle of that also reported
a unit-test failure that did not reproduce on rerun.

## Follow-ups

- **`P4-01`/`P4-03`** — keep the "unpublished invitation returns 404 and stores nothing" DoD lines.
- **`P2-13`** — the preview page adds a watermark overlay; the SSR budget test still passes.
- **Staging** needs a redeploy to serve `/preview/*` (and the P2-11 env fix).

## What to watch in production

- **A preview URL appearing in logs or analytics** — the token is a credential. Nothing here logs it;
  a reverse proxy access log would, and should strip the path for `/preview/*` and `/public/preview/*`.
- **A spike of 404s on `/public/preview/*`** is token guessing; 256 bits makes it pointless, and the
  `general-public` limiter bounds the load.
