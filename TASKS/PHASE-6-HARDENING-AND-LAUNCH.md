# Phase 6 — Hardening and Launch

**Goal**: prove the product is safe, fast, recoverable and usable — then pass the release gate in `docs/PLAN/17-ACCEPTANCE-CRITERIA.md` with evidence rather than confidence.

**What this phase is not**: the first time security is considered. Every prior phase carried its own abuse-case tests, and `docs/SECURITY/11` § Test Types requires multi-tenancy testing on every feature that touches an `:id`, not only before launch. This phase is the full sweep across the finished system, the external validation, and the operational readiness work that only makes sense once there is a whole system to exercise.

**Release blockers**: `docs/SECURITY/11` § Pass Criteria and `docs/PLAN/17` are explicit — zero critical or high findings in the multi-tenancy and payment categories, and no waiver is available for the multi-tenancy category. `docs/PLAN/00` § Success Metrics states zero tolerance for cross-tenant leaks.

**Exit criteria**: every checklist item in `docs/PLAN/17` and `docs/UI-UX/18` is ticked with named evidence; a database restore has actually been performed; load targets are met; the three sign-offs are recorded.

**Roadmap reference**: `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` § Phase 6 (Week 14-15).

---

## Task Summary

| ID | Task | Surface | Size | Depends on |
|---|---|---|---|---|
| P6-01 | Full IDOR and multi-tenancy sweep | backend | L | Phases 1-5 |
| P6-02 | Payment tampering and webhook abuse suite | backend | M | P3-16 |
| P6-03 | File upload attack suite | backend, worker | M | P1-18 |
| P6-04 | Injection, XSS and mass-assignment sweep | backend | M | P1-16 |
| P6-05 | Authentication and session abuse suite | backend | M | P1-03, P5-02 |
| P6-06 | SAST, DAST and dependency policy | infra | M | P0-17 |
| P6-07 | External penetration test and remediation | all | L | P6-01…P6-06 |
| P6-08 | Load and performance testing | infra, backend | L | P3-12 |
| P6-09 | Cache tuning and hit-ratio validation | backend, infra | M | P6-08 |
| P6-10 | Monitoring dashboards and alert rules | infra | L | P0-12, P3-05 |
| P6-11 | Logging, redaction and retention audit | backend, infra | M | P0-12 |
| P6-12 | Backup verification and DR drill | infra | L | P0-23 |
| P6-13 | Rollback drill and feature flags | infra | M | P0-17 |
| P6-14 | Cross-browser and device matrix | web-app, public-invite | M | Phases 2-4 |
| P6-15 | Accessibility audit | all frontend | L | Phases 2-5 |
| P6-16 | Privacy, legal pages and incident readiness | docs, web-app | M | — |
| P6-17 | UAT and release gate sign-off | all | L | all above |

---

## P6-01 — Full IDOR and Multi-Tenancy Sweep

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | Phases 1-5 |
| **Spec refs** | `docs/TESTING/04-SECURITY-TESTING.md` § IDOR Sweep, `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md`, `docs/PLAN/17` |
| **Spec required** | Yes — release blocker |
| **Surface** | backend |

**Goal** — Every endpoint accepting a resource identifier, tested with a second user's identifier, documented as a matrix.

**Steps**
1. Enumerate every `:id`-accepting endpoint across `docs/API/02` through `09` — parents and nested children alike. Build the list from the routing table rather than from the documents, so an endpoint that exists but was never documented is included.
2. Follow the methodology in `docs/TESTING/04`: two users, each with a complete invitation, media, orders and guests; then for each endpoint and each of GET, PATCH, DELETE, request user A's resource as user B.
3. Verify 404 with no leakage in the body, and no state change on write attempts.
4. Cover the indirect cases explicitly: another invitation's `media_id` attached to your gallery, another invitation's `bank_id` under your invitation's path, another user's `order_id` on the payment status endpoint, another invitation's `event_id`, `photo_id`, `rsvp_id`, `entry_id`.
5. Cover list endpoints: seed both users' data and confirm no foreign row appears.
6. Cover the admin bypass paths: confirm each writes an audit row.
7. Produce the endpoint × method × outcome matrix and commit it as part of the release record.
8. Convert the whole sweep into an automated suite that runs in CI, so this is a permanent regression net rather than a one-time exercise.

**Definition of Done**
- [ ] Every `:id` endpoint in the routing table appears in the matrix.
- [ ] Zero findings; per `docs/SECURITY/11` § Pass Criteria this category cannot be waived.
- [ ] The sweep runs in CI and fails the build on a regression.
- [ ] The matrix is committed with the release record.

---

## P6-02 — Payment Tampering and Webhook Abuse Suite

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P3-16 |
| **Spec refs** | `docs/TESTING/04` § Payment Tampering, `docs/SECURITY/07-PAYMENT-SECURITY.md`, `docs/SECURITY/11` |
| **Spec required** | Yes — release blocker |
| **Surface** | backend |

**Goal** — Re-run the payment abuse suite against the complete system, including the paths that only exist now that publishing, refunds and renewals are built.

**Steps**
1. Re-run the `docs/TESTING/04` methodology end to end against production-like staging.
2. Add the cases that only exist post-Phase-5: a webhook for a refunded order, a renewal webhook for an expired invitation, a webhook arriving during an in-flight refund.
3. Attempt entitlement without payment through every route: publish while `pending_payment`, publish after a refund, republish after a refund, renew with an unpaid order.
4. Attempt price manipulation at every layer: request body, tampered addon list, an inactive package, a stale price after an admin changes the master price mid-checkout.
5. Confirm the invalid-signature metric increments and its alert fires.
6. Confirm no payment secret appears in any log, on any path, including error paths.

**Definition of Done**
- [ ] No route grants entitlement without a verified payment.
- [ ] Price manipulation fails at every layer tested.
- [ ] Post-refund and renewal edge cases behave per `docs/PLAN/06`.
- [ ] The fraud-signal alert fires in a live test.

---

## P6-03 — File Upload Attack Suite

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-18 |
| **Spec refs** | `docs/SECURITY/06-FILE-UPLOAD-SECURITY.md`, `docs/TESTING/04`, `docs/PLAN/17` |
| **Spec required** | Yes — release blocker |
| **Surface** | backend, worker |

**Goal** — Every vector in `docs/SECURITY/06` tested against the running pipeline, as `docs/PLAN/17` requires by name.

**Steps**
1. Test each layer: spoofed MIME, spoofed extension, magic-byte mismatch, oversize, extreme dimensions, decompression bomb, EXIF GPS retention, path traversal in the filename, malware signature, direct bucket access.
2. Verify a polyglot file — valid image bytes with appended script content — cannot be served in an executable context.
3. Verify a failed file never becomes publicly reachable at any point in the pipeline, including during processing.
4. Verify the worker's resource limits hold under a deliberate bomb: the job fails, the host survives.
5. Verify EXIF stripping on real photos from real phones, not synthetic fixtures — the GPS-in-a-couple's-photo case is the one with a concrete privacy consequence.
6. Verify quota enforcement under concurrency.
7. Verify storage isolation: an object path from one invitation cannot be guessed or reached from another tenant's context.

**Definition of Done**
- [ ] All eleven layers in `docs/SECURITY/06` are covered by a named test.
- [ ] Zero critical findings.
- [ ] Real-phone photos come out with no EXIF.
- [ ] A decompression bomb fails safely without host impact.

---

## P6-04 — Injection, XSS and Mass-Assignment Sweep

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-16 |
| **Spec refs** | `docs/SECURITY/08-API-SECURITY.md`, `docs/SECURITY/11` § Pre-Launch Scenarios, `docs/PLAN/17` |
| **Spec required** | Yes — release blocker |
| **Surface** | backend |

**Goal** — No stored XSS on the public page, no injection through any filter parameter, no writable field that should not be.

**Steps**
1. Submit the XSS payload set into every free-text field in the registry from `P1-16` — including the public RSVP and guestbook, which are the highest-value targets because their output is seen by hundreds of strangers.
2. Verify rendering on the actual public page, not only in the API response. Sanitization that passes an API assertion and fails in the browser is the failure mode worth catching.
3. Fuzz query and filter parameters on every list and search endpoint for SQL injection (`docs/SECURITY/11`).
4. Run the mass-assignment sweep over every write endpoint with `role`, `owner_id`, `status`, `email_verified`, `amount_total`, `expiry_date`, `template_version_id`.
5. Verify error responses leak nothing — no stack trace, SQL, path or library version — including on unusual paths like malformed JSON and oversized bodies.
6. Verify security headers and CORS on all three surfaces.
7. Test the `?to=` personalization parameter as an XSS vector specifically; it is attacker-controlled text in a URL people forward to each other.

**Definition of Done**
- [ ] No payload executes when rendered on the public page in a real browser.
- [ ] Injection fuzzing produces no anomaly.
- [ ] Every forbidden field is ignored on every write endpoint.
- [ ] No error response leaks internal detail.

---

## P6-05 — Authentication and Session Abuse Suite

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-03, P5-02 |
| **Spec refs** | `docs/SECURITY/03-AUTHENTICATION-SECURITY.md`, `docs/SECURITY/11`, `docs/SECURITY/10` |
| **Spec required** | Yes — release blocker |
| **Surface** | backend |

**Goal** — Credential and session attacks fail, and the controls that stop them are observable.

**Steps**
1. Brute-force login and confirm rate limiting and lockout per `docs/SECURITY/10`.
2. Confirm no user enumeration through login, registration, password reset, or response timing.
3. Test expired and tampered access tokens, a token with a modified `role` claim, and a token signed with the wrong key.
4. Test refresh token reuse and confirm the whole family is revoked and a security event is logged.
5. Confirm a password reset invalidates existing sessions.
6. Confirm a suspended user's active session stops working promptly.
7. Confirm admin 2FA cannot be bypassed and step-up is required for refunds and suspensions.
8. Test the OAuth path with a token of wrong audience, wrong issuer, or expired.

**Definition of Done**
- [ ] Every scenario above has an automated test and passes.
- [ ] Security events appear in the separately retained log stream.
- [ ] No enumeration is possible through body or timing on any auth endpoint.

---

## P6-06 — SAST, DAST and Dependency Policy

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-17 |
| **Spec refs** | `docs/SECURITY/11-SECURITY-TESTING.md` § Test Types, `docs/SECURITY/08` § Dependency Security, `docs/DEVOPS/01` |
| **Spec required** | No |
| **Surface** | infra |

**Goal** — The automated cadence in `docs/SECURITY/11` running for real: SAST per PR, dependency scanning per PR and weekly, DAST on every staging deploy.

**Steps**
1. Tune SAST rules to the stack and triage the existing findings to zero-or-documented; a scanner nobody reads is worse than none because it looks like coverage.
2. Add the weekly dependency scan in addition to the per-PR one, so a CVE published after a merge is still caught.
3. Wire DAST against staging on each deploy, with authenticated scanning so it reaches past the login page.
4. Define the severity policy: what blocks a merge, what blocks a release, what is accepted with a documented plan and an owner.
5. Route findings somewhere with a review cadence, not into a build log nobody opens.

**Definition of Done**
- [ ] SAST, dependency scanning and DAST all run on their documented cadence.
- [ ] The current finding count is zero or each item has a documented owner and plan.
- [ ] DAST scans authenticated routes, not only the public surface.
- [ ] The severity policy is written and applied.

---

## P6-07 — External Penetration Test and Remediation

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P6-01…P6-06 |
| **Spec refs** | `docs/SECURITY/11` § Manual Penetration Testing, `docs/PLAN/17` § Sign-off, `docs/SECURITY/05` § Periodic Testing |
| **Spec required** | Yes — release blocker |
| **Surface** | all |

**Goal** — Independent validation, with multi-tenancy as its own scoped category rather than a line item inside a general test.

**Steps**
1. Scope the engagement around the four priorities in `docs/SECURITY/01` § Mitigation Priority: object-level authorization, payment webhook verification, file upload, public endpoint rate limiting.
2. Require multi-tenancy to be reported as a separate category, per `docs/SECURITY/05` § Periodic Testing.
3. Provide the tester with two seeded accounts, the API documentation, and the IDOR matrix from `P6-01` — an informed tester finds more than a blind one, and the goal is finding problems, not scoring well.
4. Remediate critical and high findings, then retest specifically for each.
5. Document medium and low findings with a remediation plan and an accepted-risk sign-off from the Product Owner and the security reviewer (`docs/SECURITY/11` § Pass Criteria).
6. File the report as part of the release record.

**Definition of Done**
- [ ] Zero critical or high findings remain in the multi-tenancy and payment categories.
- [ ] Every remediation has a retest confirming the fix.
- [ ] Accepted medium and low findings are documented with owners and timelines.
- [ ] The report is stored with the release record.

---

## P6-08 — Load and Performance Testing

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P3-12 |
| **Spec refs** | `docs/TESTING/05-PERFORMANCE-TESTING.md`, `docs/PLAN/17` § Performance, `docs/PLAN/18` R3 |
| **Spec required** | No |
| **Surface** | infra, backend |

**Goal** — Run all four scenarios in `docs/TESTING/05` and meet their targets, mitigating R3 — the invitation going down on the day it matters.

**Steps**
1. Scenario 1 — public invitation spike: ramp 10 → 1000 concurrent users over two minutes, all on the **same** invitation. Targets: p95 under 1s, error rate under 0.1%, cache hit ratio above 90% after warm-up. This is the realistic shape: one link forwarded to a large WhatsApp group at once.
2. Scenario 2 — sustained API load: 200 requests per second for ten minutes across authenticated CRUD. Target: p95 under 500ms, no 5xx from resource exhaustion.
3. Scenario 3 — concurrent media upload: 50 simultaneous 5MB uploads. Target: all reach `ready`, no stuck jobs.
4. Scenario 4 — webhook burst: a provider retry storm. Target: idempotency holds, no double processing, no race on status updates.
5. Run each both warm and cold, so the worst case is known rather than assumed (`docs/TESTING/05` § Test Conditions).
6. When a target is missed, profile before changing anything: slow query log, cache miss pattern, container CPU throttling.
7. Record the numbers with their conditions — a measurement without its conditions is not a measurement.

**Definition of Done**
- [ ] All four scenarios run against production-like staging with results recorded.
- [ ] Targets met, or a documented remediation plan exists with the accepted risk named.
- [ ] Cold-start behaviour is measured, not assumed.
- [ ] The webhook burst produces exactly one state change per payment.

---

## P6-09 — Cache Tuning and Hit-Ratio Validation

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P6-08 |
| **Spec refs** | `docs/ARCHITECTURE/06-CACHING-ARCHITECTURE.md`, `docs/DEVOPS/05` § Cache Hit Ratio |
| **Spec required** | No |
| **Surface** | backend, infra |

**Goal** — The cache behaves as `docs/ARCHITECTURE/06` intends under real load, not only in a unit test.

**Steps**
1. Measure the hit ratio under scenario 1 and confirm it exceeds 90% after warm-up.
2. Verify stampede protection: on cold expiry under load, exactly one origin render.
3. Verify invalidation latency end to end: an owner's edit reaches guests within an acceptable window.
4. Tune TTLs against measured behaviour rather than intuition.
5. Confirm cache keys include the template version, so a version change cannot serve stale HTML.
6. Verify media cache headers are long and immutable, and that replacing a photo produces a new URL rather than needing a purge.
7. Verify the personalization parameter has not crept into any cache key.

**Definition of Done**
- [ ] Hit ratio above 90% under the spike scenario.
- [ ] One origin render under a cold-cache stampede, measured.
- [ ] Invalidation latency measured and documented.
- [ ] No per-guest cache entries exist.

---

## P6-10 — Monitoring Dashboards and Alert Rules

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-12, P3-05 |
| **Spec refs** | `docs/DEVOPS/05-MONITORING.md`, `docs/DEVOPS/07-ALERTING.md`, `docs/ARCHITECTURE/09` |
| **Spec required** | No |
| **Surface** | infra |

**Goal** — Every metric in `docs/DEVOPS/05` on a dashboard, every alert in `docs/DEVOPS/07` configured, and each one tested by causing the condition.

**Steps**
1. Build the operational dashboard with the metric table from `docs/DEVOPS/05`: API rates and latency, cache hit ratio, database pool and query latency, Redis memory and evictions, queue depth and DLQ size, storage growth, webhook success and signature failure rates.
2. Build the business dashboard from `docs/PLAN/14` and `docs/PLAN/12`.
3. Configure every alert in `docs/DEVOPS/07` with its severity and channel.
4. **Test each alert by causing its condition.** An alert rule that has never fired is a hypothesis. Backup failure, DLQ growth and invalid-signature spikes are the three worth deliberately triggering, because they are the ones that matter most when nobody is watching.
5. Configure synthetic uptime checks from outside the infrastructure on the landing page, a sample invitation, and the API health endpoint.
6. Define the escalation path from `docs/DEVOPS/07`, including the unacknowledged-critical case.
7. Wire distributed tracing so an upload can be followed from request to worker completion.

**Definition of Done**
- [ ] Every metric in `docs/DEVOPS/05` appears on a dashboard.
- [ ] Every alert in `docs/DEVOPS/07` exists and has fired at least once in a test.
- [ ] Synthetic checks run from outside and page on repeated failure.
- [ ] The escalation path is documented with real contacts.

---

## P6-11 — Logging, Redaction and Retention Audit

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-12 |
| **Spec refs** | `docs/DEVOPS/06-LOGGING.md`, `docs/SECURITY/09-PRIVACY-DATA-PROTECTION.md`, `docs/PLAN/18` R6 |
| **Spec required** | Yes — privacy |
| **Surface** | backend, infra |

**Goal** — Confirm by inspection that R6 — sensitive data leaking through logs — is actually mitigated in the running system.

**Steps**
1. Exercise every major flow on staging, then grep the aggregated logs for: password fields, tokens, full bank account numbers, raw payment payloads, signature secrets, and raw IP addresses.
2. Include error paths — an exception handler dumping a request body is the classic way redaction is bypassed.
3. Verify the three retention tiers from `docs/DEVOPS/06`: application logs 90 days, security events 1 year, `audit_logs` 2 years.
4. Verify request correlation works end to end, request through worker.
5. Verify error tracking payloads carry no sensitive fields (`docs/FRONTEND/08` § Logging).
6. Verify log access is restricted, since logs contain personal data even after redaction.

**Definition of Done**
- [ ] The grep over a full exercise of the system finds no sensitive value.
- [ ] Error paths are included in that check.
- [ ] Retention is configured per tier and verified.
- [ ] Error tracking payloads are clean.

---

## P6-12 — Backup Verification and DR Drill

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-23 |
| **Spec refs** | `docs/DEVOPS/04-DATABASE-BACKUP.md`, `docs/ARCHITECTURE/09-DISASTER-RECOVERY.md`, `docs/PLAN/17` § Availability |
| **Spec required** | Yes — release blocker |
| **Surface** | infra |

**Goal** — Perform an actual restore. `docs/PLAN/17` requires a successful restore before launch, and `docs/DEVOPS/04` says a backup whose restore has never been tested is a hidden risk.

**Steps**
1. Configure daily full backups with 30-day retention, plus continuous WAL archiving for point-in-time recovery.
2. Store backups in a separate region or account (`docs/ARCHITECTURE/09` § Backup).
3. Encrypt backups at rest — they contain everything sensitive the database holds.
4. Enable object storage bucket versioning for `user-media`, protecting against a mass-delete bug (`docs/DEVOPS/04`).
5. Run the restore runbook from `docs/ARCHITECTURE/09` end to end into a fresh instance, and measure how long it takes against the 4-hour RTO.
6. Validate the restored data: row counts on key tables, referential integrity, a spot check that an invitation renders.
7. Test point-in-time recovery to a chosen moment, not only the latest snapshot.
8. Configure the weekly automated restore verification from `docs/DEVOPS/04`.
9. Alert on backup job failure, and confirm the alert fires by breaking the job deliberately.

**Definition of Done**
- [ ] A restore has actually been performed, with the elapsed time recorded against RTO.
- [ ] Point-in-time recovery is demonstrated.
- [ ] Weekly automated verification runs.
- [ ] Backup failure alerting is proven by a deliberate failure.
- [ ] The drill result is written up in `MEMORY/records/`.

---

## P6-13 — Rollback Drill and Feature Flags

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-17 |
| **Spec refs** | `docs/DEVOPS/08-ROLLBACK.md`, `docs/ARCHITECTURE/08` § Zero-downtime, `docs/SECURITY/12` § Containment |
| **Spec required** | No |
| **Surface** | infra |

**Goal** — A rollback that has been performed rather than documented, and kill-switches for the containment steps `docs/SECURITY/12` assumes exist.

**Steps**
1. Verify artifact versioning allows deploying any previous build.
2. Perform a real rollback on staging and time it against the five-minute target.
3. Verify the expand-contract discipline: confirm the last few migrations would not have broken a rolled-back application version.
4. Implement feature flags for risky surfaces, and specifically the kill-switches `docs/SECURITY/12` § Containment relies on: disable an endpoint, pause webhook processing, disable public submissions. Incident response that requires a deploy is slower than incident response that requires a toggle.
5. Verify a rollback preserves in-flight data — no order or payment lost.
6. Document who may trigger a rollback and how, without needing the person who wrote the deploy pipeline.

**Definition of Done**
- [ ] A rollback has been performed and timed under five minutes.
- [ ] Kill-switches exist for the three containment actions and have been exercised.
- [ ] Recent migrations are confirmed backward compatible.
- [ ] The runbook is executable by someone who did not build the pipeline.

---

## P6-14 — Cross-Browser and Device Matrix

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | Phases 2-4 |
| **Spec refs** | `docs/TESTING/06-CROSS-BROWSER.md`, `docs/UI-UX/15-RESPONSIVE-DESIGN.md` |
| **Spec required** | No |
| **Surface** | web-app, public-invite |

**Goal** — The full matrix in `docs/TESTING/06`, with priority on the public invitation, which is opened by the widest range of devices in the product.

**Steps**
1. Test the matrix: Chrome, Safari, Firefox, Edge on desktop; Chrome on Android and Safari on iOS; a mid-range Android at 360×800 and an iPhone at 390×844 on simulated 4G.
2. Prioritize the public page: layout, photo loading, countdown accuracy, RSVP submission, maps and WhatsApp deep links.
3. Test the editor on desktop browsers and on tablet.
4. Test checkout in the in-app browsers of WhatsApp and Instagram — `docs/TESTING/06` singles these out because they block popups and redirects and are how a large share of Indonesian users open any link.
5. Test iOS Safari audio autoplay behaviour and confirm the manual unmute fallback works.
6. Verify native date and time pickers behave acceptably in the editor across browsers.
7. Automate a smoke subset (Chrome plus mobile Safari) into the staging pipeline.

**Definition of Done**
- [ ] The full matrix is executed with results recorded per row.
- [ ] Checkout completes in WhatsApp's in-app browser, or offers a working escape.
- [ ] Background music behaves acceptably on iOS Safari.
- [ ] The automated smoke subset runs on every staging deploy.

---

## P6-15 — Accessibility Audit

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | Phases 2-5 |
| **Spec refs** | `docs/UI-UX/17-ACCESSIBILITY.md`, `docs/UI-UX/18` § Accessibility, `docs/PLAN/17` § Accessibility |
| **Spec required** | No |
| **Surface** | all frontend |

**Goal** — WCAG 2.1 AA on the application, and a genuinely usable public page for the least technical guest.

**Steps**
1. Run automated axe audits on the editor, checkout, public invitation and RSVP form; `docs/UI-UX/18` requires no critical errors on these four.
2. Complete the checkout flow keyboard-only, end to end, as `docs/UI-UX/18` requires explicitly.
3. Test the public page and RSVP form with a real screen reader, per `docs/UI-UX/17` § Testing.
4. Verify contrast across the app and in the reference template, including text over photographic backgrounds.
5. Verify the keyboard alternative for gallery drag-reordering.
6. Verify the editor preview skip-link works and the tab order is sane.
7. Verify `prefers-reduced-motion` is honoured on the public page's animations.
8. Verify form errors are announced, not merely coloured.

**Definition of Done**
- [ ] Zero critical axe errors on the four named surfaces.
- [ ] Keyboard-only checkout succeeds.
- [ ] A screen reader pass on the public page and RSVP form is completed and its findings addressed.
- [ ] Reduced-motion and contrast requirements are met.

---

## P6-16 — Privacy, Legal Pages and Incident Readiness

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | — |
| **Spec refs** | `docs/SECURITY/09-PRIVACY-DATA-PROTECTION.md`, `docs/SECURITY/12-INCIDENT-RESPONSE.md`, `docs/PLAN/14` § Privacy |
| **Spec required** | No |
| **Surface** | docs, web-app |

**Goal** — The public-facing privacy commitments exist, and the incident process has been rehearsed before it is needed.

**Steps**
1. Write the privacy policy covering what `docs/SECURITY/09` § Personal Data Managed actually describes: the couple's data, guest RSVP and guestbook data, hashed IPs, retention periods, third-party sharing with the payment provider, and the data subject rights the product implements.
2. Write terms of service covering the service period, refunds, acceptable content and account suspension.
3. Publish the guest-facing note that RSVP and guestbook submissions are visible to the invitation owner — guests provide data consciously, and saying so is part of that (`docs/PLAN/14` § Privacy).
4. Document the manual process for a guest's deletion request, which `docs/SECURITY/09` acknowledges is manual at MVP since guests have no accounts.
5. Run the tabletop exercise from `docs/SECURITY/12` § Drills using the "external researcher reports an IDOR" scenario, and record what the rehearsal exposed. The point is finding out that nobody knows who to call before that is true during a real incident.
6. Fill in the on-call contact list and escalation path referenced by `docs/SECURITY/12`.
7. Verify the PDP-law breach notification obligation is understood and the process reflects it.

**Definition of Done**
- [ ] Privacy policy and terms are published and linked from the app and the public invitation footer.
- [ ] The guest deletion request process is documented and reachable.
- [ ] The tabletop exercise has been run and its findings recorded.
- [ ] The on-call list and escalation path exist with real names.

---

## P6-17 — UAT and Release Gate Sign-Off

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | all Phase 6 tasks |
| **Spec refs** | `docs/TESTING/07-ACCEPTANCE-TESTING.md`, `docs/PLAN/17-ACCEPTANCE-CRITERIA.md`, `docs/UI-UX/18-UX-ACCEPTANCE-CRITERIA.md` |
| **Spec required** | Yes — release gate |
| **Surface** | all |

**Goal** — Every criterion in both acceptance documents ticked with named evidence, and the three sign-offs recorded.

**Steps**
1. Run UAT per `docs/TESTING/07`: deploy the release candidate to staging with representative data, distribute the scenario checklist to the Product Owner and at least one non-technical participant, collect findings over two to three days, triage into blockers and backlog.
2. Run the persona scenarios from `docs/TESTING/07`: a couple building an invitation unaided, an organizer managing three, a genuinely non-technical person opening the link and RSVPing, an admin moderating and refunding.
3. Verify the usability criteria in `docs/UI-UX/18` with the five-participant test: over 80% task completion without confusion, and the autosave confidence question answered positively.
4. Walk `docs/PLAN/17` item by item, attaching evidence to each: a test name, a measurement, a report, or a recorded walkthrough. Not an assertion that it works.
5. Verify the headline product metric is achievable: time-to-publish under 30 minutes (`docs/PLAN/00`), measured with a real participant rather than an expert user.
6. Resolve blockers, retest, and record the three sign-offs from `docs/PLAN/17`: Product Owner, Engineering Lead, Security reviewer — plus the Product Designer sign-off from `docs/UI-UX/18`.
7. Write the launch readiness record and the Phase 6 summary.

**Definition of Done**
- [ ] Every `docs/PLAN/17` and `docs/UI-UX/18` criterion is ticked with evidence named.
- [ ] UAT findings are triaged and blockers resolved.
- [ ] Time-to-publish under 30 minutes is measured with a real participant.
- [ ] All four sign-offs are recorded with dates.
- [ ] The launch readiness record exists in `MEMORY/records/`.
