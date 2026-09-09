# Pricing and publishing address decided — the last two blockers cleared

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Task** | `P3-01` (`OQ-05`), `P0-23` (`OQ-08`) |
| **Phase** | Phase 0 / Phase 3 preparation |
| **Surface** | docs |
| **Author** | Claude Code session |
| **Commits / PR** | (repository not yet under version control — `P0-03`) |
| **Status** | Completed |

---

## What Changed

Two product decisions from the project owner, recorded as ADR-023 and ADR-024, and propagated through 20 documents.

**Pricing**: one package at **Rp 139,000 for 12 months**, 200 photos, no watermark; free tier is **one draft**. The two-tier Basic/Premium model is gone.

**Publishing address**: invitations are published at **`invitation.zedth.my.id/{slug}`** — path-based on a fixed hostname, no wildcard DNS and no wildcard certificate. Per-invitation subdomains move to `P7-01`, alongside custom domains, since both need the same programmatic-DNS capability.

With these answered, **no task on the board is blocked**.

## Why

The project owner answered the two remaining open questions directly, with reasoning worth preserving on the pricing side: the effort of producing a wedding invitation belongs to the couple, not to the platform, so the platform should be cheap. On the addressing side the constraint was practical — the infrastructure cannot yet manage DNS records programmatically, and a wildcard is exactly the thing that needs it.

## How

Both answers needed interpretation before they could be written into the specification, and both interpretations are stated in the ADRs rather than assumed silently.

**"Subscription 1 tahun" was read as a 12-month validity with manual renewal**, not recurring billing. `docs/PLAN/00` already says the MVP is not subscription-based, the renewal order flow already exists in `docs/PLAN/10`, and recurring billing is a materially different payment flow that would need its own security review. If the intent was auto-renewing billing, ADR-023 is the entry to revise and `P7-07` is where that work lives.

**A single price was read as a single tier.** Basic and Premium disappear rather than one of them being priced, which is what a second tier at Rp 89,000 would have amounted to — a difference the customer would struggle to care about. That decision then propagates further than the price table: `docs/UI-UX/13`'s comparison cards become a single informational card, the media limits table collapses to one row, and the watermark narrows to previews only, because no paid package carries one any more.

**The addressing change was where most of the care went**, because a naive reading — put everything on one host, invitations at `/{slug}` — would have quietly removed a security property. Guest-submitted content (RSVP names, guestbook messages) renders on the public invitation page. Under the original wildcard design, every invitation had its own origin, so a stored XSS surviving sanitization was contained by the same-origin policy. Collapsing the public surface onto the same origin as the dashboard and the authenticated API would have given that failure a path to act as a logged-in user. Splitting into three fixed hostnames — public invitations, application, admin — costs one extra DNS record each and keeps `docs/SECURITY/02`'s boundaries intact, without a wildcard anywhere.

The second hazard is the collision one: with invitations at the root of a host, an application route could shadow a published invitation and take a live wedding page offline. Closed by construction rather than by care — that host serves only `/{slug}`, `/preview/{token}` and the proxied `/public/*`, and CI fails on a route whose segment is not reserved in `slug_blocklist`. Recorded as R15.

Slug resolution was made strategy-driven in `docs/BACKEND/06` — path today, subdomain later, one implementation — so the eventual migration is configuration plus DNS rather than a rewrite. The one hard requirement written into both `docs/PLAN/10` and `P7-01`: published path URLs must redirect permanently to the subdomain form, indefinitely. A wedding link is forwarded through family WhatsApp groups and never re-sent.

## Files and Components Touched

| Path | Change |
|---|---|
| `MEMORY/DECISIONS.md` | ADR-023 (pricing), ADR-024 (publishing address) |
| `docs/PLAN/09` | Single package table, unit economics, renewal price, free-tier rule |
| `docs/PLAN/11` | Media limits collapsed to one row |
| `docs/PLAN/00` | Business model, MVP scope address |
| `docs/PLAN/02` | New BR-1.4 free-draft quota; BR-8.1 rewritten |
| `docs/PLAN/10` | Publishing address, hostnames, collision safety, migration path |
| `docs/PLAN/12`, `15`, `18` | Admin hostname; canonical URL; R15 added |
| `docs/BACKEND/06` | Slug resolution by configured strategy |
| `docs/DEVOPS/03` | Routing rewritten for three hosts, no wildcard |
| `docs/ARCHITECTURE/08` | TLS per hostname instead of a wildcard certificate |
| `docs/API/00`, `05`, `08` | Real hostnames; address resolution; same-origin public API |
| `docs/FRONTEND/01`, `07` | Public app routes and host; canonical address |
| `docs/SECURITY/02`, `10` | Origin separation as a boundary; reserved path segments |
| `docs/UI-UX/02`, `13`, `14` | Sitemap; checkout without comparison; watermark scope |
| `docs/DATABASE/07` | Seed note for the single package and inactive addons |
| `TASKS/PHASE-0,1,2,3,5,7` | Cards updated for hosts, quota, seeding, checkout, migration |
| `TASKS/BACKLOG.md`, `TASKS/PROGRESS.md` | `OQ-05` and `OQ-08` answered; blocked list now empty |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| One package, Rp 139,000, 12 months, 200 photos, no watermark | Priced not to make a couple hesitate; the photo cap is nearly free | ADR-023 |
| Free tier = one never-paid invitation | Limits unpaid inventory without breaking the organizer persona | ADR-023 |
| Path-based publishing on fixed hostnames | Programmatic DNS not yet available; a wildcard is what needs it | ADR-024 |
| Public invitations on their own origin | Guest content must not share an origin with the authenticated app | ADR-024 |
| Strategy-driven slug resolution | Makes the later migration a configuration change | ADR-024 |

## Deviations from `docs/`

Two, both deliberate, both amended in the same change:

1. `docs/PLAN/09`'s two-tier package model is replaced by one package. Amended.
2. `docs/PLAN/10`'s wildcard subdomain publishing is replaced by path-based addressing for the MVP, with the subdomain form retained as the documented target. Amended, along with the eight other documents that built on it.

## Tests Added

Not applicable — documentation only. Three test obligations were created and written into the task cards: the free-draft quota test where a user with a paid invitation can still create a draft (`P1-09`), the reserved-route CI check (`P5-13`), and the pre-migration URL redirect verification (`P7-01`).

## Security Verification

| Control | Change | Where it will be tested |
|---|---|---|
| Origin separation of untrusted content | Public invitations on their own hostname, kept out of the app origin | `P0-23` DoD; `P6-04` XSS sweep |
| Route shadowing (availability) | Public host serves only invitations; reserved segments enforced by CI | `P5-13`, `P3-11` DoD |
| Slug input trust | Path segment and proxy header both treated as untrusted input | `P2-08` |

## Definition of Done Verification

Global DoD items 1-9 do not apply to a documentation change. Items 10 and 11 are met: this record exists, the index and changelog are updated, two ADRs are written, and `TASKS/PROGRESS.md` plus six phase files are updated in the same change.

## What Did Not Work

The first sketch of the addressing change put everything on the single hostname the project owner already has — application, admin and invitations, separated by path prefix. It was the most literal reading of "use an endpoint strategy" and it was abandoned once the consequence was traced: guest-submitted content would share an origin with the dashboard and the authenticated API, so a stored XSS surviving sanitization could act as the logged-in couple viewing their own invitation. The wildcard design had prevented that for free, and nothing in the request required giving it up — two more static DNS records keep it, with no wildcard involved.

## Follow-Ups and Open Questions

- **Confirm the two interpretations.** "Subscription 1 tahun" is implemented as a 12-month validity with manual renewal, and a single price as a single tier. Both are cheap to revise now and expensive after launch.
- **Renewal price** is set to the same Rp 139,000. Not explicitly stated by the owner; flagged in ADR-023.
- **`OQ-13` narrowed but not closed** — with no paid package carrying a watermark, what remains is the preview watermark's design and whether published invitations should carry a credit link at all. That is now a deliberate marketing decision rather than a package side effect.
- **The admin hostname is not needed until `P5-01`**, so the third DNS record can wait. The application hostname is needed at `P0-23`.

## What to Watch

Two things, both about the address.

**R15, route shadowing.** The CI check that reserves every routed path segment is what stands between a marketing page deploy and a live wedding invitation going dark. If that check is ever weakened or skipped, the failure is silent and lands on a customer on their wedding day.

**The migration promise.** Every invitation published before the move to subdomains has a URL sitting in family WhatsApp groups. Those redirects are permanent obligations, not a transition step, and the count of affected invitations only grows. The longer the migration waits, the more URLs there are to keep alive — which is an argument for doing it while the number is small.
