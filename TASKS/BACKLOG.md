# Backlog — Open Questions, Specification Gaps, and Deferrals

Three kinds of entry live here:

- **Open Questions (OQ)** — decisions `docs/` does not contain. `CLAUDE.md` is explicit that inventing a convention which conflicts with the rest of the specification is worse than flagging the gap. These are raised, not resolved unilaterally.
- **Specification Gaps (PG)** — things `docs/` implies but does not specify, or where two documents disagree. Each needs an amendment or a documented decision before the task depending on it can start.
- **Deferred (DF)** — explicitly out of scope, recorded so the decision is not quietly reversed later.

Every entry names the task it blocks or affects, so nothing here is a note without a consequence.

**Status as of 2026-09-09**: **all 17 specification gaps are resolved** and `docs/` has been amended accordingly (ADR-018 through ADR-022). Six of the thirteen open questions are answered by the stack decision (ADR-004 through ADR-017). **Seven open questions remain**, of which three block a task.

| | Total | Resolved | Open |
|---|---|---|---|
| Open Questions | 13 | 6 | 7 |
| Specification Gaps | 17 | 17 | 0 |
| Deferred | 9 | — | 9 (by design) |

---

## Open Questions — Remaining

### OQ-05 — Package and addon pricing, and the free draft quota

**Blocks**: `P3-01`, and therefore the real behaviour of all of Phase 3.

`docs/PLAN/09` § Packages gives the shape — Basic and Premium, photo caps, watermark, validity — and explicitly puts final pricing out of scope. `docs/DATABASE/07` makes `packages.price` the source of truth for every calculation. Phase 3 can be built against placeholder values, but nothing can launch without real ones, and the conversion target in `docs/PLAN/00` (15% draft to paid) is unmeasurable until they exist.

Also needed: the free tier's exact boundaries. `docs/PLAN/00` says a user creates one free invitation as a watermarked draft that cannot be published; `docs/PLAN/01` FR-1.4 wants multi-invitation support; `docs/SECURITY/10` rate limits invitation creation at 10 per day. How many unpaid drafts one account may hold is not stated anywhere.

### OQ-08 — Domain name

**Blocks**: `P0-23`, `P3-11`.

Every document uses `maindomain.com` as a placeholder. The real domain is needed for wildcard DNS, the wildcard certificate, the admin subdomain, cookie scoping, and email sender configuration. The subdomain slug is also the product's public identity, so it is worth deciding deliberately rather than at deployment time.

### OQ-10 — Encryption at rest for bank account numbers

**Affects**: `P1-13` — and it should be answered before any production data exists.

`docs/SECURITY/09` § Encryption says application-level column encryption for `invitation_bank_accounts.account_number` and `payments.raw_callback_payload` is "considered". Deciding after launch means migrating live sensitive data.

Encryption costs the ability to query or index those columns and adds key management. Against that: these are the most sensitive fields the product stores, and they are the fields a database dump would be stolen for.

**Note**: ADR-020 already commits to application-layer encryption for `user_mfa_factors.secret_encrypted`, so the key management mechanism will exist regardless. That removes most of the cost from answering "yes" here.

### OQ-11 — Account deletion with live invitations

**Blocks**: `P1-08`.

`docs/API/02` offers account deletion and `docs/SECURITY/09` frames it as a data subject right. `docs/DATABASE/01` sets `invitations.owner_id` to `ON DELETE RESTRICT`. What happens when someone requests deletion while their invitation is published and their wedding is next week is not specified. Immediate takedown may destroy something guests are actively using; refusing outright may not satisfy the right.

**Recommendation**: soft-delete the account, keep published invitations serving until their existing expiry, hard-delete everything at the end of the retention window under BR-9. Needs confirmation — it is a legal question as much as a product one.

### OQ-12 — Team size and expected timeline

**Affects**: sequencing across every phase.

`docs/PLAN/00` § Constraints assumes 1-3 engineers; `docs/PLAN/16` maps the phases onto 15 weeks. Those two are only compatible if the parallel tracks named in each phase file are actually staffed. With one engineer, the frontend and backend tracks serialize and the roadmap's week numbers do not hold. Knowing the real number changes what gets recommended for deferral.

### OQ-13 — Watermark design and placement

**Affects**: `P3-09`, `P2-03`.

`docs/PLAN/09` makes watermarking the visible difference between Basic and Premium, and `docs/UI-UX/14` says it should be "small, non-intrusive, usually in the footer/corner, with a link to the product". Nothing specifies what it looks like. It is simultaneously an acquisition channel and something a paying customer is buying their way out of, so its design is a product decision rather than an implementation detail.

The API side is now settled: `display.watermark` is returned by `GET /public/i/:slug`, derived server-side from the paid package (ADR-021). What remains is what the renderer draws.

### OQ-14 — CAPTCHA activation threshold

**Affects**: `P4-05`.

The vendor is decided (ADR-011: Cloudflare Turnstile). What is not decided is the traffic threshold at which it switches on for a given invitation. `docs/SECURITY/10` requires it to be adaptive rather than always-on, because `docs/UI-UX/03`'s elderly-guest persona is exactly who an unnecessary challenge costs. A number that is too low annoys real guests; too high and the spam lands first. Best set from observed traffic shortly after launch rather than guessed now — but it needs an initial value.

---

## Open Questions — Answered

### ~~OQ-01 — Tech stack~~ — ANSWERED 2026-09-09

**Answer**: a TypeScript monorepo — NestJS on the backend, Next.js for the app and public invitation, Vite for admin, Drizzle ORM, BullMQ, Zod as the shared validation vocabulary.

Recorded as ADR-004 through ADR-010 and ADR-016, ADR-017. The deciding argument was specific to this product rather than general preference: the canonical field-path registry and dot-notation resolver must behave identically in the backend's publish validation and the frontend's editor checklist and renderer, and one language makes that a shared package rather than a discipline.

`CLAUDE.md` and `AGENTS.md` § Dev environment now carry the full table.

### ~~OQ-02 — Payment provider~~ — ANSWERED 2026-09-09

**Answer**: **Midtrans** (Snap), behind `PaymentGatewayPort`. Recorded as ADR-012.

Flagged honestly in the ADR: Midtrans and Xendit are close enough technically that the decision is commercial — settlement period, MDR per method, onboarding for the business entity — and those numbers belong to the project owner. Midtrans is the default because `docs/SECURITY/07` already documents its signature algorithm, and because the port makes switching an adapter rather than a redesign.

### ~~OQ-03 — Hosting target and object storage~~ — ANSWERED 2026-09-09

**Answer**: a **single VPS** (Singapore or Jakarta) running Docker Compose behind Caddy, with **Cloudflare R2** for object storage and Cloudflare for CDN, DNS, WAF and CAPTCHA. Recorded as ADR-011 and ADR-015.

This answer creates two accepted risks, both now in `docs/PLAN/18-RISK-REGISTER.md`: **R13** (one vendor carries storage, CDN, DNS and CAPTCHA) and **R14** (single host, no redundancy at MVP). R14 in particular must be re-evaluated before the platform carries weddings it cannot afford to disappoint.

### ~~OQ-04 — Email delivery provider~~ — ANSWERED 2026-09-09

**Answer**: **Resend** with React Email templates, behind `EmailPort`. Recorded as ADR-013.

Amazon SES is cheaper at volume and is the expected migration once volume justifies it; at MVP volumes the difference is a few dollars a month against a day of setup and a sandbox approval.

### ~~OQ-06 — Maps provider~~ — ANSWERED 2026-09-09

**Answer**: two treatments for two surfaces. **MapLibre GL** with OSM tiles for the editor's pin picker; **no map SDK at all** on the public page — a lazy static image plus a Google Maps deep link. Recorded as ADR-014.

The public page is the surface with unbounded traffic and a 150KB JavaScript budget, and an embedded map SDK fails both tests at once.

### ~~OQ-09 — CAPTCHA vendor~~ — ANSWERED 2026-09-09

**Answer**: **Cloudflare Turnstile**, already part of the edge stack (ADR-011), invisible by default and activated adaptively.

The activation threshold remains open as `OQ-14`.

### ~~OQ-07 — Language of `TASKS/` and `MEMORY/`~~ — ANSWERED by default

Written in English to match `docs/` and ADR-001. If Indonesian is preferred for these two folders, say so and they can be translated; the structure is unaffected.

---

## Specification Gaps — All Resolved

All 17 gaps found while writing the plan were resolved on 2026-09-09, and `docs/` was amended in each case per the deviation protocol. The table is kept as the record of what changed and why.

| ID | Gap | Resolution | ADR | Documents amended |
|---|---|---|---|---|
| PG-01 | `docs/API/00` documented **both** 403 and 404 for "exists but is not yours", contradicting `SECURITY/04`, `05`, `TESTING/04` and `CLAUDE.md` | **404 always.** 403 is reserved for wrong role or unverified email, where no resource identity is revealed | ADR-018 | `API/00`, `API/05`, `SECURITY/01`, `SECURITY/11` |
| PG-02 | `PLAN/08` models `slug`/`expiry_date` in Settings; `DATABASE/04` stores them on `invitations` | Physical schema unchanged — they are lifecycle fields on the hottest query. `PLAN/08` gains an explicit domain-to-table mapping | ADR-022 | `PLAN/08` |
| PG-03 | `FRONTEND/05` polls `GET /media/:id`, which the contract never defined | Endpoint added, ownership-scoped | ADR-021 | `API/05` |
| PG-04 | Share-preview tokens had no table and no consuming endpoint | `invitation_preview_tokens` added (hashed, expiring, revocable) plus `GET /public/preview/:token` | ADR-020, ADR-021 | `DATABASE/04`, `API/04`, `API/08` |
| PG-05 | `custom_domain` addon purchasable for a Phase 7 capability | Seeded `is_active = false` until `P7-01` ships | ADR-022 | `PLAN/09`, `DATABASE/07` |
| PG-06 | No table for email verification and password reset tokens | `user_tokens` added, hashed and single-use | ADR-020 | `DATABASE/02` |
| PG-07 | Nothing said who transitions the invitation to `pending_payment` | The order service, inside the order-creation transaction. Renewal orders perform no transition | ADR-022 | `API/06` |
| PG-08 | Demo data for template preview had no home | A seeded invitation owned by a system account, rendered through the production renderer | ADR-022 | `PLAN/07` |
| PG-09 | The public renderer could not know whether to draw a watermark | `display.watermark` added to the public response, derived server-side from the paid package | ADR-021 | `API/08` |
| PG-10 | No owner-side RSVP endpoints, despite `PLAN/04` § F10 and `UI-UX/10` specifying the screen | List, summary, CSV export and delete added, with formula-injection escaping on the export | ADR-021 | `API/04` |
| PG-11 | No owner-side guestbook moderation endpoints | List, approve/reject and delete added, distinct from the admin queue | ADR-021 | `API/04`, `API/09` |
| PG-12 | Page views had nowhere to be stored | `invitation_view_counts` at daily grain, written only by the flush job | ADR-020 | `DATABASE/11` (new), `PLAN/14` |
| PG-13 | No tables for the mandatory admin 2FA | `user_mfa_factors` and `user_recovery_codes` added; TOTP secret encrypted at the application layer | ADR-020 | `DATABASE/02` |
| PG-14 | Refund sent the invitation to `draft` per `PLAN/02` and to `paid` per `BACKEND/05` — the difference being whether a refunded customer keeps the product | **`draft`.** A refund reverses the entitlement, not only the payment | ADR-019 | `BACKEND/05`, `BACKEND/09`, `PLAN/02`, `PLAN/06` |
| PG-15 | The slug blocklist had no storage despite needing to be admin-editable without a deploy | `slug_blocklist` added, with `exact` versus `substring` match types | ADR-020 | `DATABASE/12` (new), `SECURITY/10` |
| PG-16 | BR-3.2 promises an explicit template version upgrade with no endpoint to perform it | `POST /invitations/:id/upgrade-template-version`, separate from `change-template` because the two carry different warnings | ADR-021 | `API/04` |
| PG-17 | `ARCHITECTURE/04` listed `invitation_locations`, `invitation_sections` and `template_sections`, none of which exist | Summary corrected to match `DATABASE/00`, with a note on where those concepts actually live | ADR-022 | `ARCHITECTURE/04` |

Two of these were genuine contradictions rather than omissions — `PG-01` and `PG-14` — and both would have become bugs decided endpoint-by-endpoint by whoever wrote each one first.

Resolving them also added two entries to `docs/PLAN/18-RISK-REGISTER.md` (R13, R14) arising from the hosting decision, and grew `docs/DATABASE/` from 11 files to 13.

---

## Deferred

Each of these is deliberately out of scope. They are recorded so the decision is visible rather than repeatedly re-argued — `docs/PLAN/18` R11 names editor scope creep as a high-likelihood project risk.

| ID | Item | Source | Where it goes |
|---|---|---|---|
| DF-01 | Dark mode for the application | `docs/UI-UX/08` § Dark Mode | Tokens are structured so it can be added later without refactoring |
| DF-02 | Multi-level undo/redo in the editor | `docs/PLAN/04` § F3 (optional for MVP) | Post-launch, if usability testing asks for it |
| DF-03 | In-editor crop and image adjustment | `docs/PLAN/04` § F4 (optional) | MVP ships an aspect-ratio guide only |
| DF-04 | Voucher codes at checkout | `docs/PLAN/04` § F7 (optional) | Needs a pricing decision first (`OQ-05`) |
| DF-05 | Installment payments, multi-currency | `docs/PLAN/00` § Out of Scope | Not planned |
| DF-06 | Native mobile app | `docs/PLAN/00` § Out of Scope | Not planned |
| DF-07 | AI-generated content or photos | `docs/PLAN/00` § Out of Scope | Not planned |
| DF-08 | White-label for organizers, integrated live streaming, gift tracking through the gateway | `docs/PLAN/00` § Future Scope | Revisit after the organizer persona is validated (`P7-07`) |
| DF-09 | Background music and video uploads | `docs/PLAN/11` § Media Types (Phase 2) | The music **section** may ship with an externally hosted track; user audio upload does not |
