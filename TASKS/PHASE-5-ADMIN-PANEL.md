# Phase 5 — Admin Panel

**Goal**: the internal surface that lets the team add templates without a deploy, support users, process refunds, moderate reported content, and answer "who did that and why" from an audit trail.

**What makes this phase different**: the admin panel is the one place where cross-tenant access is legitimate. `docs/SECURITY/01-THREAT-MODEL.md` rates a compromised admin account as very high impact, and `docs/SECURITY/05` § Special Case requires every ownership bypass to be a separately named code path with an audit row. So this phase is as much about constraining admins as enabling them: mandatory 2FA, a separate subdomain and session, no ability to edit user content, and a complete audit trail.

**Exit criteria**: an admin can create and publish a template version through the panel and a user can build an invitation on it with no deploy in between; every admin write action appears in the audit log with a reason; admins cannot log in without 2FA; an admin cannot edit a couple's names or photos.

**Roadmap reference**: `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` § Phase 5 (Week 12-13).

---

## Task Summary

| ID | Task | Surface | Size | Depends on |
|---|---|---|---|---|
| P5-01 | Admin application shell and session isolation | admin, infra | M | P0-22, P0-23 |
| P5-02 | Admin 2FA (TOTP) and step-up re-authentication | backend, admin | L | P1-03, P5-01 |
| P5-03 | Admin authorization path and audit middleware | backend | M | P0-14, P1-06 |
| P5-04 | Template and version management API | backend | L | P0-20, P5-03 |
| P5-05 | Template editor UI, assets, dummy preview | admin | L | P5-04, P2-03 |
| P5-06 | User management | backend, admin | M | P5-03 |
| P5-07 | Order and payment management | backend, admin | M | P5-03, P3-05 |
| P5-08 | Manual refund | backend, admin | M | P5-07 |
| P5-09 | Moderation queue | backend, admin | M | P5-03, P4-04 |
| P5-10 | Invitation overview, read-only | backend, admin | M | P5-03 |
| P5-11 | Dashboard metrics | backend, admin | M | P5-03 |
| P5-12 | Audit log viewer | backend, admin | M | P5-03 |
| P5-13 | Slug blocklist management | backend, admin | M | P5-03, P1-09 |
| P5-14 | Phase 5 test suite and acceptance | all | M | all above |

---

## P5-01 — Admin Application Shell and Session Isolation

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-22, P0-23 |
| **Spec refs** | `docs/SECURITY/02-TRUST-BOUNDARIES.md` boundary 3→4, `docs/PLAN/12-ADMIN-PANEL.md` § Access Control, `docs/UI-UX/15` § Admin Panel |
| **Spec required** | Yes — trust boundary |
| **Surface** | admin, infra |

**Goal** — The admin panel runs on its own subdomain with a session that has nothing to do with the user application's.

**Steps**
1. Serve the admin app at `admin.maindomain.com` with cookies scoped to that host, so an XSS in the user application cannot reach an admin session (`docs/SECURITY/02` boundary 3→4).
2. Apply a stricter Content-Security-Policy than the user app — the admin surface has no third-party embeds to accommodate.
3. Shorten the admin session to about four hours, per `docs/SECURITY/03` § Admin Session.
4. Build the shell: navigation for dashboard, users, templates, orders, moderation, audit logs (`docs/UI-UX/02` § Admin sitemap), desktop-first per `docs/UI-UX/15`.
5. Show an explicit "unauthorized" page rather than a generic 404 when a non-admin arrives, per `docs/FRONTEND/01` § Route Guards — an internal user who mistyped deserves a clear answer.
6. Consider network-level restriction (IP allowlist or VPN) for the admin host, and record the decision.

**Definition of Done**
- [ ] The admin session cookie is not sent to the user application's host, verified by inspection.
- [ ] Session expiry is shorter than the user session's.
- [ ] A non-admin sees an unauthorized page, not a 404.
- [ ] The admin CSP is stricter than the app's and documented.

---

## P5-02 — Admin 2FA and Step-Up Re-Authentication

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-03, P5-01 |
| **Spec refs** | `docs/SECURITY/03-AUTHENTICATION-SECURITY.md` § Admin Session, `docs/PLAN/12` § Access Control, `docs/SECURITY/01` § Admin Panel |
| **Spec required** | Yes — authentication |
| **Surface** | backend, admin |

**Goal** — TOTP is mandatory for admin accounts, and the most damaging actions require re-authentication even inside a valid session.

**Steps**
1. Resolve `PG-13`: `docs/SECURITY/03` and `docs/PLAN/12` require mandatory admin 2FA, and `docs/DATABASE/` has no table for it. Add `user_mfa_factors` (user_id, type, secret_encrypted, confirmed_at, created_at) and `user_recovery_codes` (user_id, code_hash, used_at), and amend `docs/DATABASE/02`.
2. Implement TOTP enrolment with a QR code, confirmation of a first valid code before activation, and single-use recovery codes stored hashed.
3. Encrypt the TOTP secret at rest — a secret readable from a database dump is a shared password.
4. Enforce 2FA at login for `admin` and `super_admin`: no bypass, no "remind me later". An unenrolled admin can reach enrolment and nothing else.
5. Implement step-up re-authentication for high-impact actions, per `docs/SECURITY/03`: refunds and user suspension require a fresh factor even in an active session.
6. Rate limit code verification and log every failure as a security event.
7. Define the account recovery path for a lost device, and make it require more than an email — the recovery path is a full admin account takeover if it is weak.

**Definition of Done**
- [ ] An admin cannot reach any panel function without an active TOTP factor.
- [ ] Refund and suspension require a fresh factor, proven by a test.
- [ ] Recovery codes are single-use and stored hashed.
- [ ] TOTP secrets are encrypted at rest.
- [ ] Failed verification attempts are rate limited and logged.

---

## P5-03 — Admin Authorization Path and Audit Middleware

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-14, P1-06 |
| **Spec refs** | `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` § Special Case, `docs/API/09-ADMIN-API.md` § Principles, `docs/DATABASE/10-AUDIT-LOGS.md` |
| **Spec required** | Yes — authorization, audit |
| **Surface** | backend |

**Goal** — Admin routes are role-gated, every write is audited with a reason, and every ownership bypass is recorded.

**Steps**
1. Mount `/api/v1/admin/*` behind `requireRole('admin','super_admin')` plus the 2FA check.
2. Route all cross-tenant reads through the `adminFind*` functions from `P0-11`, writing an audit row for each — `docs/SECURITY/05` § Special Case calls this a deliberate tenant-isolation bypass that must be auditable.
3. Require a `reason` on every write endpoint affecting a user, per `docs/API/09` § Principles, and reject the request without it — not with a default string, which would make the audit trail useless.
4. Write the audit row inside the same transaction as the change (`P0-14`).
5. Enforce the content boundary from `docs/API/09`: admins cannot modify invitation content — names, photos, events. Their write surface is lifecycle actions and moderation only. Implement this as absence of endpoints, not as a check inside a general-purpose endpoint.
6. Restrict `GET /admin/payments/:id/raw-log` to a narrower role and log every access as sensitive-data access (`docs/API/09`).
7. Do not let `admin` imply `super_admin` (`docs/PLAN/03` § Authorization Principles).

**Definition of Done**
- [ ] Every admin write produces an audit row with actor, resource, reason and before/after.
- [ ] A write without a reason is rejected.
- [ ] No endpoint exists through which an admin can edit invitation content; a test asserts the route is absent.
- [ ] Raw payment log access is separately restricted and logged.
- [ ] A regular user reaching an admin route gets a consistent denial with no information leak.

---

## P5-04 — Template and Version Management API

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-20, P5-03 |
| **Spec refs** | `docs/API/03-TEMPLATE-API.md` § Admin, `docs/PLAN/07` § Template Preview & Publishing, `docs/PLAN/02` § BR-3 |
| **Spec required** | Yes — core architecture |
| **Surface** | backend |

**Goal** — Templates and versions are fully managed through the API, so adding a template never requires a deploy — the requirement in `docs/PLAN/00` § Constraints.

**Steps**
1. Implement the admin endpoints in `docs/API/03`: create template, update metadata, create version, update version definition, publish version, deprecate version, delete template.
2. Validate `sections` and `theme` against the `P0-20` schema on every write, rejecting unknown field paths and unregistered component names.
3. Enforce the version lifecycle: `draft` versions are editable, `published` versions are immutable — an invitation locked to a version must render the same thing forever (BR-3.1). Changing a published version is a data-integrity violation dressed up as an edit; publishing a new version is the supported path.
4. Publishing a new version leaves existing invitations on their locked version (`docs/API/03` § Important Rules).
5. Allow deleting a template only when no invitation has ever referenced it — the `ON DELETE RESTRICT` from `docs/DATABASE/01` is the backstop, but the API should refuse with a clear message rather than surfacing a constraint error.
6. Implement deprecation: removed from the catalog, still rendered for existing invitations (BR-3.3).
7. Invalidate the template cache from `P2-01` on publish and deprecate.
8. Audit every template write.

**Definition of Done**
- [ ] A new template can be created and published entirely through the API, with no code change and no deploy.
- [ ] A published version cannot be edited; the attempt is refused with an explanation.
- [ ] Publishing a new version does not alter any existing invitation's rendering, proven by a test.
- [ ] Deprecated versions vanish from the catalog and still render for invitations that hold them.
- [ ] Invalid section definitions are rejected with the offending path named.

---

## P5-05 — Template Editor UI, Assets, Dummy Preview

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P5-04, P2-03 |
| **Spec refs** | `docs/PLAN/12` § Template Management, `docs/PLAN/07` § Template Preview & Publishing, `docs/UI-UX/11` |
| **Spec required** | No |
| **Surface** | admin |

**Goal** — A template author can define sections and theme, upload assets, preview with dummy data, and publish — without hand-editing JSON in a database client.

**Steps**
1. Build the metadata form: slug, name, categories, premium flag, thumbnail.
2. Build the section definition editor: add and reorder sections, pick a component from the registered list, set `configurable`, `enabled_by_default`, `max_items`, layout options, and choose `required_fields` and `optional_fields` from the canonical registry rather than free text. Selecting from a list is what prevents the typo class of bug at the source.
3. Build the theme editor with colour pickers and font selection, plus a contrast warning when a chosen pair fails WCAG AA (`docs/UI-UX/17`) — the template author is the last person who can prevent an unreadable invitation.
4. Build the `customizable_theme_keys` selector defining what end users may override.
5. Build asset upload into `template_assets`, through the same validated media pipeline as user uploads.
6. Build live preview with dummy data using the real renderer in `demo` mode (`docs/PLAN/07` step 2).
7. Build the publish and deprecate actions with confirmation stating the consequences.
8. Show which invitations are on each version before deprecating, so the decision is informed.

**Definition of Done**
- [ ] A complete template can be authored, previewed and published in the UI with no manual JSON editing.
- [ ] Field paths and component names are chosen from lists, never typed.
- [ ] The contrast warning fires on a failing colour pair.
- [ ] Preview uses the production renderer.
- [ ] Deprecation shows the affected invitation count first.

---

## P5-06 — User Management

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P5-03 |
| **Spec refs** | `docs/API/09-ADMIN-API.md` § User Management, `docs/PLAN/12` § User Management, `docs/SECURITY/09` |
| **Spec required** | Yes — authorization |
| **Surface** | backend, admin |

**Goal** — Support staff can find a user and suspend or unsuspend them, with a reason, and nothing more.

**Steps**
1. Implement list with search and status filter, and detail showing the user's invitations and order history (`docs/PLAN/12`).
2. Implement suspend and unsuspend with a mandatory reason, audited.
3. Define and implement what suspension means concretely: the user cannot log in; existing sessions are revoked; **published invitations stay published**. Taking down a live wedding invitation as a side effect of an account action would be a serious product failure, so the decision is explicit rather than emergent.
4. Show only what support needs. A user's invitation content is not required to answer a billing question, and `docs/SECURITY/09` frames unnecessary exposure as a privacy cost.
5. Never display a password hash, token, or full bank account number in the panel.
6. Build the UI with fast search by email or name, matching the one-to-two-click bar from `docs/UI-UX/03` (Rina).

**Definition of Done**
- [ ] Suspension revokes sessions and blocks login immediately.
- [ ] Published invitations remain reachable after their owner is suspended; a test asserts it.
- [ ] Every suspension has a reason in the audit log.
- [ ] No credential or sensitive financial field is rendered anywhere in the panel.

---

## P5-07 — Order and Payment Management

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P5-03, P3-05 |
| **Spec refs** | `docs/API/09-ADMIN-API.md` § Order & Payment, `docs/PLAN/12` § Order Management, `docs/SECURITY/07`, `docs/DATABASE/08` |
| **Spec required** | Yes — payment |
| **Surface** | backend, admin |

**Goal** — Support can see order and payment state, including the raw callback when debugging, under restricted and logged access.

**Steps**
1. Implement order list with status filter and order detail including payment records.
2. Implement `GET /admin/payments/:id/raw-log` behind the narrower restriction from `P5-03`, logging who accessed it and when.
3. Redact obviously sensitive fields in the default detail view, requiring the explicit raw-log action to see everything — separating routine support from a deliberate, recorded act.
4. Show the payment status timeline: initiated, webhook received, verified, with signature validity, so a support question can be answered from the panel rather than from server logs.
5. Surface failed signature verifications for a payment, since they are a fraud signal (`docs/DEVOPS/07`).
6. Never expose a provider server key or webhook secret in the panel.

**Definition of Done**
- [ ] Order and payment state is visible without exposing raw payloads by default.
- [ ] Raw log access is separately gated and produces a sensitive-access log entry.
- [ ] Provider credentials never appear in any response.
- [ ] The timeline makes a stuck payment diagnosable without database access.

---

## P5-08 — Manual Refund

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P5-07 |
| **Spec refs** | `docs/BACKEND/05-PAYMENT-FLOW.md` § Refund, `docs/PLAN/02` § BR-5.4, `docs/PLAN/06`, `docs/API/09` |
| **Spec required** | Yes — payment, business rule |
| **Surface** | backend, admin |

**Goal** — An admin can refund an order, with the invitation's state changing correctly and the whole thing audited.

**Steps**
1. Resolve `PG-14` before implementing — the two documents disagree. `docs/PLAN/02` § BR-5.4 says a refund moves the invitation `paid → draft` and unpublishes a published one; `docs/BACKEND/05` § Refund sets a published invitation to `paid`, which leaves it re-publishable without paying again. `docs/BACKEND/09` § E2E hedges with "reverts to draft/the correct status". These cannot all be right, and the difference is whether a refunded customer can put their invitation back online for free. Recommendation: refund sets the invitation to `draft` (BR-5.4), since a refund reverses the entitlement, and a `paid` state after a refund means the platform gave back the money and the product. Record the ADR and amend whichever document loses.
2. Implement `POST /admin/orders/:id/refund` with a mandatory reason and step-up re-authentication from `P5-02`.
3. In one transaction: set the order `refunded`, transition the invitation per the resolved rule, write status history with the admin as actor and the reason, and write the audit row.
4. Invalidate the public cache immediately if the invitation was published — the page must stop being served, not eventually stop.
5. Emit `order.refunded` for the notification in `P4-07`.
6. Record whether the money movement is performed here or in the provider's dashboard, and make the UI say which. An admin who believes the button refunded the customer when it only changed a status row will tell the customer something false.
7. Show a confirmation dialog naming the customer, the amount, and the effect on the invitation.

**Definition of Done**
- [ ] The state-transition contradiction is resolved by ADR and the losing document is amended.
- [ ] Refund requires a reason and a fresh authentication factor.
- [ ] A refunded published invitation stops being publicly reachable immediately, including from cache.
- [ ] The audit row records actor, reason, before and after.
- [ ] The UI states plainly whether money movement is automatic or manual.

---

## P5-09 — Moderation Queue

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P5-03, P4-04 |
| **Spec refs** | `docs/API/09-ADMIN-API.md` § Moderation, `docs/PLAN/12` § Moderation Queue, `docs/PLAN/05` § Admin moderation flow |
| **Spec required** | No |
| **Surface** | backend, admin |

**Goal** — Platform-level moderation of reported and flagged content, distinct from the owner's own moderation.

**Steps**
1. Implement the admin moderation endpoints in `docs/API/09` for guestbook entries.
2. Feed the queue from both sources in `docs/PLAN/05`: user reports and automatic content-filter flags from `P4-05`.
3. Add the reporting path if none exists yet — `docs/PLAN/12` § Moderation Queue lists "reported content" as a queue source with no reporting mechanism specified. A minimal report action on the public page, rate limited, is enough; record the decision.
4. Show the entry in context — which invitation, which owner — so a decision is informed.
5. Audit every moderation action, per `docs/PLAN/05` § Admin moderation flow.
6. Invalidate the affected invitation's cache after a decision.
7. Build the UI for one-to-two-click decisions with a filter per invitation.

**Definition of Done**
- [ ] Reported and auto-flagged entries reach one queue.
- [ ] Every decision writes an audit row.
- [ ] A rejection or deletion takes effect on the public page immediately.
- [ ] The reporting mechanism exists and is rate limited.

---

## P5-10 — Invitation Overview, Read-Only

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P5-03 |
| **Spec refs** | `docs/API/09-ADMIN-API.md` § Invitation Overview, `docs/PLAN/12` § Invitation Overview, `docs/SECURITY/05` § Special Case |
| **Spec required** | Yes — authorization |
| **Surface** | backend, admin |

**Goal** — Support can find an invitation by slug or user and see its state, without the ability to edit a couple's content.

**Steps**
1. Implement search by slug and by user, and a detail view — read-only, per `docs/PLAN/12` § 6 and `docs/API/09` § Principles.
2. Route every read through `adminFind*` with an audit row. This is the most-used ownership bypass in the system, so its logging is what makes the bypass acceptable.
3. Show operational state — status, template version, order history, publish and expiry dates, status history — rather than the couple's personal content. Answering "why can't they publish" needs the validation result, not their family details.
4. Provide no write path at all. Absence of the endpoint is the enforcement.
5. Rate limit admin search to make bulk enumeration of user data visible and slow.

**Definition of Done**
- [ ] Every admin invitation read is audited with the admin's identity.
- [ ] No write endpoint exists on this surface.
- [ ] The view answers common support questions without exposing more personal content than needed.
- [ ] Bulk enumeration is rate limited and detectable.

---

## P5-11 — Dashboard Metrics

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P5-03 |
| **Spec refs** | `docs/API/09` § Dashboard, `docs/PLAN/12` § Dashboard, `docs/PLAN/14` § Phase 2 funnel |
| **Spec required** | No |
| **Surface** | backend, admin |

**Goal** — The operational numbers the team needs daily: users, invitations by status, revenue, orders over time.

**Steps**
1. Implement `GET /admin/dashboard/summary` with the metrics in `docs/PLAN/12` § Dashboard.
2. Compute in SQL with appropriate indexes; cache briefly since the dashboard is polled.
3. Show the draft → paid → published funnel from `docs/PLAN/14`, which is the number that tells the team whether the product is working — `docs/PLAN/00` sets a 15% conversion target.
4. Keep revenue figures based on `orders.amount_total` for paid orders, minus refunds, and label the basis so nobody misreads it.
5. Build simple charts with the design system, avoiding a heavyweight charting dependency for four numbers.

**Definition of Done**
- [ ] Summary numbers match direct database queries in a seeded test.
- [ ] The conversion funnel is visible.
- [ ] Revenue is labelled with its basis and excludes refunds.
- [ ] The dashboard loads quickly on a realistic data volume.

---

## P5-12 — Audit Log Viewer

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P5-03 |
| **Spec refs** | `docs/API/09` § Audit Log, `docs/DATABASE/10-AUDIT-LOGS.md`, `docs/SECURITY/12-INCIDENT-RESPONSE.md` |
| **Spec required** | No |
| **Surface** | backend, admin |

**Goal** — The audit trail is searchable by the people who need it during an investigation, not only by someone with database access.

**Steps**
1. Implement `GET /admin/audit-logs` with the filters in `docs/API/09`: admin, resource type, date range, plus resource id.
2. Show before and after state readably, with a diff view for changed fields.
3. Make it clear the log is append-only and cannot be edited from the panel (`docs/DATABASE/10` § Policy).
4. Support export for incident investigation, itself audited — reading the audit log in bulk is an event worth recording.
5. Respect the two-year retention from `docs/DATABASE/10` and make the retention visible in the UI so nobody assumes a longer history exists.

**Definition of Done**
- [ ] All documented filters work, with pagination.
- [ ] Before and after states render readably.
- [ ] No panel action can modify or delete an audit row.
- [ ] Bulk export is itself audited.

---

## P5-13 — Slug Blocklist Management

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P5-03, P1-09 |
| **Spec refs** | `docs/SECURITY/10-ABUSE-PREVENTION.md` § Slug Blocklist, `docs/PLAN/10` § Subdomain, `docs/PLAN/18` R7 |
| **Spec required** | Yes — abuse prevention |
| **Surface** | backend, admin |

**Goal** — The reserved-word and profanity blocklist is data an admin can update, not a constant that needs a deploy.

**Steps**
1. Resolve `PG-15`: `docs/SECURITY/10` requires the blocklist to be "updatable without a deploy" and no table exists for it. Add `slug_blocklist` (term, match_type, reason, created_by, created_at) and amend `docs/DATABASE/`.
2. Seed it with the reserved system words from `docs/PLAN/10`: `admin`, `api`, `www`, `app`, `mail`, `ftp`, and the rest, plus an initial profanity list.
3. Implement case-insensitive matching with the substring and basic leetspeak variation handling described in `docs/SECURITY/10`, and support both exact and substring match types — blocking every slug containing a short common word would be worse than the problem.
4. Cache the list and invalidate on change; slug validation runs on every invitation creation.
5. Build the admin CRUD with a test box for checking whether a candidate slug would be blocked, and audit every change.
6. Report existing slugs that a newly added term would have blocked, so the team knows what is already live.

**Definition of Done**
- [ ] The blocklist is data, and adding a term takes effect without a deploy.
- [ ] Matching is case-insensitive and handles the documented variations without excessive false positives, covered by tests both ways.
- [ ] Every change is audited.
- [ ] Adding a term reports which existing slugs would match.

---

## P5-14 — Phase 5 Test Suite and Acceptance

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | all Phase 5 tasks |
| **Spec refs** | `docs/PLAN/17-ACCEPTANCE-CRITERIA.md`, `docs/TESTING/03-E2E-TESTING.md` § 6, `docs/SECURITY/04`, `docs/SECURITY/05` |
| **Spec required** | No |
| **Surface** | all |

**Goal** — Close the phase by proving admin power is both sufficient and bounded.

**Steps**
1. Run the E2E from `docs/TESTING/03` § 6: admin approves a pending guestbook entry and it appears publicly.
2. Run the end-to-end template flow: author, publish, and build a user invitation on the new template with no deploy — the capability `docs/PLAN/00` § Constraints requires.
3. Run privilege escalation tests: a regular user against every admin endpoint, and a regular user attempting to set `role` in a profile update.
4. Verify every admin write action produced an audit row with a reason, by comparing action counts against audit row counts in a scripted session.
5. Verify admins cannot modify invitation content through any route.
6. Verify 2FA cannot be bypassed and step-up is enforced on refund and suspension.
7. Write the phase summary record.

**Definition of Done**
- [ ] The no-deploy template flow works end to end.
- [ ] Privilege escalation attempts all fail.
- [ ] Audit coverage of admin writes is complete, verified by count comparison rather than spot checks.
- [ ] The phase summary exists in `MEMORY/records/`.
