# Phase 4 — Engagement: RSVP, Guestbook, Notifications, Analytics

**Goal**: the parts of the product that guests actually touch — attendance confirmation and the guestbook — plus the owner-side tools to manage them, the transactional email that keeps everyone informed, and a page-view counter that does not cost a database write per visitor.

**What makes this phase different**: everything here accepts input from anonymous strangers on the internet. `docs/SECURITY/02-TRUST-BOUNDARIES.md` puts this surface at boundary 1, fully untrusted, and `docs/PLAN/18` rates RSVP and guestbook spam as the highest-likelihood risk in the register (R8). Rate limiting, sanitization and moderation are the feature here, not a wrapper around it.

**Exit criteria**: a guest can RSVP and sign the guestbook from a phone with no account; the owner sees both in a dashboard and can export RSVPs; moderation holds entries invisible until approved; transactional emails send reliably with failures visible; view counts increment without hammering the primary database.

**Roadmap reference**: `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` § Phase 4 (Week 10-11).

---

## Task Summary

| ID | Task | Surface | Size | Depends on |
|---|---|---|---|---|
| P4-01 | Public RSVP submission | backend | M | P2-07, P1-07 |
| P4-02 | Owner RSVP management and CSV export | backend | M | P4-01 |
| P4-03 | Public guestbook submission and listing | backend | M | P2-07, P1-07 |
| P4-04 | Owner guestbook moderation | backend | M | P4-03 |
| P4-05 | Public abuse controls and adaptive CAPTCHA | backend | M | P4-01, P4-03 |
| P4-06 | Notification module and email port | backend, worker | L | P0-15 |
| P4-07 | Transactional email wiring | worker | L | P4-06 |
| P4-08 | Notification preferences and delivery monitoring | backend, worker | M | P4-07 |
| P4-09 | Page view counter with write-behind flush | backend, worker | M | P2-07, P0-15 |
| P4-10 | Owner analytics summary | backend, web-app | M | P4-09, P4-02 |
| P4-11 | Frontend — engagement screens and live public sections | web-app, public-invite | L | P4-02, P4-04 |
| P4-12 | Phase 4 test suite and acceptance | all | M | all above |

---

## P4-01 — Public RSVP Submission

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P2-07, P1-07 |
| **Spec refs** | `docs/API/08-PUBLIC-INVITATION-API.md`, `docs/DATABASE/09-GUESTS.md`, `docs/PLAN/02` § BR-7, `docs/SECURITY/10-ABUSE-PREVENTION.md` |
| **Spec required** | Yes — public surface |
| **Surface** | backend |

**Goal** — `POST /public/i/:slug/rsvp` accepts an attendance confirmation from anyone holding the link, with the same validation rigour as an authenticated endpoint.

**Steps**
1. Implement the endpoint per `docs/API/08`, accepting guest name, attendance status, guest count and an optional message.
2. Accept submissions only for a `published` invitation with `rsvp_enabled = true` — a disabled RSVP section must reject writes, not merely hide the form. Hiding a form does not stop a POST.
3. Validate against `docs/DATABASE/09`: the attendance enum, guest count between 1 and 10, name and message lengths.
4. Sanitize name and message through `P1-16` before storage. These strings render on a public page for every other guest; `docs/SECURITY/08` calls stored XSS the primary risk on this surface.
5. Store `submitted_ip_hash`, never the raw IP, per `docs/DATABASE/09` and `docs/SECURITY/09` — enough for abuse detection, not a visitor-tracking database.
6. Rate limit to 10 per hour per (IP hash, slug) per `docs/SECURITY/10`.
7. Implement the soft duplicate guard from BR-7.2 using a cookie or local identifier: discourage an accidental double submission without blocking a family sharing one phone, which is a real pattern at Indonesian weddings.
8. Emit `rsvp.submitted` for the owner notification in `P4-07`.
9. Return a friendly confirmation; on rate limit, an inline message that leaves the form filled (`docs/UI-UX/05` § Public RSVP flow).

**Definition of Done**
- [ ] Submitting to a draft, unpublished or expired invitation returns 404 and stores nothing.
- [ ] Submitting when `rsvp_enabled = false` is rejected even with a hand-crafted request.
- [ ] Script payloads in name or message do not survive to the public page.
- [ ] Raw IPs are never stored, verified by inspecting the column.
- [ ] Rate limiting holds under a burst from one source, and different guests behind one NAT are not permanently blocked from a single legitimate submission each.

**Abuse cases to test**
| Abuse case | Source | Expectation |
|---|---|---|
| Stored XSS via guest name | `docs/SECURITY/08` | Sanitized, renders as text |
| Flood of submissions | `docs/PLAN/18` R8 | Rate limited per IP hash and slug |
| Submission to a disabled RSVP section | `docs/PLAN/02` § BR-4.1 | Rejected |
| Oversized message | `docs/DATABASE/09` | Rejected with a field error |

---

## P4-02 — Owner RSVP Management and CSV Export

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P4-01 |
| **Spec refs** | `docs/PLAN/04` § F10, `docs/UI-UX/10` § RsvpTable, `docs/API/04-INVITATION-API.md`, `docs/UI-UX/04` (Budi) |
| **Spec required** | Yes — new API surface |
| **Surface** | backend |

**Goal** — The owner can list, filter, summarize and export their RSVPs.

**Steps**
1. Implement the four endpoints now specified in `docs/API/04` § Sub-resource: RSVP (owner side), added by ADR-021:
   - `GET /api/v1/invitations/:id/rsvps` — paginated, filterable by attendance status,
   - `GET /api/v1/invitations/:id/rsvps/summary` — totals per status and total guest count,
   - `GET /api/v1/invitations/:id/rsvps/export` — CSV,
   - `DELETE /api/v1/invitations/:id/rsvps/:rsvp_id` — remove a spam or mistaken entry.
2. Scope every query by invitation and owner through the `P0-11` layer.
3. Compute the summary in SQL rather than by loading rows — a popular wedding produces hundreds of entries and the dashboard reads them on every visit.
4. Build the CSV with explicit columns and proper escaping. Prefix any cell beginning with `=`, `+`, `-` or `@` so a name cannot become a formula when the file opens in a spreadsheet — the export is opened by non-technical users and forwarded to clients (`docs/UI-UX/04`, Budi).
5. Include the guest message in the export, since organizers use it for seating notes.
6. Rate limit export, which is the most expensive read on the endpoint.

**Definition of Done**
- [ ] All four endpoints exist, are ownership-scoped, and `docs/API/04` is amended.
- [ ] The summary is computed in the database and matches a row-by-row count in a test.
- [ ] CSV injection is prevented, with a test using a `=cmd` guest name.
- [ ] Another user's RSVP list returns 404.

---

## P4-03 — Public Guestbook Submission and Listing

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P2-07, P1-07 |
| **Spec refs** | `docs/API/08-PUBLIC-INVITATION-API.md`, `docs/DATABASE/09-GUESTS.md`, `docs/PLAN/02` § BR-7.3 |
| **Spec required** | Yes — public surface |
| **Surface** | backend |

**Goal** — Guests can leave a message, and moderation genuinely holds it back when the owner asked for that.

**Steps**
1. Implement submit and list per `docs/API/08`.
2. Set the initial status by the owner's setting: `approved` when moderation is off, `pending` when on (`docs/DATABASE/09` § Notes, BR-7.3). The default in the schema is `approved`; the service overrides it, and a bug here publishes unmoderated content on a stranger's wedding page.
3. Serve the listing with `status = 'approved'` filtered **in the query**, with pagination.
4. Sanitize name and message; store the IP hash; rate limit at 10 per hour per (IP hash, slug).
5. Reject submissions when `guestbook_enabled = false`, by the same reasoning as RSVP.
6. Add the simple duplicate-content detection from `docs/SECURITY/10`: identical messages from different IP hashes in a short window are flagged for moderation rather than auto-blocked, since false positives on a wedding guestbook are worse than a queued message.
7. Emit `guestbook.submitted` for owner notification.
8. Tell the guest which outcome happened — posted, or awaiting approval — per `docs/UI-UX/05`.

**Definition of Done**
- [ ] With moderation on, a new entry is invisible in the public listing until approved, proven end to end.
- [ ] The approved filter is in SQL, not applied after fetching.
- [ ] Submissions to a disabled guestbook are rejected.
- [ ] The guest sees an honest message about whether their entry is live.

---

## P4-04 — Owner Guestbook Moderation

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P4-03 |
| **Spec refs** | `docs/PLAN/04` § F11, `docs/UI-UX/10` § GuestbookModerationList, `docs/API/04-INVITATION-API.md` |
| **Spec required** | Yes — new API surface |
| **Surface** | backend |

**Goal** — The owner moderates their own guestbook; the admin queue in Phase 5 is a separate, platform-level concern.

**Steps**
1. Implement the owner-side moderation endpoints now specified in `docs/API/04` § Sub-resource: Guestbook (owner side), added by ADR-021 — distinct from the admin queue in `docs/API/09`, which is a platform-level concern:
   - `GET /api/v1/invitations/:id/guestbook` — all entries with status filter,
   - `PATCH /api/v1/invitations/:id/guestbook/:entry_id` — approve or reject,
   - `DELETE /api/v1/invitations/:id/guestbook/:entry_id`.
2. Scope entry ids by invitation, the two-step check from `docs/SECURITY/05` § 7.
3. Record `moderated_by` and `moderated_at` on every decision.
4. Invalidate the public page cache on approval so a newly approved message appears without waiting for TTL.
5. Handle the moderation toggle honestly: turning moderation **on** does not retroactively hide already-approved messages; turning it **off** does not auto-approve the pending queue. Whatever is chosen, state it in the UI — an owner who thinks they hid something that is still public has been failed by the product.

**Definition of Done**
- [ ] Approve, reject and delete work and are ownership-scoped.
- [ ] Approval invalidates the cache and the entry appears publicly.
- [ ] Moderator identity and time are recorded.
- [ ] Toggle semantics are implemented, documented, and surfaced in the UI copy.

---

## P4-05 — Public Abuse Controls and Adaptive CAPTCHA

| | |
|---|---|
| **Status** | TODO — vendor decided (ADR-011: Cloudflare Turnstile); the activation threshold is open as `OQ-14` |
| **Depends on** | P4-01, P4-03 |
| **Spec refs** | `docs/SECURITY/10-ABUSE-PREVENTION.md`, `docs/PLAN/18` R8, `docs/DEVOPS/07-ALERTING.md` |
| **Spec required** | Yes — abuse prevention |
| **Surface** | backend |

**Goal** — Spam controls that escalate under attack and stay invisible during a normal wedding.

**Steps**
1. Integrate **Cloudflare Turnstile** (ADR-011, already part of the edge stack), verified server-side.
2. Make it **adaptive**, per `docs/SECURITY/10`: off by default, enabled automatically for a slug that crosses a suspicious-traffic threshold. An always-on challenge in front of an RSVP form costs real confirmations from the elderly-guest persona in `docs/UI-UX/03`, which is a product cost, not just a UX one.
3. Implement escalating temporary blocks for repeat rate-limit violators.
4. Add the optional profanity filter as a per-invitation toggle, feeding the moderation queue rather than blocking outright.
5. Emit metrics for submission rate per slug, CAPTCHA activations and block events, with the alert from `docs/DEVOPS/07`.
6. Give admins a manual override to lift a block (`docs/SECURITY/10` § Monitoring & Auto-block), wired into the panel in Phase 5.

**Definition of Done**
- [ ] CAPTCHA activates automatically under a simulated flood and deactivates after it subsides.
- [ ] A normal guest never sees a challenge in the happy path.
- [ ] Repeat violators are blocked with escalating duration.
- [ ] Abuse metrics exist with alert rules attached.

---

## P4-06 — Notification Module and Email Port

| | |
|---|---|
| **Status** | TODO — provider decided (ADR-013: Resend) |
| **Depends on** | P0-15 |
| **Spec refs** | `docs/BACKEND/07-NOTIFICATION.md`, `docs/PLAN/13-NOTIFICATION-SYSTEM.md`, `docs/ARCHITECTURE/07` |
| **Spec required** | No |
| **Surface** | backend, worker |

**Goal** — An event-driven notification module with a swappable email provider and centrally stored templates.

**Steps**
1. Define `EmailPort` with `send({to, template, data})`, per `docs/BACKEND/07` § Provider Abstraction, and implement the **Resend** adapter (ADR-013). Amazon SES is the expected migration once volume justifies it, which is what the port is for.
2. Implement the notification module as an event consumer on the internal bus, listening for the events listed in `docs/BACKEND/07`.
3. Author templates as **React Email** components in `packages/ui`, rendered with data — never as HTML strings inside handlers (`docs/PLAN/13` § Email Templates). ADR-013 notes the trade honestly: templates ship with a deploy rather than being editable at runtime, accepted because a deploy here is a container rebuild and typed templates catch a missing variable at build time rather than in a customer's inbox.
4. Give every email a consistent header and footer, and write copy in Bahasa Indonesia per `MEMORY/DECISIONS.md` ADR-001: engineering documentation is English, user-facing copy is Indonesian.
5. Wrap handlers in try/catch with the retry policy from `docs/ARCHITECTURE/07`; a delivery failure never affects the transaction that emitted the event, which has already committed.
6. Configure SPF, DKIM and DMARC for the sending domain — transactional mail that lands in spam is a silent product failure, and password reset mail is a phishing target.
7. Provide a preview command or route so copy can be reviewed without sending.

**Definition of Done**
- [ ] Nothing outside the adapter knows the email provider.
- [ ] Templates live outside handler code and render with sample data in a test.
- [ ] SPF, DKIM and DMARC pass on a real send from staging.
- [ ] A provider outage produces retries and a DLQ entry, not a lost transaction.

---

## P4-07 — Transactional Email Wiring

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P4-06 |
| **Spec refs** | `docs/PLAN/13-NOTIFICATION-SYSTEM.md` § Notification List, `docs/BACKEND/07`, `docs/PLAN/02` § BR-9 |
| **Spec required** | No |
| **Surface** | worker |

**Goal** — Every notification in `docs/PLAN/13`'s table exists, triggered by the right event.

**Steps**
1. Wire each row of the table: account verification, password reset, invoice on payment success, publish confirmation, new RSVP (preference-gated), expiry reminders at H-7 and H-1, expiry notice, refund notice, **and the gift account change notice** (`docs/PLAN/13`).
1b. The gift account change email is a security control, not a courtesy: it is what lets a couple whose account was compromised notice that the number guests are sending money to has been swapped (R16, ADR-025). It names what changed and when, and it is **not** subject to notification preferences.
2. Implement `reminder_email_h7_h1` daily at 08:00 WIB per `docs/BACKEND/08`, idempotent so a re-run does not send twice.
3. Implement the three retention warnings before deletion required by BR-9, at defined intervals during the 90-day expired window.
4. Include the invoice PDF from `P3-08` with the payment confirmation.
5. Make every email actionable: the publish email carries the live link; the expiry reminder carries a renewal link; the RSVP notification names the guest.
6. Add unsubscribe or preference links where the message is not strictly transactional.
7. Test each template rendering with real data shapes, including long names and missing optional fields.

**Definition of Done**
- [ ] Every notification in `docs/PLAN/13`'s table is implemented and tested.
- [ ] Reminder jobs are idempotent; a double run sends one email.
- [ ] Deletion warnings send at the defined points before data loss.
- [ ] No email leaks another user's data; templates render only the recipient's own information.

---

## P4-08 — Notification Preferences and Delivery Monitoring

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P4-07 |
| **Spec refs** | `docs/BACKEND/07` § Preferences, `docs/DATABASE/02-USERS.md`, `docs/DEVOPS/07-ALERTING.md` |
| **Spec required** | No |
| **Surface** | backend, worker |

**Goal** — Preferences are honoured, and a failing email pipeline is visible rather than silent.

**Steps**
1. Check `user_notification_preferences` before sending preference-gated mail, per `docs/BACKEND/07` § Preferences.
2. Never gate the mandatory messages — verification, password reset, invoice, refund, and the gift account change notice. A user cannot opt out of the receipt for money they paid, nor of being told that the account number their guests will pay into has changed.
3. Offer the daily RSVP digest alternative mentioned in `docs/PLAN/13` for owners who do not want one email per guest; a popular wedding produces hundreds.
4. Monitor the DLQ and alert when a critical transactional email fails permanently (`docs/DEVOPS/07`).
5. Track delivery, bounce and complaint rates from the provider, and handle hard bounces so a dead address does not degrade domain reputation.

**Definition of Done**
- [ ] Preference-gated emails respect the toggle; a test asserts both states.
- [ ] Mandatory emails ignore preferences.
- [ ] A permanently failed invoice email raises an alert.
- [ ] Bounce handling exists and is tested with a simulated bounce.

---

## P4-09 — Page View Counter with Write-Behind Flush

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P2-07, P0-15 |
| **Spec refs** | `docs/PLAN/14-ANALYTICS.md`, `docs/ARCHITECTURE/06` § What Is Cached, `docs/BACKEND/08-JOBS-WORKERS.md`, `docs/SECURITY/09` |
| **Spec required** | Yes — data model, privacy |
| **Surface** | backend, worker |

**Goal** — Aggregate view counts per invitation, without a database write per visitor.

**Steps**
1. Implement against `invitation_view_counts` (`docs/DATABASE/11-ANALYTICS.md`, added by ADR-020): daily grain, upserted by the flush job, so the owner dashboard can show a trend rather than one lifetime number. The document also specifies the upsert and states the best-effort semantics explicitly.
2. Increment in Redis on request, per `docs/PLAN/14` § Implementation Summary — never write to the primary database on a page view, which is exactly the traffic that spikes on the wedding day.
3. Flush to the database every minute via `analytics_counter_flush` (`docs/BACKEND/08`), which is best-effort: dropping a batch on failure is acceptable and must be an explicit, documented choice rather than an accident.
4. Store no per-visitor data. `docs/PLAN/14` § Privacy and `docs/SECURITY/09` both scope MVP analytics to aggregates only — no visitor identity, no behavioural tracking.
5. Rate limit the view endpoint so the counter cannot be trivially inflated, while accepting that an aggregate counter is not an audited metric.
6. Make the endpoint fire-and-forget from the client: it never blocks rendering and its failure is invisible to the guest.

**Definition of Done**
- [ ] A page view performs no primary-database write.
- [ ] The flush job is idempotent and its failure mode is documented as best-effort.
- [ ] No per-visitor row is created anywhere.
- [ ] Counter increments survive a flush cycle and appear in the owner dashboard.

---

## P4-10 — Owner Analytics Summary

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P4-09, P4-02 |
| **Spec refs** | `docs/PLAN/14-ANALYTICS.md` § MVP, `docs/PLAN/04` § F10 |
| **Spec required** | No |
| **Surface** | backend, web-app |

**Goal** — A small, honest dashboard: visits, RSVP breakdown, guestbook count.

**Steps**
1. Implement `GET /api/v1/invitations/:id/analytics` returning total and daily views, RSVP counts by status, total guest count, and guestbook counts by status.
2. Compute in SQL, cache briefly — this is a page an anxious couple refreshes often in the week before the wedding.
3. Present it in the dashboard with the summary and simple trend from `docs/PLAN/14` § MVP.
4. Label the numbers honestly: "page opens" is not "unique guests", and the MVP does not measure the latter (`docs/PLAN/14` § Phase 2).

**Definition of Done**
- [ ] The endpoint is ownership-scoped and returns the four metric groups.
- [ ] Numbers match the underlying tables in a seeded test.
- [ ] Labels do not overstate what is measured.

---

## P4-11 — Frontend: Engagement Screens and Live Public Sections

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P4-02, P4-04 |
| **Spec refs** | `docs/UI-UX/10` § RsvpTable, GuestbookModerationList, `docs/UI-UX/14` § Key Interactions, `docs/UI-UX/15`, `docs/UI-UX/17` |
| **Spec required** | No |
| **Surface** | web-app, public-invite |

**Goal** — The owner's RSVP and guestbook screens, and the public RSVP and guestbook sections wired for real submission.

**Steps**
1. Build `RsvpTable` per `docs/UI-UX/10`: name, status badge, guest count, truncated-and-expandable message, timestamp, status filter, CSV export, and a header summary.
2. Build `GuestbookModerationList` with pending, approved and rejected tabs and one-click actions — `docs/UI-UX/03` (Rina) sets the bar at one or two clicks per decision.
3. Stack both as cards on mobile rather than horizontally scrolling tables (`docs/UI-UX/15`).
4. Wire the public RSVP form: submit, replace the form with a thank-you on success, keep the entered values on failure (`docs/UI-UX/05` § Public RSVP flow).
5. Wire the public guestbook: submit, append optimistically when moderation is off, show "awaiting approval" when it is on, and paginate or lazy-load a long list.
6. Make both public forms genuinely accessible: 16px minimum body text, real labels, few required fields, announced errors. `docs/UI-UX/17` singles this out because the audience includes the least technical users the product has.
7. Show the toggle for moderation and RSVP enablement in editor settings, with plain-language explanations of the effect.

**Definition of Done**
- [ ] Owner screens work at 360px width.
- [ ] A failed public submission preserves the guest's input.
- [ ] Public forms pass the accessibility audit, including a screen reader pass.
- [ ] Moderation state is obvious to the owner without reading documentation.

---

## P4-12 — Phase 4 Test Suite and Acceptance

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | all Phase 4 tasks |
| **Spec refs** | `docs/TESTING/03-E2E-TESTING.md` § 3, `docs/PLAN/17-ACCEPTANCE-CRITERIA.md`, `docs/SECURITY/10` |
| **Spec required** | No |
| **Surface** | all |

**Goal** — Close the phase with the public surface proven safe under hostile input.

**Steps**
1. Run the E2E flow from `docs/TESTING/03` § 3: open the public page anonymously, submit RSVP and guestbook, verify moderation gating, verify appearance on the owner dashboard.
2. Run the XSS payload set against every public free-text field and confirm nothing executes when rendered.
3. Verify rate limits per policy for the public endpoints.
4. Verify no raw IP is stored anywhere.
5. Verify email delivery for every notification against the mail catcher, including preference gating.
6. Confirm the view counter performs no primary-database write under load.
7. Write the phase summary record.

**Definition of Done**
- [ ] The E2E engagement flow passes including moderation.
- [ ] The XSS sweep across public fields is clean.
- [ ] Rate limits match `docs/SECURITY/10` for every public endpoint.
- [ ] The phase summary exists in `MEMORY/records/`.
