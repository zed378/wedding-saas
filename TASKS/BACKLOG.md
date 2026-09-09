# Backlog — Open Questions, Specification Gaps, and Deferrals

Three kinds of entry live here:

- **Open Questions (OQ)** — decisions `docs/` does not contain. `CLAUDE.md` is explicit that inventing a convention which conflicts with the rest of the specification is worse than flagging the gap. These are raised, not resolved unilaterally.
- **Specification Gaps (PG)** — things `docs/` implies but does not specify, or where two documents disagree. Each needs an amendment or a documented decision before the task depending on it can start.
- **Deferred (DF)** — explicitly out of scope, recorded so the decision is not quietly reversed later.

Every entry names the task it blocks or affects, so nothing here is a note without a consequence.

**Status as of 2026-09-09**: **all 17 specification gaps are resolved** and `docs/` has been amended accordingly (ADR-018 through ADR-022). The stack decision answered six open questions (ADR-004 through ADR-017); pricing and the publishing address answered two more (ADR-023, ADR-024); the gift account data question answered another (ADR-025). **Four open questions remain, and none of them blocks a task.**

| | Total | Resolved | Open |
|---|---|---|---|
| Open Questions | 14 | 10 | 4 |
| Specification Gaps | 17 | 17 | 0 |
| Deferred | 9 | — | 9 (by design) |

Nothing on the board is `BLOCKED`. The remaining questions shape work rather than stopping it, and `OQ-12` is worth answering early because it decides whether the roadmap's timeline is achievable at all.

---

## Open Questions — Remaining

### OQ-11 — Account deletion with live invitations

**Affects**: `P1-08` — implementable under the recommendation below, but the recommendation needs confirming before launch, not after.

`docs/API/02` offers account deletion and `docs/SECURITY/09` frames it as a data subject right. `docs/DATABASE/01` sets `invitations.owner_id` to `ON DELETE RESTRICT`. What happens when someone requests deletion while their invitation is published and their wedding is next week is not specified. Immediate takedown may destroy something guests are actively using; refusing outright may not satisfy the right.

**Recommendation**: soft-delete the account, keep published invitations serving until their existing expiry, hard-delete everything at the end of the retention window under BR-9. Needs confirmation — it is a legal question as much as a product one.

### OQ-12 — Team size and expected timeline

**Affects**: sequencing across every phase.

`docs/PLAN/00` § Constraints assumes 1-3 engineers; `docs/PLAN/16` maps the phases onto 15 weeks. Those two are only compatible if the parallel tracks named in each phase file are actually staffed. With one engineer, the frontend and backend tracks serialize and the roadmap's week numbers do not hold. Knowing the real number changes what gets recommended for deferral.

### OQ-13 — Watermark design, and whether a credit link replaces it

**Affects**: `P2-03`, `P2-12`.

Narrowed considerably by ADR-023. With a single package that carries no watermark, a watermark now appears only on **free drafts and share-previews** — never on a published invitation. So this is no longer a question about which customers see one.

What remains: what the preview watermark looks like (`docs/UI-UX/14` asks for "small, non-intrusive"), and whether the platform wants a footer credit link on published invitations as the acquisition channel the watermark used to provide. The second is a deliberate product choice, not a leftover — a paid product that advertises on the customer's wedding page should do so on purpose or not at all.

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

### ~~OQ-05 — Package and addon pricing, and the free draft quota~~ — ANSWERED 2026-09-09

**Answer**: one package, **Rp 139,000 for 12 months**, 200 photos, no watermark. Free tier is **one draft** — at most one invitation per account that has never reached `paid`. Recorded as ADR-023.

The project owner's framing is worth keeping: the effort of producing a wedding invitation belongs to the couple, not to the platform, so the platform is priced not to make a couple hesitate.

Two readings were made explicit in the ADR rather than assumed silently: "subscription 1 tahun" is implemented as a 12-month validity with manual renewal, not recurring billing; and a single price means a single tier, so Basic and Premium disappear rather than one of them being priced.

Follow-on effects: `addons` ships with no active rows, checkout stops being a comparison page, and the watermark narrows to previews only (`OQ-13`).

### ~~OQ-08 — Domain name~~ — ANSWERED 2026-09-09

**Answer**: `invitation.zedth.my.id`, with invitations published **path-based** at `/{slug}` rather than on wildcard subdomains, because programmatic DNS is not yet in place. Per-invitation subdomains arrive later, via a Cloudflare API token creating records against a tunnel. Recorded as ADR-024.

Three fixed hostnames, no wildcards: `invitation.zedth.my.id` for public invitations, `app.zedth.my.id` for the application and API, `admin.zedth.my.id` for the admin panel from Phase 5. The public surface is kept on its own origin deliberately — guest-submitted content renders there, and sharing an origin with the authenticated app would give a stored XSS a path it does not currently have.

This answer creates one new risk, **R15** in `docs/PLAN/18`: with invitations at the root of their host, an unreserved application route could shadow a published invitation. Closed by construction — that host serves nothing but invitations, and CI fails on a route that is not in `slug_blocklist`.

### ~~OQ-10 — Encryption at rest for bank account numbers~~ — ANSWERED 2026-09-09

**Answer**: **no column-level encryption.** Storage-level encryption for the whole database, plus integrity controls on the field. Recorded as ADR-025.

The project owner supplied the fact that reframed the question: the account number is entered by the couple **to be published on their own invitation**, so a guest who cannot attend can send a gift directly to their bank. The platform never transacts with it. `docs/SECURITY/00` had classified it beside password hashes and tokens, which invited the wrong instinct.

Once that is clear, encryption protects only the subset that is not already public — drafts and gift-disabled invitations — inside a database that holds names, addresses, coordinates and full guest lists in plaintext beside it. Encrypting the whole store is the proportionate control.

**The reframing surfaced a risk that was not in the register.** For a number published in order to receive money, tampering beats disclosure: an attacker who swaps it on a live invitation collects every guest's gift, and the couple learns about it after the wedding from relatives asking why the money never arrived. Now **R16**, mitigated by object-level authorization, an audit trail on bank account writes, and a non-optional email to the owner when gift details change on a published invitation.

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
