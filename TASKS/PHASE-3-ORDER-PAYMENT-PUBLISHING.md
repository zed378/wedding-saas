# Phase 3 — Order, Payment and Publishing

**Goal**: a user can pay for an invitation and publish it to a live subdomain — with payment status decided exclusively by the server, prices calculated exclusively from the database, and the public page served from cache fast enough to survive the wedding day.

**The rule this phase exists to honour**: `docs/SECURITY/07-PAYMENT-SECURITY.md`'s golden rule — `payment_success` must never be equated with a user request parameter. Status changes only from a signature-verified webhook or a server-initiated provider query. Every task here is written so that the shortcut is not available, not merely discouraged.

**Gate before deploying to production**: `docs/PLAN/16` § Critical Dependencies requires `docs/SECURITY/07` to be reviewed before the payment API reaches production. That review is `P3-16`, and it is a hard gate, not a formality.

**Exit criteria**: checkout through webhook to `paid` works end to end against the provider's sandbox, including the failure, expiry, replay and forged-signature paths; publishing produces a live page at `invitation.vizunicum.my.id/{slug}` within five seconds; an owner's content edit invalidates the cache; the daily expiry job transitions invitations correctly.

**Roadmap reference**: `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` § Phase 3 (Week 8-9).

---

## Task Summary

| ID | Task | Surface | Size | Depends on |
|---|---|---|---|---|
| P3-01 | Package and addon master data, pricing service | backend | M | P0-10 |
| P3-02 | Order creation | backend | L | P3-01, P1-06 |
| P3-03 | Payment gateway port and provider adapter | backend | L | P3-02, P0-18 |
| P3-04 | Payment initiation endpoint | backend | M | P3-03 |
| P3-05 | Payment webhook: signature, idempotency, transaction | backend | L | P3-04, P0-14 |
| P3-06 | Payment status polling and provider reconciliation | backend | M | P3-05 |
| P3-07 | Order expiry job and the late-payment case | worker | M | P3-05, P0-15 |
| P3-08 | Invoice generation and order history | backend | M | P3-05 |
| P3-09 | Publish endpoint | backend | L | P2-06, P3-05 |
| P3-10 | Unpublish, republish, slug change after publish | backend | M | P3-09 |
| P3-11 | Production subdomain routing and TLS | infra | M | P3-09, P0-23 |
| P3-12 | Public page caching and invalidation | backend, infra | L | P3-09, P2-08 |
| P3-13 | Invitation expiry job and renewal | worker, backend | L | P3-09, P3-07 |
| P3-14 | Frontend — checkout and payment status | web-app | L | P3-04, P0-22 |
| P3-15 | Frontend — publish flow and share screen | web-app | M | P3-09, P2-06 |
| P3-16 | Payment security review and Phase 3 acceptance | all | L | all above |

---

## P3-01 — Package and Addon Master Data, Pricing Service

| | |
|---|---|
| **Status** | TODO — pricing decided (ADR-023); addon availability decided (ADR-022) |
| **Depends on** | P0-10 |
| **Spec refs** | `docs/DATABASE/07-ORDERS.md`, `docs/PLAN/09-ORDER-PAYMENT.md` § Packages, `docs/SECURITY/07` § Pricing, `docs/PLAN/11` § Limits per Package |
| **Spec required** | Yes — payment |
| **Surface** | backend |

**Goal** — One pricing service that computes an order total from database rows, and one place that answers "what does this package allow".

**Steps**
1. Seed `packages` with the one active row from `docs/PLAN/09` § Package (MVP): `standard`, Rp 139,000, `duration_months = 12`, `max_photos = 200`, `has_watermark = false`. Seed `addons` with `custom_domain` and `extended_validity` both **inactive** — no addon is active at MVP (ADR-022, ADR-023).
2. Implement `PricingService.calculate(packageId, addonIds)` reading prices from the database at request time. `docs/SECURITY/07` § Pricing makes this non-negotiable: the client never sends an amount, and no price constant exists in code.
3. Reject an inactive package or addon.
4. Expose the package entitlements the rest of the system already needs: photo quota (`P1-17`), watermark flag (`P3-09`), validity months (`P3-09`), custom domain permission (Phase 7). Keep them as lookups even though there is one package — a second tier must be a seed row, never a code change.
5. Seed `custom_domain` with `is_active = false` and enforce that an inactive addon cannot be ordered. ADR-022 settled this: `docs/PLAN/09` § Add-on Availability at MVP now states it, and the addon is activated by `P7-01` when the feature actually ships.
6. Unit test every package-plus-addon combination against expected totals, and test that a price supplied in the request body is ignored entirely.

**Definition of Done**
- [ ] No price literal exists anywhere in application code.
- [ ] A client-supplied amount has no effect, proven by an explicit test.
- [ ] Inactive packages and addons cannot be ordered.
- [ ] Entitlement lookups (quota, watermark, duration) go through this one service.
- [ ] A renewal order prices at the same Rp 139,000 for another 12 months.
- [ ] Nothing in the codebase assumes exactly one package exists — adding a second tier is seed data plus checkout UI.

---

## P3-02 — Order Creation

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P3-01, P1-06 |
| **Spec refs** | `docs/API/06-ORDER-API.md`, `docs/DATABASE/07-ORDERS.md` § Notes, `docs/PLAN/02` § BR-5, `docs/PLAN/06-INVITATION-LIFECYCLE.md` |
| **Spec required** | Yes — payment |
| **Surface** | backend |

**Goal** — `POST /invitations/:id/orders` creates a pending order with a server-computed total, one active order at a time.

**Steps**
1. Implement the endpoint per `docs/API/06`, accepting only `package_id` and `addon_ids`.
2. Verify ownership through the `P0-11` layer, and require `email_verified` per `docs/API/01` — checkout is one of the two gated actions.
3. Enforce one active pending order per invitation, returning 409 `ACTIVE_ORDER_EXISTS` and pointing the user at the existing order. `docs/DATABASE/07` § Notes places this at the service layer since there is no database constraint for it; implement it as a conditional insert or under a lock so two parallel requests cannot both succeed.
4. Snapshot `amount_total` at creation so later price changes never rewrite order history (`docs/DATABASE/07` § Notes).
5. Set `expired_at = now + 24h` per `docs/PLAN/09`.
6. Set `order_type` — `new_publish` or `renewal` — and validate the invitation's status suits it: a `draft` can be newly published; an `expired` or `published` invitation is renewed.
7. Transition the invitation to `pending_payment` per BR-2.2, through the status history service, **inside the order-creation transaction** — ADR-022 assigned this transition to the order service and `docs/API/06` now states it. Renewal orders perform no transition: the invitation stays `published` or `expired` until the renewal is paid.
8. Support the optional `Idempotency-Key` header from `docs/API/00`, so a double-clicked checkout does not create two orders.

**Definition of Done**
- [ ] `amount_total` always comes from `PricingService`, never from the request.
- [ ] Two concurrent order creations for one invitation produce one order and one 409.
- [ ] An unverified user is refused with 403 `EMAIL_NOT_VERIFIED`.
- [ ] The invitation moves to `pending_payment` with a history row.
- [ ] A repeated request with the same idempotency key returns the same order.

**Abuse cases to test**
| Abuse case | Source | Expectation |
|---|---|---|
| `amount_total` in the request body | `docs/SECURITY/07` § Pricing | Ignored, server value used |
| Order against another user's invitation | `docs/SECURITY/05` | 404 |
| Parallel double checkout | `docs/DATABASE/07` § Notes | One order, one 409 |

---

## P3-03 — Payment Gateway Port and Provider Adapter

| | |
|---|---|
| **Status** | TODO — provider decided (ADR-012: Midtrans); commercial terms still to be confirmed |
| **Depends on** | P3-02, P0-18 |
| **Spec refs** | `docs/BACKEND/01-DOMAIN-MODULES.md` § order & payment, `docs/BACKEND/05-PAYMENT-FLOW.md`, `docs/PLAN/18` R9 |
| **Spec required** | Yes — payment |
| **Surface** | backend |

**Goal** — A `PaymentGatewayPort` with one concrete adapter, so R9 (vendor lock-in) stays mitigated and the flow is testable without the provider.

**Steps**
1. Define the port: `createTransaction`, `verifySignature`, `queryStatus`, and a normalization function mapping provider statuses onto the internal `pending | success | failed`.
2. Implement the **Midtrans** adapter (ADR-012), following its official signature documentation precisely. `docs/SECURITY/07` gives the SHA-512 over `order_id + status_code + gross_amount + server_key` as an illustration; the real algorithm comes from the provider's current documentation, not from memory or from this sentence.
3. Keep the `payment` module ignorant of the invitation domain, per `docs/BACKEND/01`: it talks to `order` only, and `order` emits `order.paid`. This decoupling is what makes a provider swap a module-local change.
4. Store credentials per `P0-18`, with sandbox in staging and live only in production.
5. Build a fake adapter for tests that can produce valid signatures, invalid signatures, duplicates and out-of-order callbacks — the abuse suites in `P3-05` depend on it.
6. Log provider interactions with redaction, and record `raw_callback_payload` only in the database, never in application logs (`docs/DEVOPS/06`).

**Definition of Done**
- [ ] Nothing outside the adapter knows the provider's name or payload shape.
- [ ] Signature verification is implemented from the provider's official documentation and unit tested against known vectors.
- [ ] The fake adapter can produce every abuse-case payload the next task needs.
- [ ] The `payment` module contains no reference to invitations.

---

## P3-04 — Payment Initiation Endpoint

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P3-03 |
| **Spec refs** | `docs/API/07-PAYMENT-API.md` § Initiation Flow, `docs/BACKEND/05-PAYMENT-FLOW.md` § Payment Initiation |
| **Spec required** | Yes — payment |
| **Surface** | backend |

**Goal** — `POST /orders/:order_id/payment` returns what the client needs to reach the provider, and carries no notion of success.

**Steps**
1. Load the order through the ownership-scoped path; guard that it is `pending` and not past `expired_at`.
2. Call the provider with the amount **from the order row**, never from the request (`docs/BACKEND/05`).
3. Send the minimum customer detail the provider requires — name and email — per `docs/SECURITY/09` § Third-Party Data Sharing.
4. Persist the `payments` row with `status = 'pending'` and the returned `provider_reference_id` before responding, so a webhook arriving moments later finds a row to match.
5. Return only the redirect URL or widget token. `docs/API/07` is explicit that no success status exists in this response.
6. Handle provider failure with a friendly retryable error and no state change (`docs/UI-UX/13` § Error Handling UX).

**Definition of Done**
- [ ] The amount sent to the provider comes from the database row.
- [ ] A payments row exists before the response is returned.
- [ ] The response contains no status field that a client could misread as confirmation.
- [ ] A provider outage leaves order and invitation status untouched.

---

## P3-05 — Payment Webhook: Signature, Idempotency, Transaction

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P3-04, P0-14 |
| **Spec refs** | `docs/API/07-PAYMENT-API.md` § Webhook Flow, `docs/BACKEND/05-PAYMENT-FLOW.md` § Webhook Handler, `docs/SECURITY/07-PAYMENT-SECURITY.md`, `docs/DATABASE/08-PAYMENTS.md` |
| **Spec required** | Yes — payment, the most security-critical task in the project |
| **Surface** | backend |

**Goal** — The only code path in the system that can mark an invitation paid, and it does so only for a signature-verified callback, exactly once.

**Steps**
1. Implement `POST /api/webhooks/payment/:provider` outside the user authentication middleware, with the raw body preserved — signature verification needs the exact bytes, and a body parser that re-serializes them will break it in a way that is easy to misdiagnose.
2. Verify the signature **before parsing or acting on anything**. An invalid signature: record the attempt with `signature_valid = false`, respond 401, log a security event, change no state (`docs/BACKEND/05` step 2).
3. Look up the payment by `(provider, provider_reference_id)`. If none matches, log the anomaly and respond 200 so the provider stops retrying an unrecognizable case, then investigate manually (`docs/BACKEND/05` step 3).
4. Check idempotency: if the payment is already `success`, respond 200 with no further effect (`docs/BACKEND/05` step 4). The unique index from `P0-10` is the backstop.
5. On a verified success, in **one transaction**: set payment `success` with `verified_at`, set order `paid`, set invitation `paid`, and write the status history row with `changed_by = null` and a reason naming the webhook (`docs/API/07` step 4).
6. Emit `order.paid` **after** the commit, so the invoice email cannot describe a transaction that rolled back.
7. Respond 200 within five seconds; all heavy work is queued (`docs/API/07` step 5).
8. Handle a status other than success by recording it without granting entitlement.
9. Store `raw_callback_payload` in the database for audit, redacted in logs (`docs/DATABASE/08` § Critical Notes).
10. Add the metric `docs/DEVOPS/07` alerts on: invalid signature rate, which is the fraud-attempt indicator.

**Definition of Done**
- [ ] A payload with an invalid or absent signature changes nothing and returns 401, recorded with `signature_valid = false`.
- [ ] The same webhook delivered five times produces exactly one state change and one `order.paid` event.
- [ ] A simulated failure mid-transaction rolls back all three tables together — no order paid with an unpaid invitation.
- [ ] The handler responds under five seconds with email and other side effects queued.
- [ ] Invalid-signature attempts increment a metric with an alert rule attached.

**Abuse cases to test**
| Abuse case | Source | Expectation |
|---|---|---|
| Forged success payload, no signature | `docs/SECURITY/07` | 401, no state change |
| Forged payload with a wrong signature | `docs/SECURITY/07` | 401, recorded, no state change |
| Replayed valid webhook | `docs/SECURITY/07` § Idempotency | One effect only |
| Webhook for an unknown reference | `docs/BACKEND/05` step 3 | 200, logged, no state change |
| Amount in the payload differs from the order | `docs/SECURITY/07` | Mismatch flagged, entitlement not granted |
| Webhook arriving after order expiry | `docs/SECURITY/07` § Timeout & Expiry | Processed as valid, flagged for review |

---

## P3-06 — Payment Status Polling and Provider Reconciliation

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P3-05 |
| **Spec refs** | `docs/API/07-PAYMENT-API.md` § Status Polling, `docs/BACKEND/05` § Status Polling, `docs/SECURITY/07` |
| **Spec required** | Yes — payment |
| **Surface** | backend, worker |

**Goal** — The client can ask what the server currently believes, and the server can ask the provider — but neither can be told what to believe.

**Steps**
1. Implement `GET /orders/:order_id/payment/status` returning the current database state, ownership-scoped.
2. Make it safe to poll: cheap, cacheable for a second or two, rate limited generously enough for the returning-from-gateway flow in `docs/UI-UX/13`.
3. Add the server-initiated fallback from `docs/BACKEND/05`: when an order has been pending beyond a threshold, query the provider server-to-server. Route that result through the **same** verification and state transition path as the webhook — a provider query is a second source, not a second rulebook.
4. Add the optional daily reconciliation job from `docs/BACKEND/05`: compare provider transactions against local records and flag mismatches for manual review. This is the control that catches a webhook the system never received.
5. Never accept a status from a query parameter. The endpoint is display-only by construction.

**Definition of Done**
- [ ] The status endpoint reads state and never writes it directly.
- [ ] The provider-query fallback shares one code path with the webhook for state transitions.
- [ ] The reconciliation job flags an injected mismatch in a test.
- [ ] Polling for another user's order returns 404.

---

## P3-07 — Order Expiry Job and the Late-Payment Case

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P3-05, P0-15 |
| **Spec refs** | `docs/BACKEND/08-JOBS-WORKERS.md`, `docs/PLAN/09` § Order Expiry, `docs/SECURITY/07` § Timeout & Expiry, `docs/PLAN/02` § BR-5.3 |
| **Spec required** | Yes — payment |
| **Surface** | worker |

**Goal** — Pending orders expire on schedule, the invitation returns to `draft`, and a payment that arrives late is still honoured rather than silently lost.

**Steps**
1. Implement `order_expire_check` every 15 minutes per `docs/BACKEND/08`: set `expired` where `pending` and `expired_at` has passed.
2. Return the invitation from `pending_payment` to `draft` per BR-5.3, with a status history row, so the user can start a new order.
3. Make the job idempotent and safe to re-run.
4. Handle the late-payment edge case from `docs/SECURITY/07`: a success webhook for an expired order is still processed as a valid payment, flagged for manual review. Losing a customer's money because a scheduler ran first is worse than a flagged row someone checks.
5. Emit a metric for expired orders, since a rising rate is a checkout-funnel signal, not just an operational one.

**Definition of Done**
- [ ] Expiry moves both order and invitation status, with history rows.
- [ ] A late success webhook still grants entitlement and raises a review flag.
- [ ] The job is idempotent under repeated runs.
- [ ] A user can create a new order immediately after expiry.

---

## P3-08 — Invoice Generation and Order History

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P3-05 |
| **Spec refs** | `docs/API/06-ORDER-API.md`, `docs/PLAN/09` § Invoice, `docs/PLAN/04` § F12 |
| **Spec required** | No |
| **Surface** | backend |

**Goal** — Order history and a downloadable invoice generated after payment succeeds.

**Steps**
1. Implement `GET /orders` and `GET /orders/:order_id`, ownership-scoped, with the current status rather than the status at creation (`docs/API/06` § Critical Rules).
2. Generate the invoice PDF on `order.paid`, in the worker rather than in the request.
3. Include what an invoice needs: order id, date, package and addons, total, buyer name and email, and the seller identity. Exclude anything unnecessary — an invoice is a document that gets forwarded.
4. Implement `GET /orders/:order_id/invoice` serving the PDF only for a paid order and only to its owner.
5. Attach or link the invoice from the payment confirmation email (`P4-07`).

**Definition of Done**
- [ ] Invoices generate only for paid orders.
- [ ] Another user's invoice returns 404.
- [ ] The list always reflects current status, including orders expired by the job.
- [ ] Invoice generation failure does not affect payment state.

---

## P3-09 — Publish Endpoint

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P2-06, P3-05 |
| **Spec refs** | `docs/BACKEND/02-SERVICE-LAYER.md` § publish example, `docs/PLAN/10-DOMAIN-PUBLISHING.md` § Publish Flow, `docs/BACKEND/06-PUBLISHING.md`, `docs/PLAN/02` § BR-2, BR-4.2, BR-6 |
| **Spec required** | Yes — business rule |
| **Surface** | backend |

**Goal** — `POST /invitations/:id/publish` performs every check in order and makes the invitation live.

**Steps**
1. Implement the sequence in `docs/BACKEND/02`'s worked example, which is the reference implementation for this endpoint: ownership-scoped load → **payment OR trial eligibility** → required-field validation against the active template → slug availability → transactional status update with history.
1a. **BR-2.8 / ADR-052 — the free trial publish.** An unpaid invitation may be published **once**, with `expiry_date = today + 3 days`. Eligibility is "this invitation has never reached `paid` **and** has never been published before" — the second half is what makes it once rather than an endless three-day cycle, and `invitation_status_history` answers both without a new column. A paid invitation takes the ordinary path and gets its package's duration.
2. Require `email_verified` (`docs/API/01`).
3. Return 422 with `details[]` listing missing field paths when validation fails (BR-4.2), reusing `P2-06`'s resolver so the checklist and the gate can never disagree.
4. Validate the slug again at publish time — format, blocklist, uniqueness — and catch a unique-violation race as 409 `SLUG_TAKEN` (`docs/BACKEND/06`).
5. Set `published_at = now()` and `expiry_date` — from `P3-01`'s entitlements for a paid invitation, or `today + 3 days` for a trial (BR-2.8).
6. Determine watermark display from the paid package and return it as `display.watermark` in the public payload (`docs/API/08`, added by ADR-021). It is derived server-side from `packages.has_watermark` and never influenced by a client hint. What the watermark actually looks like is still open as `OQ-13`.
7. After commit, warm the cache and emit `invitation.published` (`docs/BACKEND/06`).
8. Meet the acceptance criterion from `docs/PLAN/17`: the public page is reachable within five seconds of publishing.

**Definition of Done**
- [ ] Publishing an unpaid invitation that has **already used its trial** is refused with a business-rule error naming the upgrade path (BR-2.8).
- [ ] A first publish of an unpaid invitation succeeds with `expiry_date = today + 3 days`, and a test proves the second attempt after that trial lapses is refused.
- [ ] Missing required fields produce 422 with the exact field list, matching `publish-check`.
- [ ] A slug taken concurrently produces 409, not a 500 or a duplicate.
- [ ] `expiry_date` derives from the purchased package.
- [ ] The public page is live within five seconds, measured in an E2E test.
- [ ] The watermark flag reaches the renderer and `docs/API/08` is amended.

---

**Inherited from ADR-052 (BR-2.8)** — nothing in the public renderer changes for a lapsed trial: `docs/API/08` already answers 404 for any status other than `published` and forbids revealing why. What is owed is **owner-facing**: the dashboard must show an upgrade prompt rather than a renewal prompt for an invitation that expired without ever reaching `paid`. The predicate is `InvitationRepository.findUnpaidInvitation`'s, already written.

## P3-10 — Unpublish, Republish, Slug Change After Publish

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P3-09 |
| **Spec refs** | `docs/BACKEND/06-PUBLISHING.md` § Unpublish, `docs/PLAN/02` § BR-2.5, BR-6.2, `docs/PLAN/10` § Unpublish |
| **Spec required** | Yes — business rule |
| **Surface** | backend |

**Goal** — Unpublish returns the invitation to `paid`, not to `draft`, keeps the slug reserved, and removes the page from cache immediately.

**Steps**
1. Implement `POST /invitations/:id/unpublish` guarding `status === 'published'`.
2. Set status to `paid` per BR-2.5 — the invitation was paid for and republishing must not cost again. Preserve `published_at` as history.
3. Invalidate the public cache **immediately**, per `docs/BACKEND/06`: a page that stays cached after unpublishing is a privacy failure, and the window matters.
4. Keep the slug reserved while the invitation exists, per `docs/PLAN/10` § Unpublish — preventing someone else from claiming a temporarily unpublished couple's slug.
5. Allow republish with no new payment while `expiry_date` has not passed.
6. Implement post-publish slug change per BR-6.2: explicit confirmation, rate limited, with old links breaking made clear in the API response so the UI can warn.

**Definition of Done**
- [ ] Unpublish sets `paid`, never `draft`.
- [ ] The public page 404s immediately after unpublish, including from cache — asserted in a test that reads through the cache layer.
- [ ] The slug cannot be claimed by another user while unpublished.
- [ ] Republish requires no new order.

---

## P3-11 — Production Subdomain Routing and TLS

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P3-09, P0-23 |
| **Spec refs** | `docs/DEVOPS/03-REVERSE-PROXY.md`, `docs/ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md`, `docs/PLAN/10` § Subdomain |
| **Spec required** | No |
| **Surface** | infra |

**Goal** — The production topology from `docs/ARCHITECTURE/08` serving the fixed hostnames from `docs/PLAN/10` § Hostnames, each with its own automatically renewed certificate.

**Steps**
1. Apply the `P0-23` routing configuration to production: the public invitation host, the application host, and the admin host once `P5-01` needs it. No wildcard record (ADR-024).
2. Confirm automatic renewal for each hostname's certificate, and add the 14-day expiry alert from `docs/DEVOPS/07`.
3. Apply edge rate limiting per `docs/DEVOPS/03`, with the webhook path exempt.
4. Set a longer upload timeout than the general API timeout, per `docs/DEVOPS/03` § Timeout & Buffering — a 10MB photo on a phone connection is not a stuck request.
4b. **Owed by `P1-17`**: set the request-body cap (`request_body max_size` in Caddy) to just above 10 MB on the upload route. `docs/SECURITY/06` layer 4 asks for an oversized upload to be refused "at the request level BEFORE the file is fully received", and today only the framework half exists — multer stops reading at the limit, but the bytes have already reached the application. Until this is done the API is one layer thinner than the document specifies, which is why it is written here rather than counted as done there.
5. Add the security headers not already set at the application layer, and keep the frame policy separate for the public invitation surface (`docs/SECURITY/08`).
6. Verify with a real published invitation, not a placeholder.

**Definition of Done**
- [ ] A real published invitation is reachable at `invitation.vizunicum.my.id/{slug}` over HTTPS.
- [ ] A request for a reserved path on that host does not reach the public invitation app, and the reserved list matches `slug_blocklist` (R15).
- [ ] Certificate renewal is automated and alerted on.
- [ ] Media upload survives a slow connection that a normal API timeout would kill.
- [ ] The webhook path bypasses edge rate limiting.

---

## P3-12 — Public Page Caching and Invalidation

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P3-09, P2-08 |
| **Spec refs** | `docs/ARCHITECTURE/06-CACHING-ARCHITECTURE.md`, `docs/FRONTEND/07` § Strategy, `docs/PLAN/18` R3, `docs/DEVOPS/05` § Cache Hit Ratio |
| **Spec required** | Yes — availability |
| **Surface** | backend, infra |

**Goal** — Public pages served from cache with event-driven invalidation, protected against stampedes — the mitigation for R3, the risk of the invitation going down on the wedding day.

**Steps**
1. Cache the rendered public page at the CDN and application layers, keyed on `invitation_id + template_version_id` as `docs/ARCHITECTURE/06` requires — a slug-only key serves stale content after a template version change.
2. Invalidate on `invitation.updated`, `published`, `unpublished` and `expired`, and proactively regenerate for published invitations so a guest's first request after an edit is not a cache miss.
3. Keep an absolute TTL of about an hour as the safety net for a missed invalidation event.
4. Implement stampede protection with a lock or singleflight on miss, per `docs/ARCHITECTURE/06` § Cache Stampede Protection. The traffic shape here is many guests opening the same link within minutes, which is precisely the shape that turns one expiry into a thundering herd.
5. Keep personalization out of the cached HTML (`P2-10`).
6. Cache template definitions in Redis with invalidation on version publish.
7. Expose cache hit ratio as a metric with the `docs/DEVOPS/07` alert at below 50%, and the 90% target from `docs/DEVOPS/05` on the dashboard.
8. Set media cache headers to immutable with a long TTL, relying on UUID-versioned filenames rather than invalidation (`docs/ARCHITECTURE/05` § CDN).

**Definition of Done**
- [ ] An owner's edit is visible publicly within seconds without a manual purge.
- [ ] A cold cache under 100 concurrent requests produces one origin render, proven by a test.
- [ ] Cache keys include the template version; a version change does not serve stale HTML.
- [ ] Hit ratio is measured and alerted on.
- [ ] Unpublishing removes the page from cache immediately.

---

## P3-13 — Invitation Expiry Job and Renewal

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P3-09, P3-07 |
| **Spec refs** | `docs/BACKEND/06-PUBLISHING.md` § Expiry Check and Renewal, `docs/PLAN/02` § BR-2.6, BR-9, `docs/BACKEND/08-JOBS-WORKERS.md` |
| **Spec required** | Yes — business rule |
| **Surface** | worker, backend |

**Goal** — Invitations expire on a schedule rather than mid-request, and a renewal payment brings them back.

**Steps**
1. Implement `invitation_expiry_check` daily at 00:05 WIB per `docs/BACKEND/08`, transitioning `published` invitations past `expiry_date` to `expired`, writing history, invalidating cache, and emitting the notification event.
2. Keep the transition in the job, never computed on the fly during a request — `docs/PLAN/06` § Transition Rules is explicit, and an on-the-fly transition makes the state depend on who happened to load the page.
3. Implement renewal per `docs/BACKEND/06` § Renewal: on `order.paid` with `order_type = 'renewal'`, extend `expiry_date` from `GREATEST(expiry_date, now())` by the package duration, and restore `published` if the invitation had expired.
4. Serve the friendly "invitation has ended" page for an expired invitation (`docs/UI-UX/14` § Special States), while the API still returns an undifferentiated 404 (`docs/API/08`).
5. Implement the retention chain from BR-9: expired for 90 days without renewal → soft delete, then hard delete 30 days later, with three notifications before deletion. The notification wiring lands in `P4-07`; the job and its schedule belong here.
6. Delete storage objects for hard-deleted invitations through the grace-period job, per `docs/ARCHITECTURE/05` § Quota & Lifecycle.

**Definition of Done**
- [ ] Expiry happens only in the scheduled job; a request never mutates status.
- [ ] Renewal extends from whichever of expiry or now is later, and restores `published`.
- [ ] Expired invitations show the friendly page while the API stays undifferentiated.
- [ ] The retention chain is implemented with its notification hooks, and hard deletion removes storage objects.

---

## P3-14 — Frontend: Checkout and Payment Status

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P3-04, P0-22 |
| **Spec refs** | `docs/UI-UX/13-CHECKOUT-UX.md`, `docs/UI-UX/10` § PaymentStatusBanner, `docs/SECURITY/07`, `docs/FRONTEND/01` § Query Parameters |
| **Spec required** | Yes — payment UX |
| **Surface** | web-app |

**Goal** — A checkout flow that never claims success the server has not confirmed.

**Steps**
1. Build the single package card per `docs/UI-UX/13` § Package Page — price, active period and what is included. There is one package and no active addon at MVP (ADR-023), so this page informs rather than asks the user to choose; a comparison table with one column is worse than none. Leave room for the layout to become comparison cards later without a redesign.
2. Show the total from the server's calculation, never computed client-side — a client-computed total that disagrees with the charge is a support incident.
3. Redirect or embed the provider widget from the initiation response.
4. On return with `?returning=true` (`docs/FRONTEND/01`), poll `GET /orders/:id/payment/status`. **Ignore any status in the redirect URL entirely.** `docs/SECURITY/07` forbids acting on it; the UI does not read it at all, which is stronger than reading and disregarding it.
5. Implement `PaymentStatusBanner` states from `docs/UI-UX/10`: pending with a spinner and auto-poll, success, failed or expired with a retry.
6. After roughly 60 seconds of polling, show the "still processing, we will email you" fallback from `docs/UI-UX/13`.
7. Handle the in-app browser case from `docs/TESTING/06`: WhatsApp and Instagram WebViews often block gateway popups and redirects. Detect and offer "open in browser" — this is a real conversion problem in the Indonesian market, not an edge case.
8. Show official provider logos as trust signals (`docs/UI-UX/13`).

**Definition of Done**
- [ ] The URL contains no status the UI reads; a test with a tampered `?status=success` shows no success state.
- [ ] Payment status is never ambiguous, satisfying `docs/UI-UX/18`.
- [ ] The polling fallback appears after the timeout rather than spinning forever.
- [ ] Checkout completes inside a WhatsApp in-app browser or offers a working escape.

---

## P3-15 — Frontend: Publish Flow and Share Screen

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P3-09, P2-06 |
| **Spec refs** | `docs/PLAN/04` § F8, `docs/UI-UX/05` § Checkout flow, `docs/UI-UX/12` § Publish CTA |
| **Spec required** | No |
| **Surface** | web-app |

**Goal** — From "Publish" to a shareable link, with every blocking condition explained rather than merely enforced.

**Steps**
1. Wire the Publish button to `publish-check`; when fields are missing, show the modal listing them with links that jump to the right section and field.
2. When the invitation is complete but unpaid, route to checkout.
3. Show the final slug confirmation modal before publishing (`docs/PLAN/04` § F8).
4. On success, show the live link with WhatsApp share and copy-link actions.
5. Surface the 409 slug conflict inline with a suggestion, not as a generic failure.
6. Show unpublish and republish in invitation settings, with the consequence stated plainly.

**Definition of Done**
- [ ] Missing-field errors are navigable — clicking one lands on the field.
- [ ] The publish result screen shows the working public link.
- [ ] A slug conflict is recoverable without leaving the flow.
- [ ] Unpublish explains what happens before it happens.

---

## P3-16 — Payment Security Review and Phase 3 Acceptance

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | all Phase 3 tasks |
| **Spec refs** | `docs/SECURITY/07-PAYMENT-SECURITY.md`, `docs/TESTING/04-SECURITY-TESTING.md` § Payment Tampering, `docs/PLAN/16` § Critical Dependencies, `docs/PLAN/17` |
| **Spec required** | Yes — release gate |
| **Surface** | all |

**Goal** — The review `docs/PLAN/16` requires before payment code reaches production, executed as a test suite and a documented sign-off rather than a conversation.

**Steps**
1. Execute the payment tampering methodology in `docs/TESTING/04`: manipulate the redirect parameter, post a forged webhook, post a valid webhook twice, and confirm state in the database after each.
2. Walk `docs/SECURITY/07` clause by clause and record where each is enforced in code, naming the file and the test.
3. Confirm PCI scope stays minimal: no card data touches the system, all card entry happens on the provider's surface (`docs/SECURITY/07` § PCI-DSS Scope).
4. Confirm redaction: no raw payment payload, key or signature appears in application logs.
5. Run the E2E flows from `docs/TESTING/03` § 1 and § 5 — full happy path and the failed/expired payment path.
6. Verify the publish-within-five-seconds criterion and cache behaviour under a burst.
7. Obtain and record the security reviewer's sign-off, per `docs/PLAN/17` § Sign-off.
8. Write the phase summary record.

**Definition of Done**
- [ ] Every tampering scenario in `docs/TESTING/04` is an automated test, all passing.
- [ ] A clause-by-clause mapping of `docs/SECURITY/07` to code and tests exists in the phase record.
- [ ] No payment secret or raw payload appears in any log, verified by inspection of a real run.
- [ ] The security reviewer's sign-off is recorded with a date.
- [ ] The phase summary exists in `MEMORY/records/`.
