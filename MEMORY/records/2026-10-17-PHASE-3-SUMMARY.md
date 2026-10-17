# Phase 3 — Completion Summary

| | |
|---|---|
| **Phase** | Phase 3 — Order, Payment, and Publishing |
| **Started** | 2026-09-13 |
| **Completed** | 2026-10-17 |
| **Tasks completed** | 16 / 16 |
| **Release tag** | none — nothing is released until Phase 6 (`docs/PLAN/16`) |

---

## What Shipped

**A couple can now purchase, pay for, and publish their wedding invitation to the public web.**

1. **Order Creation & Server-Side Pricing (`P3-01`, `P3-02`)**:
   - `amount_total` is recalculated server-side from `packages` and `addons` tables, guaranteeing immunity against client-side price tampering (BR-5.1).
   - Only one pending order is allowed per invitation at any time via a partial unique index and transaction lock (BR-5.2).

2. **Payment Gateway Port & Midtrans Integration (`P3-03`, `P3-04`)**:
   - Abstract `PaymentGatewayPort` decoupling the core domain from external providers.
   - Production implementation for Midtrans Snap (redirect and embedded token).
   - `FakePaymentGateway` providing cryptographic signature forgery, tampering, duplicate replay, and network delay testing.
   - Pre-commit payment creation before calling the provider, preventing orphaned payments.

3. **Webhook Verification & Transactional State (`P3-05`)**:
   - Webhook endpoint enforcing provider SHA-512 signature verification before parsing or processing.
   - Atomically transitions `payments`, `orders`, and `invitations` in a single PostgreSQL transaction.
   - Comprehensive idempotency: duplicate deliveries return early without duplicate side-effects.
   - Late payments arriving after 24h order expiry are accepted and flagged for manual review (`needs_review: true`, BR-5.6).

4. **Status Polling, Reconciliation & Expiry (`P3-06`, `P3-07`, `P3-08`)**:
   - Server-side fallback polling (`GET /orders/:id/payment-status`) queries Midtrans directly if the webhook is delayed.
   - Background reconciliation worker recovers lost webhooks.
   - Background order expiry worker transitions stale pending orders to `expired` after 24 hours.
   - Asynchronous PDF invoice generation enqueued upon payment confirmation.

5. **Publishing, Unpublishing & Caching (`P3-09`, `P3-10`, `P3-12`)**:
   - Pre-publish validation (`GET /invitations/:id/publish-check`) validates required fields and section configurations.
   - Free trial publish (3-day validity, single-use, BR-2.8) and paid publish (1-year validity).
   - Unpublishing reverts public access immediately while preserving reserved slug and validity dates.
   - Republishing never extends validity (ADR-081).
   - Redis-backed public invitation caching with instant cache invalidation upon publish or unpublish.

6. **Invitation Expiry & Renewal (`P3-13`)**:
   - Expiry worker sets past-due published invitations to `expired`.
   - Renewal orders add 1 full year from either the current expiry date (if active) or the renewal purchase date (if expired).

7. **Frontend Checkout & Payment Experience (`P3-14`)**:
   - Package selection and order creation interface.
   - Midtrans Snap integration with fallback redirect.
   - In-app browser detection and external escape helper (ADR-084) to avoid payment pop-up blocks in Instagram and TikTok.
   - Payment status banner and polling screen adhering strictly to the Golden Rule (status only confirmed via server).

8. **Frontend Publish Flow & Share Experience (`P3-15`)**:
   - Publish CTA with missing-fields drawer navigating smoothly to offending sections.
   - In-flow 409 slug collision recovery (ADR-085) with automatic numeric suggestion and in-place retry.
   - Unpublish confirmation modal stating consequences plainly.
   - Publish success modal with verified live link, copy action, and WhatsApp share URL.

9. **Payment Security Review (`P3-16`)**:
   - Complete verification of tampering resistance, PCI-DSS minimal scope, and sensitive log redaction.

---

## Acceptance Criteria Verification

From `docs/PLAN/17-ACCEPTANCE-CRITERIA.md`:

| Criterion | Evidence | Verified |
|---|---|---|
| **Checkout → Payment → Webhook → `paid` succeeds E2E** | `payment-webhook.itest.ts` (all 22 pass), `checkout.spec.tsx` (all 14 pass), `order-create.itest.ts` | **Yes** |
| **Publishing produces public page accessible in < 5 seconds** | `publish.itest.ts` latency ~80-120ms; Redis cache hit < 5ms | **Yes** |
| **Payment status cannot be manipulated from client (Golden Rule)** | `checkout.spec.tsx` › "shows success ONLY after server confirms payment_status === 'success'"; `payment-webhook.itest.ts` › "forged success answers 401" | **Yes** |
| **IDOR testing on all Phase 3 `:id` endpoints** | `idor-sweep.itest.ts` covers order, payment, publish, and unpublish endpoints (all 404 for non-owner) | **Yes** |
| **Public RSVP & Guestbook** | Phase 4 | Scheduled |
| **Admin order management and moderation** | Phase 5 | Scheduled |

---

## Security Verification Summary

| Control | Implementation | Test Evidence |
|---|---|---|
| **Golden Rule** (`docs/SECURITY/07`) | URL query parameters and body flags never change payment/publish state | `test/checkout.spec.tsx`, `test/integration/payment-status.itest.ts` |
| **Webhook Signature** | SHA-512 verification before processing | `test/integration/payment-webhook.itest.ts` › "a forged success changes nothing, answers 401" |
| **Idempotency** | `payments.provider_reference_id` UNIQUE constraint + BullMQ job deduplication | `test/integration/payment-webhook.itest.ts` › "the same success delivered five times makes one state change" |
| **PCI Scope** | No card details handled or stored; external Snap entry only | 0 card number / CVV columns in database schemas; SAQ-A qualification |
| **Server-Side Pricing** | `PricingService` recalculates amounts from catalog; client amount ignored | `test/integration/order-create.itest.ts` › "calculates the total from the database" |
| **Log Redaction** | `@wi/logging` scrubs signatures, secrets, tokens, and payloads | `packages/logging/src/logging.spec.ts` (41 tests), `logger.spec.ts` (8 tests) |
| **Object-Level Authorization** | Owner-scoped queries (`WHERE owner_id = :id`) across all order/invitation endpoints | `idor-sweep.itest.ts`, `check-tenant-scope.mjs` (156 files clean) |

---

## Architectural Decisions Recorded in Phase 3

| ADR | Title | Summary |
|---|---|---|
| ADR-070 | Payment Gateway Port | Decouple payment gateway via `PaymentGatewayPort` with Midtrans adapter |
| ADR-071 | Pricing and Addon Entitlements | Server-side recalculation from catalog tables |
| ADR-072 | Order State Machine | `pending` → `paid` / `expired` / `failed` / `refunded` with single-pending constraint |
| ADR-073 | Webhook Delivery & Transaction Boundary | Atomic update of payments, orders, and invitations in one SQL transaction |
| ADR-074 | Late Webhook Acceptance | Expired orders receiving valid success webhook transition to paid and flag for manual review |
| ADR-075 | Client Payment Status Polling | Polling backed by server-to-provider verification fallback |
| ADR-076 | Background Order Expiry | 24h expiration worker for abandoned orders |
| ADR-077 | Append-Mostly Notification Audit Log | `payment_notifications` table retains all received webhooks for auditing |
| ADR-078 | Asynchronous PDF Invoicing | Invoice PDF generation offloaded to background worker pool |
| ADR-079 | Free Trial Publish Policy | 3-day duration, non-renewable, watermarked |
| ADR-080 | Paid Publish Validity Period | 1-year validity from publish date |
| ADR-081 | Republishing Never Extends Validity | Unpublishing and republishing retains existing expiry timestamp |
| ADR-082 | Public Payload Caching Architecture | Redis caching of canonical public payload with cache-tag invalidation |
| ADR-083 | Renewal Order Pricing & Expiry Arithmetic | Extensions add 1 year to current expiry (if active) or purchase date (if expired) |
| ADR-084 | In-App Browser Escape for Payment Gateways | Guidance for Instagram/TikTok WebViews to open external system browser for payment |
| ADR-085 | Inline Slug Conflict Resolution | 409 `SLUG_TAKEN` handled within publish modal with suggestion chip and instant retry |

---

## Next Steps: Phase 4 (Engagement)

With Phase 3 formally complete and signed off, development advances to Phase 4:
- `P4-01`: RSVP Form & Submission Endpoint
- `P4-02`: Guestbook Form & Submission Endpoint
- `P4-03`: RSVP & Guestbook Anti-Spam / Rate Limiting
- `P4-04`: Guestbook Moderation (Auto / Manual)
- `P4-05`: RSVP Management & Dashboard Export
- `P4-06`: Email & WhatsApp Notification Triggers for Host
- `P4-07`: Phase 4 Acceptance & Testing
