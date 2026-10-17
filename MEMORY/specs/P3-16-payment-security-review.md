# P3-16 — Feature Spec: Payment Security Review and Phase 3 Acceptance

| | |
|---|---|
| **Task** | `P3-16` |
| **Date** | 2026-10-17 |
| **Author** | AI Agent (Antigravity) |
| **Status** | Implemented & Verified |

---

## 1. Goal

Execute the mandatory Phase 3 release gate review specified in `docs/PLAN/16` and `docs/SECURITY/07-PAYMENT-SECURITY.md`. This review validates payment tampering resistance, strict webhook signature enforcement, idempotency under replay/concurrency, zero card data touch (PCI-DSS minimum scope), server-side price calculation, log redaction of sensitive credentials, publish-within-5-seconds latency SLA, and end-to-end integration across all Phase 3 order, payment, and publishing capabilities.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/SECURITY/07-PAYMENT-SECURITY.md` | Entire document | Concept separation, Golden Rule (status only from webhook/server query), signature verification (SHA-512), idempotency, PCI-DSS minimal scope, server pricing, manual refund, sensitive data redaction, timeout & expiry. |
| `docs/TESTING/04-SECURITY-TESTING.md` | § Payment Tampering | Four-step tampering test: 1. Redirect parameter tampering, 2. Forged/empty signature rejection (401), 3. Replay idempotency, 4. State confirmation in database. |
| `docs/PLAN/02-BUSINESS-RULES.md` | BR-5.1 – BR-5.7, BR-2.8 | Server-side pricing (BR-5.1), single active pending order (BR-5.2), failure returns draft (BR-5.3), verified webhook pays invitation (BR-5.4), 24h order expiry (BR-5.5), late payment review flag (BR-5.6), free trial limits (BR-2.8). |
| `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` | § Phase 3 & Critical Dependencies | Phase gate rule: payment security review must be signed off before Phase 4 begins. |
| `docs/PLAN/17-ACCEPTANCE-CRITERIA.md` | § Functional & Security | Checkout → Payment → Webhook → Paid succeeds E2E; publishing in < 5s; payment status cannot be manipulated from client. |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in | Test Coverage |
|---|---|---|---|
| BR-5.1 | `amount_total` recalculated server-side from packages/addons | `PricingService.ts`, `OrderService.ts` | `order-create.itest.ts` › "calculates the total from the database" |
| BR-5.2 | Maximum 1 pending order per invitation | `OrderService.ts`, DB partial unique index | `order-create.itest.ts` › "refuses a second pending order" |
| BR-5.3 | Payment failure returns invitation to draft | `PaymentWebhookService.ts`, `InvitationStatusService.ts` | `payment-webhook.itest.ts` › "fails the order and returns the invitation to draft" |
| BR-5.4 | Payment success transitions order and invitation to `paid` | `PaymentWebhookService.ts` | `payment-webhook.itest.ts` › "a verified success pays the payment, the order and the invitation together" |
| BR-5.5 | Pending order expires after 24 hours | `OrderExpiryWorker.ts`, `OrderService.ts` | `order-expiry.itest.ts` › "expires unpaid orders past the deadline" |
| BR-5.6 | Late payment after expiry applies entitlement and flags for review | `PaymentWebhookService.ts` | `payment-webhook.itest.ts` › "a success after the order expired is applied and flagged" |
| BR-5.7 | Invoices generated with sequential identifier | `InvoiceService.ts`, worker | `order-history-invoice.itest.ts` › "invoice generated" |
| BR-2.8 | Free trial publish single-use | `PublishService.ts`, `InvitationStatusService.ts` | `publish.itest.ts` › "user: free trial publish (BR-2.8)" |

## 4. API Contracts Verified

- `POST /api/v1/invitations/:id/orders` — creates order with server-recalculated price.
- `GET /api/v1/invitations/:id/orders` — tenant-scoped order history with invoice numbers.
- `POST /api/v1/orders/:id/payments` — initiates payment and returns provider checkout token/redirect URL.
- `GET /api/v1/orders/:id/payment-status` — polling fallback querying provider server-side when pending.
- `POST /api/v1/payments/webhook/:provider` — signature-verified webhook handler.
- `GET /api/v1/invitations/:id/publish-check` — pre-publish completeness validator.
- `POST /api/v1/invitations/:id/publish` — publishes invitation (trial or paid).
- `POST /api/v1/invitations/:id/unpublish` — unpublishes back to draft/paid.

## 5. Security Architecture Mapping (`docs/SECURITY/07`)

1. **Golden Rule**: Client return parameters (e.g. `?transaction_status=success`) are completely disregarded for state transitions. Tested in `frontend/web-app/test/checkout.spec.tsx` and `backend/api/test/integration/payment-status.itest.ts`.
2. **Signature Verification**: Verified before reading/processing body. SHA-512 comparison using constant-time checks where applicable. Rejecting with 401 and logging security alert without processing.
3. **Idempotency**: Handled via database constraints (`payments.provider_reference_id` UNIQUE) and BullMQ job idempotency keys (`order.paid:${order.id}`).
4. **PCI Scope Minimization**: No credit card, CVV, or cardholder PAN data is received, accepted, or stored anywhere in the frontend or database schemas.
5. **Redaction**: Application logs filter and redact all sensitive keys (`signature`, `token`, `secret`, `raw_callback_payload`, `password`, `key`) via `@wi/logging`.
6. **Reconciliation & Expiry**: Automatic 24h expiry worker, fallback reconciler for missed webhooks, and manual review flags (`needs_review: true`) for anomalies.
