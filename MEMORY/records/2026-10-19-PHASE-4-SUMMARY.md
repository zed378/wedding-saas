# Phase 4 — Completion Summary

| | |
|---|---|
| **Phase** | Phase 4 — Engagement |
| **Started** | 2026-10-17 |
| **Completed** | 2026-10-19 |
| **Tasks completed** | 12 / 12 |
| **Release tag** | none — nothing is released until Phase 6 (`docs/PLAN/16`) |

---

## What Shipped

**A couple can now share their published wedding invitation, receive RSVPs with confirmed guest headcounts, collect and moderate guestbook wishes, monitor privacy-preserving page analytics, and receive transactional email alerts.**

1. **Public RSVP Submission (`P4-01`)**:
   - `POST /public/i/:slug/rsvp` allows invited guests to confirm attendance, specify headcount (1..10), and leave a message.
   - Enforces lifecycle check (published only) and `rsvp_enabled` setting.
   - Input sanitization strips stored XSS vectors; IP addresses are hashed using SHA-256 for privacy.

2. **Owner RSVP Management & CSV Export (`P4-02`)**:
   - `GET /api/v1/invitations/:id/rsvps` with attendance filtering (`attending`, `declined`, `tentative`).
   - SQL-aggregated counts and total guest headcount (`/summary`).
   - CSV export with formula injection mitigation (OWASP CSV Injection).
   - `DELETE /api/v1/invitations/:id/rsvps/:rsvp_id` with strict object-level authorization (404 for non-owners).

3. **Public Guestbook & Spam Guard (`P4-03`)**:
   - `POST /public/i/:slug/guestbook` and `GET /public/i/:slug/guestbook`.
   - Respects `guestbook_moderation` toggle: entries default to `approved` when moderation is off, or `pending` when on.
   - Duplicate spam detection flags identical messages from different IPs within 5 minutes to `pending`.

4. **Owner Guestbook Moderation (`P4-04`)**:
   - `GET /api/v1/invitations/:id/guestbook` with status tabs (`pending`, `approved`, `rejected`).
   - 1-click status updates (`PATCH /api/v1/invitations/:id/guestbook/:entry_id`) with immediate public cache invalidation on approved changes.
   - Delete action with confirmation.

5. **Abuse Controls & Adaptive CAPTCHA (`P4-05`)**:
   - Cloudflare Turnstile integration behind `CaptchaPort`.
   - Adaptive challenge activation (OQ-14): 20 submissions / 10-minute window activates a 30-minute CAPTCHA requirement.
   - Client status probe: `GET /public/i/:slug/captcha-status`.
   - Optional profanity filter (`profanity_filter_enabled`) routing flagged entries to `pending`.

6. **Notification Architecture & Localized Templates (`P4-06`, `P4-07`)**:
   - Abstract `EmailPort` with `ResendEmailAdapter` and `MemoryEmailAdapter`.
   - 14 localized Indonesian email templates in `@wi/ui/email` with responsive table layout.
   - BullMQ worker consumer for `notification.send` on pool `general`.
   - Automated reminder sweep (`reminder_email_h7_h1`) and 3-stage retention warnings (Days 30, 60, 83).

7. **Notification Preferences & Delivery Monitoring (`P4-08`)**:
   - User notification preferences table with `rsvp_email`, `rsvp_digest`, and `guestbook_email`.
   - Daily 09:00 WIB RSVP digest sweep (`RsvpDigestService`) aggregating responses.
   - Email bounce suppression table `email_bounces` with provider webhook.
   - DLQ monitoring with Prometheus alert `CriticalEmailDeadLettered`.
   - Mandatory security alerts (`password_changed`, `bank_account_changed`, `email_verification`, `order_paid`) unconditionally bypass preferences.

8. **In-Memory Page View Counter (`P4-09`)**:
   - `POST /public/i/:slug/view` increments pending hash in Redis (`HINCRBY`) with fail-open resilience, eliminating synchronous primary DB writes.
   - 1-minute write-behind flush `analytics_counter_flush` atomically upserts daily aggregates into `invitation_view_counts` (`Asia/Jakarta`).
   - Client-side beacon `<PageViewTracker />` and same-origin proxy in `public-invite` with zero PII stored.

9. **Owner Analytics Summary (`P4-10`)**:
   - `GET /api/v1/invitations/:id/analytics` combining page opens (with pending Redis views), RSVP breakdown, guest headcounts, and guestbook counts.
   - 30-second Redis cache to protect against refresh storms.
   - Dedicated web-app dashboard `/dashboard/[invitationId]/analytics` with honest metric labels.

10. **Frontend Engagement Screens & Public Forms (`P4-11`)**:
    - Owner `RsvpTable` and `/dashboard/[invitationId]/rsvps` with desktop table and mobile card stack (<640px down to 360px).
    - Owner `GuestbookModerationList` and `/dashboard/[invitationId]/guestbook` with badge tabs and 1-click actions.
    - Editor settings toggles for engagement features.
    - Live public interactive sections `PublicRsvpForm` and `PublicGuestbookWall` with strict input preservation on errors.

11. **Phase 4 Acceptance Gate (`P4-12`)**:
    - Automated acceptance suite `phase-4-acceptance.spec.ts` covering critical E2E engagement flow, XSS sweeps, rate-limit policies, zero raw IP storage, notification gating, and in-memory view counters.
    - Full regression across all workspaces: 815 backend tests, 409 web-app tests, 170 public-invite tests, 44 worker tests, 149 UI tests passing.
    - 0 security findings.

---

## Architectural Decisions Made in Phase 4

| ADR | Task | Title | Summary |
|---|---|---|---|
| ADR-087 | P4-03 | Public guestbook submission and approved listing | Moderation toggle support, duplicate spam guard, and XSS sanitization |
| ADR-088 | P4-04 | Owner guestbook moderation | Status transitions, query-level tenant scoping, and immediate public cache purge |
| ADR-089 | P4-05 | Public abuse controls and adaptive CAPTCHA | Cloudflare Turnstile, 20/10m adaptive threshold, and profanity routing |
| ADR-090 | P4-06 | Notification module and email port | Decoupled EmailPort, 14 localized Indonesian templates, and deliverability docs |
| ADR-091 | P4-07 | Decoupled email templates subpath export | Clean `@wi/ui/email` subpath eliminating UI bundling overhead |
| ADR-092 | P4-08 | Notification preferences and delivery monitoring | Daily RSVP digest, bounce suppression, and DLQ alerting |
| ADR-093 | P4-09 | Page view counter with in-memory Redis write-behind | Atomic 1-minute batch flush, client beacon, and zero PII storage |
| ADR-094 | P4-10 | Owner analytics summary and honest metric labeling | 30s cache TTL, parallel SQL queries, and honest open labels |
| ADR-095 | P4-11 | Frontend engagement screens and live public sections | Mobile-friendly card stack, input preservation on failure, and lazy section mounting |

---

## Exit Criteria Verification

| Exit Criterion | Status | Proof |
|---|---|---|
| Public RSVP and guestbook functional | MET | Automated tests `public-rsvp.itest.ts`, `public-guestbook.itest.ts`, `phase-4-acceptance.spec.ts` |
| Zero raw IP stored in database | MET | `submitted_ip_hash` is SHA-256; verified by schema inspection and `phase-4-acceptance.spec.ts` |
| Moderation state enforced | MET | Pending entries hidden from public wall; 1-click owner approval tested |
| Stored XSS defense across all fields | MET | 11 attack payloads stripped by `sanitizePlainText` in `phase-4-acceptance.spec.ts` |
| Page views do not write to SQL synchronously | MET | In-memory Redis `HINCRBY` verified under 50 concurrent requests |
| Mobile usability at 360px width | MET | Verified in `rsvp-dashboard.spec.tsx` and `guestbook-dashboard.spec.tsx` |
| All workspace tests clean | MET | 1587+ unit/integration tests passing across monorepo |
