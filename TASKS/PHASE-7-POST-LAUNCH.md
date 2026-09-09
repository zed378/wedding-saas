# Phase 7 — Post-Launch

**Goal**: the capabilities `docs/PLAN/00-PROJECT-OVERVIEW.md` places in "Phase 2 Scope" and the operational work that only becomes worthwhile once there is real traffic.

**Status of this phase**: everything here is deliberately **not** MVP. `docs/PLAN/18` R11 names editor scope creep delaying the MVP as a high-likelihood project risk, and its mitigation is that Phase 2 features are explicitly rejected for the MVP. This file exists so that rejection is a recorded plan rather than a repeated argument.

**Entry gate**: the MVP has launched, `P6-17` is signed off, and there is real usage data. Several tasks here should be sequenced by what that data says rather than by the order below — `P7-02` (analytics) and `P7-07` (organizer features) in particular are worth doing only if the user base actually asks for them.

**Roadmap reference**: `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` § Phase 7, `docs/PLAN/00` § Phase 2 Scope.

---

## Task Summary

| ID | Task | Surface | Size | Depends on |
|---|---|---|---|---|
| P7-01 | Custom domain support | backend, worker, infra | L | P3-11 |
| P7-02 | Advanced analytics | backend, web-app | L | P4-09 |
| P7-03 | WhatsApp notifications | backend, worker | L | P4-06 |
| P7-04 | In-app notifications for owners | backend, web-app | M | P4-06 |
| P7-05 | Template marketplace | backend, admin | XL | P5-04 |
| P7-06 | Multi-language invitations | backend, public-invite | L | P2-02 |
| P7-07 | Organizer features and Pro plan | backend, web-app | L | P1-21 |
| P7-08 | Presigned upload migration | backend | M | P1-17 |
| P7-09 | Read replica and scaling headroom | infra | L | P6-08 |
| P7-10 | Data export and portability | backend | M | P1-08 |
| P7-11 | Fine-grained admin permissions | backend, admin | M | P5-03 |

---

## P7-01 — Custom Domain Support

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P3-11 |
| **Spec refs** | `docs/PLAN/10-DOMAIN-PUBLISHING.md` § Custom Domain, `docs/DATABASE/04` § Custom Domain, `docs/DEVOPS/03` § Custom Domain |
| **Spec required** | Yes — public surface |
| **Surface** | backend, worker, infra |

**Goal** — A couple can point their own domain at their invitation, with DNS verification and automatic certificate provisioning — and, from the same capability, the platform moves from path-based addresses to per-invitation subdomains.

**Scope note (ADR-024)**: the MVP publishes at `invitation.zedth.my.id/{slug}` because programmatic DNS is not in place. This task is where that changes. Building `{slug}.invitation.zedth.my.id` and customer-owned domains are the same underlying work — a Cloudflare API token creating records against the tunnel, plus a certificate per hostname — so they are done together rather than twice.

**Steps**
1. Use the `invitation_custom_domains` table created in `P0-09` — the schema is already specified in `docs/DATABASE/04`.
1b. Flip the slug resolution strategy from `path` to `subdomain` (`docs/BACKEND/06`) and make every published path URL answer with a **permanent 301** to its subdomain form, indefinitely. Wedding links are forwarded through family WhatsApp groups and never re-sent; a published URL is a promise. Verify with a real link published before the migration.
2. Implement the flow in `docs/PLAN/10`: the user enters a domain, the system shows CNAME or A-record instructions, a periodic job verifies DNS, then status moves `pending_verification → verified → active`.
3. Implement `custom_domain_dns_check` every 10 minutes with a long backoff (`docs/BACKEND/08`), and a give-up threshold so a domain nobody configured stops being polled forever.
4. Provision certificates on demand per domain via ACME, with renewal and failure alerting.
5. Extend host resolution: custom domain lookup first, then subdomain fallback, cached in Redis (`docs/DEVOPS/03`), and warmed so a lookup is not a database hit per request.
6. Verify domain ownership before activation, so one user cannot claim a domain they do not control.
7. Enable the `custom_domain` addon deferred in `P3-01`, and confirm the entitlement gate: the addon must be purchased.
8. Keep the subdomain working alongside the custom domain, with a canonical URL choice for SEO (`docs/PLAN/15`).

**Definition of Done**
- [ ] DNS verification, certificate provisioning and routing work end to end on a real domain.
- [ ] An unverified or unpaid-for domain never becomes active.
- [ ] Resolution adds no per-request database query.
- [ ] Certificate renewal is automated and alerted on.
- [ ] Every pre-migration path URL still resolves, via permanent redirect, to the same invitation.
- [ ] The addon is activated and `P3-01`'s deferral is closed.

---

## P7-02 — Advanced Analytics

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P4-09 |
| **Spec refs** | `docs/PLAN/14-ANALYTICS.md` § Phase 2, `docs/SECURITY/09`, `docs/PLAN/12` § Dashboard |
| **Spec required** | Yes — privacy |
| **Surface** | backend, web-app |

**Goal** — The richer analytics in `docs/PLAN/14` § Phase 2, without turning a privacy-respecting product into a tracking one.

**Steps**
1. Add unique visitor estimation via hashed IP and user agent, never raw values — `docs/PLAN/14` § Phase 2 explicitly frames this as a privacy consideration, not just an implementation detail.
2. Add referrer breakdown, so an owner can see that most traffic came from WhatsApp.
3. Add device breakdown and peak visit times.
4. Add the internal product funnel from `docs/PLAN/14`: draft → paid → published conversion, and drop-off per editor step, which is the data that tells the team where the product loses people.
5. Add template popularity and most-disabled-section tracking as feedback for template design.
6. Evaluate a privacy-friendly third-party tool for the public pages against the cost of self-hosting.
7. Update the privacy policy before shipping any of this — the policy describes what is collected, and changing collection without changing the policy is the wrong order.

**Definition of Done**
- [ ] No raw IP or user agent is stored.
- [ ] The internal funnel is visible in the admin dashboard.
- [ ] Owner-facing analytics remain aggregate.
- [ ] The privacy policy is updated before the feature ships.

---

## P7-03 — WhatsApp Notifications

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P4-06 |
| **Spec refs** | `docs/PLAN/13-NOTIFICATION-SYSTEM.md` § Phase 2, `docs/BACKEND/07` § Provider Abstraction |
| **Spec required** | No |
| **Surface** | backend, worker |

**Goal** — WhatsApp as a second notification channel, added behind the port abstraction rather than beside it.

**Steps**
1. Define a `NotificationChannelPort` generalizing `EmailPort`, so the notification module dispatches by channel rather than branching per provider.
2. Integrate the WhatsApp Business API, including its template message approval process — this is a lead-time dependency, not just an integration.
3. Add channel preferences per notification type to `user_notification_preferences`.
4. Add phone verification; a number that has not been verified must not receive messages.
5. Choose per notification type which channel suits it: an RSVP notification suits WhatsApp, an invoice suits email with its attachment.
6. Respect messaging-window rules and opt-out requirements, which carry real compliance and account-suspension consequences.

**Definition of Done**
- [ ] The email adapter is unchanged by the addition — the abstraction held.
- [ ] Unverified numbers receive nothing.
- [ ] Channel preferences are honoured per notification type.
- [ ] Opt-out works and is respected.

---

## P7-04 — In-App Notifications for Owners

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P4-06 |
| **Spec refs** | `docs/PLAN/13` § MVP Channels (Phase 2 item) |
| **Spec required** | No |
| **Surface** | backend, web-app |

**Goal** — A notification bell in the dashboard for new RSVPs and guestbook entries, reducing dependence on email.

**Steps**
1. Add a notifications table with read state, scoped by user.
2. Emit into it from the same events the email handlers consume.
3. Build the bell with unread count and a list, and mark-as-read behaviour.
4. Consider server-sent events for live updates; polling is acceptable at this scale and cheaper to operate.
5. Set retention so the table does not grow without bound.

**Definition of Done**
- [ ] Notifications are per user and ownership-scoped.
- [ ] Unread counts are accurate across sessions.
- [ ] Retention is bounded.

---

## P7-05 — Template Marketplace

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P5-04 |
| **Spec refs** | `docs/PLAN/00` § Phase 2 Scope, `docs/PLAN/07-TEMPLATE-SYSTEM.md` |
| **Spec required** | Yes — new trust boundary |
| **Surface** | backend, admin |

**Goal** — External contributors can submit templates, which is a new trust boundary rather than merely a new feature.

**Steps**
1. Design the contributor role, submission flow and review queue before writing code — an external party gaining any influence over what renders on thousands of public pages needs its own threat model, added to `docs/SECURITY/01`.
2. Constrain what a contributed template can contain: data only, components only from the registered library, no arbitrary code or external asset URLs. The data-not-code rule from `docs/PLAN/07` is what makes this feasible at all; loosening it here would undo the product's central architectural decision.
3. Build the review and approval workflow with mandatory human review before publication.
4. Design revenue sharing, payouts and contributor agreements — largely a business and legal task with a technical tail.
5. Add contributor attribution and template versioning under contributor ownership.
6. Build the takedown path for a template found to infringe or misbehave, including what happens to invitations already using it — BR-3.3 says a deprecated version keeps rendering, and a takedown may need to override that.

**Definition of Done**
- [ ] A threat model for contributed content exists and `docs/SECURITY/01` is amended.
- [ ] Contributed templates cannot introduce code or external assets.
- [ ] Human review is mandatory before publication.
- [ ] The takedown path handles invitations already using the template.

---

## P7-06 — Multi-Language Invitations

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P2-02 |
| **Spec refs** | `docs/PLAN/00` § Phase 2 Scope, `docs/PLAN/07`, `docs/PLAN/08` |
| **Spec required** | Yes — data model |
| **Surface** | backend, public-invite |

**Goal** — An invitation can be presented in Indonesian and English, for couples with international guests.

**Steps**
1. Decide the model and record it: per-invitation language choice, or per-field translations with a language switcher on the public page. The second is materially more work and changes the data model, so the decision comes first.
2. Extend the schema for translatable content without breaking existing invitations — expand-contract, since this touches the most-populated tables in the system.
3. Externalize the renderer's static strings (section headings, form labels) per language.
4. Add a language switcher to the public page, and make the cache key include language.
5. Handle date and time formatting per locale.
6. Keep the editor manageable: a translation view rather than doubled fields in every form.

**Definition of Done**
- [ ] Existing invitations are unaffected by the schema change.
- [ ] The public page renders both languages with correct date formatting.
- [ ] Cache keys include language.
- [ ] The editor's translation surface does not double the length of every form.

---

## P7-07 — Organizer Features and Pro Plan

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-21 |
| **Spec refs** | `docs/PLAN/00` § Business Model, `docs/UI-UX/03` (Budi), `docs/UI-UX/04` § Budi's journey |
| **Spec required** | No |
| **Surface** | backend, web-app |

**Goal** — Make the wedding organizer persona genuinely well served, and introduce the subscription `docs/PLAN/00` defers to Phase 2.

**Steps**
1. Add invitation duplication — copying an invitation as a starting point for the next client is the single biggest time saver for this persona.
2. Add bulk operations across invitations: status filtering, bulk export, a client-oriented overview.
3. Add client-facing shareable RSVP reports, so the organizer forwards a link instead of a spreadsheet.
4. Design the Pro subscription: recurring billing, quota model, and how it interacts with the existing per-invitation payment. Recurring billing is a substantially different payment flow from the one-time model in `docs/SECURITY/07`, and it needs its own security review.
5. Consider team accounts, which introduces shared ownership — explicitly excluded at MVP by BR-1.1, so it needs a data model change and its own authorization review.
6. Validate demand before building. This is a substantial body of work justified by one persona; usage data should confirm the persona exists in volume first.

**Definition of Done**
- [ ] Duplication copies content without copying status, slug, orders or guest data.
- [ ] Bulk operations respect ownership scoping.
- [ ] Recurring billing has passed its own payment security review.
- [ ] Any shared-ownership model has an authorization review before implementation.

---

## P7-08 — Presigned Upload Migration

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-17 |
| **Spec refs** | `docs/API/05-MEDIA-API.md` § Upload Flow, `docs/SECURITY/06`, `docs/ARCHITECTURE/05` § Access Control |
| **Spec required** | Yes — file upload |
| **Surface** | backend |

**Goal** — Move uploads off the application server, as `docs/API/05` anticipates, without weakening any validation.

**Steps**
1. Issue presigned URLs with strict constraints: content type, size limit, short expiry, and a path the server chooses (`docs/ARCHITECTURE/05` § Access Control).
2. Keep every validation layer. The client now uploads directly, so magic-byte and dimension checks move entirely into the worker — and the worker must treat the object as untrusted until it has checked it, exactly as `docs/SECURITY/02` says of anything crossing into the queue.
3. Never let a directly uploaded object be publicly reachable before validation completes.
4. Handle the abandoned-upload case: a presigned URL used but never registered leaves an orphan; extend the staging cleanup job to cover it.
5. Migrate incrementally with a flag, keeping the server-side path until the new one is proven.

**Definition of Done**
- [ ] Every validation from `docs/SECURITY/06` still runs, now in the worker.
- [ ] A directly uploaded object is never publicly reachable before validation.
- [ ] Orphaned uploads are cleaned up.
- [ ] The migration is reversible by flag.

---

## P7-09 — Read Replica and Scaling Headroom

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P6-08 |
| **Spec refs** | `docs/ARCHITECTURE/04` § Read Replica, `docs/ARCHITECTURE/08` § Scaling Strategy |
| **Spec required** | No |
| **Surface** | infra |

**Goal** — Add read capacity when measurement says it is needed, not before.

**Steps**
1. Establish the trigger from measurement — connection pool saturation, read latency under load — rather than adding a replica speculatively.
2. Add a read replica and route public read queries to it, keeping the editor and all payment writes on the primary (`docs/ARCHITECTURE/04`).
3. Handle replication lag explicitly: a user who just published must not read a stale replica and conclude publishing failed.
4. Monitor replication lag with an alert.
5. Revisit connection pooling as instance count grows.

**Definition of Done**
- [ ] The trigger is documented with the measurement that justified the work.
- [ ] Payment and editor writes stay on the primary.
- [ ] Replication lag is monitored and does not produce read-after-write surprises.

---

## P7-10 — Data Export and Portability

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-08 |
| **Spec refs** | `docs/SECURITY/09` § Data Subject Rights |
| **Spec required** | No |
| **Surface** | backend |

**Goal** — A user can export their own data, the portability right `docs/SECURITY/09` marks as an optional Phase 2 item.

**Steps**
1. Export invitation content, media and guest data in a machine-readable format.
2. Generate asynchronously and deliver by a time-limited authenticated link, never a public URL — the archive contains everything sensitive the user has.
3. Rate limit export requests, which are expensive.
4. Include enough guest data for the user's own purposes while considering that RSVP and guestbook data was submitted by third parties.
5. Audit every export.

**Definition of Done**
- [ ] Export contains the user's own data and no one else's.
- [ ] The delivery link is authenticated and expires.
- [ ] Exports are rate limited and audited.

---

## P7-11 — Fine-Grained Admin Permissions

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P5-03 |
| **Spec refs** | `docs/SECURITY/04` § Fine-Grained Admin, `docs/PLAN/03` § super_admin |
| **Spec required** | Yes — authorization |
| **Surface** | backend, admin |

**Goal** — Split the single `admin` role into module permissions once the team is large enough that "everyone can refund" stops being acceptable.

**Steps**
1. Add the `admin_permissions` table `docs/SECURITY/04` anticipates, keeping the core role structure unchanged.
2. Define permissions per module: `template.manage`, `order.refund`, `moderation.act`, `user.suspend`, `payment.raw_log`.
3. Introduce the `super_admin` capabilities from `docs/PLAN/03`: managing admin roles, payment configuration, feature flags.
4. Keep `admin` from implying `super_admin` (`docs/PLAN/03` § Authorization Principles).
5. Migrate existing admins to an equivalent permission set with no loss of access, and audit every permission change.

**Definition of Done**
- [ ] Permissions are enforced per endpoint, not only in the UI.
- [ ] Existing admins keep working after migration.
- [ ] Permission changes are audited.
- [ ] `admin` still does not imply `super_admin`.
