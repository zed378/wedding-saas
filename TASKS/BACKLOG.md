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

### OQ-22 — Is the (email, IP) login key the right one against a distributed attacker?

**Affects**: `P1-07` — **not blocking**; implemented exactly as `docs/SECURITY/10` specifies.

`docs/SECURITY/10` § Rate Limiting keys `POST /auth/login` on **(email, IP)**: 5 failed attempts per 15 minutes. That is implemented.

The weakness is structural rather than a bug. An attacker rotating IPs against one account gets a **fresh budget per IP**, because the IP is part of the key. Against a botnet or a proxy pool, a per-(email, IP) limit is close to no limit on the email at all.

The obvious tightening — a per-email limit regardless of IP — has its own failure mode, and it is nastier than it sounds: **anyone could lock a victim out of their own account** by failing five logins against their address. A login endpoint that a stranger can use to deny you service is a worse product than one that is slow to stop a botnet.

The usual answers are all partial: a much higher per-email ceiling on top of the per-(email, IP) one, so a distributed attack is bounded but a single actor cannot lock anybody out; CAPTCHA after a per-email threshold (`P4-05` brings Turnstile); or device/ASN reputation, which is a different project.

**Why it matters that this gets a real answer**: the limit reads as protection against credential stuffing, and against the form credential stuffing actually takes — distributed, one attempt per address per account — it is weak. Anyone reasoning about the auth posture from the document's table would overestimate it.

**Who decides**: whoever owns the security posture, ideally with `P4-05` (adaptive CAPTCHA) on the table, since that is the mitigation that does not create a lockout vector.

### OQ-21 — Should refresh-token rotation have a grace window?

**Affects**: `P1-03` — **not blocking**; implemented strictly as `docs/SECURITY/03` describes.

`docs/SECURITY/03` § Tokens: "the refresh token **rotates on every use** — the old token is immediately marked `revoked_at`, and reuse is detected (if a revoked token is used again -> indicates theft -> revoke ALL of that user's active sessions)."

Implemented exactly that. The consequence the document does not mention: **two legitimate concurrent refreshes are indistinguishable from theft.** Two browser tabs whose access tokens expire in the same second, or one client retrying a request that timed out after the server had already committed the rotation, both present the same refresh token twice. The second presentation finds it revoked, and the user is logged out of every device.

The integration test `"survives two simultaneous rotations of the same token"` documents this behaviour rather than working around it: one rotation succeeds, and the family is then revoked by the loser.

The usual mitigation is a short grace window — for perhaps 10-30 seconds after a rotation, presenting the spent token returns its already-issued successor again instead of raising the alarm. It costs a `replaced_by` column on `refresh_tokens` and narrows the theft-detection window to that interval.

**Why it matters that this gets a real answer**: the current behaviour is correct and is also a plausible source of "the app keeps logging me out" reports that would be very hard to diagnose from the outside — they would look random, because they depend on tab timing. If those reports appear, this is the cause.

**Who decides**: whoever owns the security posture. A grace window is a deliberate weakening of a control `docs/SECURITY/03` states without qualification, so it should not be added because support tickets are annoying — it should be added, or not, on the evidence.

### OQ-20 — What are the allowed values of `border_radius` and `typography.scale`?

**Affects**: `P0-20` — **not blocking**; decided provisionally in ADR-038 so the phase could continue.

`docs/PLAN/07` § Theme Variables shows a theme by example and gives exactly one value for each of these two keys: `"border_radius": "rounded"` and `"scale": "default"`. For `spacing` the prose names all three (`compact | comfortable | spacious`), so only these two are underspecified.

`P0-20` enumerates them as `none | subtle | rounded | full` and `compact | default | large`. The alternative — accepting any string — was rejected because a theme value becomes a CSS custom property, and an unknown one renders as nothing rather than as an error: `border_radius: "roundeed"` would give square corners on every invitation using the template, with no signal anywhere.

**Why it matters that this gets a real answer**: these are stored values in a `JSONB` column. Widening the enum later is free. Narrowing it is a data fix across every `template_versions` row — cheap today with one template, not cheap once an admin has authored several.

**Who decides**: whoever owns the design system (`docs/UI-UX/06`–`09`). If the answer differs from ADR-038, the change is two `z.enum` calls plus a data fix, and `docs/PLAN/07` should gain the vocabularies so the next reader does not have to find the ADR.

### OQ-19 — Which media variants are actually produced?

**Affects**: `P1-17` — not blocking; the path builder accepts anything either document sanctions.

Two documents disagree, and neither is a superset of the other:

- `docs/ARCHITECTURE/05` § Path Structure: `variant: original | large | thumbnail`
- `docs/BACKEND/04` step 6: "thumbnail (300px), medium (800px), large (1600px)"

`medium` is missing from the first, `original` from the second. Storing the original is useful — variants can be regenerated without asking the user to re-upload — and costly, since it is a full-resolution photo per media row held for the life of the invitation.

`P0-16` accepted all four rather than choosing. The cost of guessing wrong is unusually high here: the filename is the CDN cache key (`docs/ARCHITECTURE/05` § CDN, immutable filenames), so a later rename is a rewrite of every stored object rather than a constant change.

Decide in `P1-17`, when the pipeline is written and the storage cost of keeping originals can be estimated against a real photo count. Whichever set is chosen, amend the document that disagrees.

### OQ-18 — Should "one pending order per invitation" be a database constraint?

**Affects**: `P3-01` — not blocking; the schema ships exactly as documented.

`docs/DATABASE/07` § Notes calls this an **application-level** constraint, checked in the service before insert and reported as `ACTIVE_ORDER_EXISTS` (`docs/API/06`).

A partial unique index would make it structural:

```sql
CREATE UNIQUE INDEX idx_orders_one_pending
  ON orders(invitation_id) WHERE status = 'pending';
```

The argument for adding it: a race between two checkout requests can pass the service check twice and create two pending orders, each with its own payment intent. The argument against: the database would then reject the second insert with an opaque `23505` where the API contract specifies a named error, so the service check is still needed and the constraint only changes what happens when it is bypassed.

`P0-10` left it out rather than deviating from the document. Decide in `P3-01`, when the checkout race is real rather than hypothetical — the answer is probably "both", with the service check for the message and the index for the guarantee.

### OQ-17 — `invitations.template_id` is denormalized alongside `template_version_id`

**Affects**: `P0-11`, `P2-*` — not blocking; the schema ships exactly as documented.

`docs/DATABASE/04` stores both `template_id` and `template_version_id` on `invitations`, each with its own `ON DELETE RESTRICT`. The version row already knows its template, so the parent id is redundant — and nothing stops the two disagreeing: an invitation can point at template A while its version belongs to template B.

That state is unreachable through any sensible service code, and reachable through a hand-written data fix during an incident, which is exactly when nobody checks.

Options: leave it and enforce consistency in the repository layer; add a composite foreign key on `(template_id, template_version_id)` against a matching unique key on `template_versions`; or drop the column and join. The middle one is the only one that makes the invariant structural.

`P0-09` kept it exactly as documented rather than deviating. Decide in `P0-11`, when the repository layer decides how invitations are loaded.

### OQ-16 — Should `media.purpose` have a CHECK constraint?

**Affects**: `P1-17` — not blocking; the column ships exactly as documented.

`docs/DATABASE/06` gives `media.purpose` as `VARCHAR(30) NOT NULL` with the four expected values in a **comment**: `'gallery' | 'profile' | 'cover' | 'template_asset'`. Every comparable column in the schema — `status`, `role`, `type` — carries a real CHECK. This one does not.

`P0-08` left it unconstrained rather than inventing a rule the document does not state. The cost of guessing wrong in either direction is real: a CHECK that omits a value nobody thought of blocks a legitimate write, and no CHECK at all lets a typo create a category of media that no query will ever find.

Decide in `P1-17`, when the upload pipeline actually writes the column and the full set of purposes is known.

### ~~OQ-15 — Should a Google identity be unique across accounts?~~ — ANSWERED 2026-09-12

**Yes.** `P1-04` made `idx_users_oauth` a unique partial index over active rows (ADR-049, migration `0005`).

The entry below deferred this until "the linking behaviour is actually designed". `P1-04`'s step 3 designs it — *"Match on `(oauth_provider, oauth_subject_id)` **first**"* — which makes the subject id a login key, and this entry's own reasoning then settles it: a duplicate makes login ambiguous.

It also deviates from `docs/DATABASE/02`, which writes the index as non-unique; see ADR-049.

Original entry, for the reasoning:

> **Affects**: `P1-05` — not blocking; the schema ships exactly as documented.
>
> `docs/DATABASE/02` indexes `(oauth_provider, oauth_subject_id)` **non-uniquely**, so nothing at the database level stops two accounts carrying the same Google subject id. `docs/API/01` says an OAuth login is matched or registered by the verified Google **email**, so it cannot arise through the documented flow today — the email index already prevents two active accounts on one address.
>
> It becomes a real question the moment account linking is designed: if a user can attach a Google identity to an existing account, subject id becomes a login key and a duplicate makes login ambiguous.
>
> `P0-07` left the index exactly as specified rather than adding a unique constraint the documents do not state — an invented constraint would have been discovered later as an unexplained migration failure. Decide it in `P1-05`, when the linking behaviour is actually designed.

### ~~OQ-11 — Account deletion with live invitations~~ — ANSWERED 2026-09-12

**The recommendation below was adopted** (ADR-051, `P1-08`): soft-delete the account and revoke every session immediately; published invitations keep serving until their own expiry; everything is hard-deleted together under BR-9.

**Still a legal question.** Adopting the recommendation does not confirm it. If counsel disagrees, the change is in `UserService.requestDeletion`, and the test `"published invitations keep serving, and are counted"` is the one to invert.

Original entry:

> **Affects**: `P1-08` — implementable under the recommendation below, but the recommendation needs confirming before launch, not after.
>
> `docs/API/02` offers account deletion and `docs/SECURITY/09` frames it as a data subject right. `docs/DATABASE/01` sets `invitations.owner_id` to `ON DELETE RESTRICT`. What happens when someone requests deletion while their invitation is published and their wedding is next week is not specified. Immediate takedown may destroy something guests are actively using; refusing outright may not satisfy the right.
>
> **Recommendation**: soft-delete the account, keep published invitations serving until their existing expiry, hard-delete everything at the end of the retention window under BR-9. Needs confirmation — it is a legal question as much as a product one.

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

**Answer**: `invitation.vizunicum.my.id`, with invitations published **path-based** at `/{slug}` rather than on wildcard subdomains, because programmatic DNS is not yet in place. Per-invitation subdomains arrive later, via a Cloudflare API token creating records against a tunnel. Recorded as ADR-024.

Three fixed hostnames, no wildcards: `invitation.vizunicum.my.id` for public invitations, `app.vizunicum.my.id` for the application and API, `admin.vizunicum.my.id` for the admin panel from Phase 5. The public surface is kept on its own origin deliberately — guest-submitted content renders there, and sharing an origin with the authenticated app would give a stored XSS a path it does not currently have.

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
| DF-10 | GitHub Actions CI pipeline | `docs/DEVOPS/01-CI-CD.md`, `P0-17` | Deferred at the owner's request (ADR-028). The `:id` gate moved to `.githooks/pre-push`; `scripts/verify.sh` covers the rest. Integration tests, the 80% coverage floor, SAST and CVE scanning run **nowhere** until it is picked up — **revisit before Phase 3** |
