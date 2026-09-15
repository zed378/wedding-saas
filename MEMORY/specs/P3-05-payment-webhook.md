# P3-05 — Feature Spec: Payment Webhook

| | |
|---|---|
| **Task** | `P3-05` |
| **Date** | 2026-09-14 |
| **Author** | Claude (autonomous run) |
| **Status** | Implemented |

---

## 1. Goal

`POST /api/webhooks/payment/:provider` is the only path that marks a payment `success`, an order
`paid` and an invitation `paid` — for a verified notification, exactly once, all or nothing — and
records every notification it receives, forged ones included.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/07` | § Webhook Flow | Verify first; look up by reference; idempotent on `success`; one transaction for payment + order + invitation; 200 fast; invalid → 401 logged as potential fraud |
| `docs/BACKEND/05` | § Webhook Handler | Steps 1–6; unknown reference → 200 + anomaly; `order.paid` after commit |
| `docs/SECURITY/07` | Golden Rule, Idempotency, Timeout & Expiry | A success after expiry is processed as valid and flagged for review |
| `docs/DATABASE/08` | § Critical Notes | Unique `(provider, provider_reference_id)`; raw payload stored; `signature_valid` records forged attempts |
| `docs/BACKEND/08` | jobs | `payment.webhook_process` "optional — can also be sync within the handler if it's fast enough" |
| `docs/DEVOPS/05`, `07` | Payment metrics; alert | Signature-failure rate metric; alert above a threshold |
| `docs/PLAN/02` | BR-2.3, BR-5.2, BR-5.3 | Paid only from a validated callback; a failed payment leaves the order failed and the invitation draft |
| `docs/PLAN/06` | Transition rules | `pending_payment → paid` only through the verified webhook |

**Gaps found and resolved in ADR-077:**

1. **Where a forged notification is recorded.** `DATABASE/08` says `signature_valid` keeps fake callbacks
   logged, but a forged callback has no payment of its own, and writing its claim onto the real payment
   row it names would let a forger overwrite a genuine record. → new append-mostly table
   `payment_notifications` (migration `0012`); `payments.signature_valid` is set only from a verified one.
2. **A success for an expired or failed order.** `SECURITY/07` requires it be processed; the state
   machine has no `draft → paid`. → new SYSTEM-only edge `draft → paid` ("late payment confirmed",
   flagged); `docs/PLAN/06` amended.
3. **No metrics endpoint exists** (`P0-23` did not build one). → a dependency-free counter registry and
   `GET /metrics` behind `METRICS_TOKEN`; `deploy/prometheus/alerts.yml` carries the alert.
4. **The rate-limit exemption names `/api/v1/webhooks/`**, a path that does not exist; the route is
   `/api/webhooks/payment/:provider` (`API/07`). → exemption corrected, tested.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-5.2 | Status only from a verified callback | `PaymentWebhookService`: nothing changes before `verifyNotification` returns valid |
| BR-2.3 | `paid` after a validated callback | `OrderService.settlePaid` inside the webhook transaction, SYSTEM actor |
| BR-5.3 | Failed payment → order failed, invitation draft | `OrderService.settleFailed`, only when the order has no other live payment |
| `SECURITY/07` § Idempotency | One effect per payment | Row lock + `status = 'success'` check; conditional updates |
| `SECURITY/07` § Expiry | Late success is valid, flagged | `settlePaid` result `late_payment`, `needs_review` |

## 4. API Contract

- `POST /api/webhooks/payment/:provider`. No user authentication, no rate limit (a provider retry is
  legitimate traffic), JSON body.
- `:provider` not the configured gateway's → 404.
- Invalid (forged, tampered, malformed, unsigned) → **401** `UNAUTHENTICATED`, after the attempt is recorded.
- Valid → **200** `{ success: true, data: { received: true } }` whether it changed anything, was a
  duplicate, named an unknown payment or was flagged — the provider has nothing to retry.
- Valid but processing failed (database error) → **500**, so the provider retries; nothing partial
  committed.
- `GET /metrics` — Prometheus text; `Authorization: Bearer <METRICS_TOKEN>`; 404 when the token is not
  configured or does not match.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `payment_notifications` | Insert (every request), update processing columns | New, migration `0012` |
| `payments` | Lock by `(provider, reference)`, update status/verified_at/signature_valid/raw/method | |
| `orders` | Lock, update status | Through `OrderService` |
| `invitations`, `invitation_status_history` | Transition | Through `InvitationStatusService`, SYSTEM |

`payment_notifications`: `id`, `provider`, `claimed_reference` (≤150), `payment_id` (FK, null),
`signature_valid` (not null), `rejection_reason`, `outcome`, `provider_status`, `amount`, `result`,
`needs_review`, `raw_payload` (JSONB; for an invalid notification only if an object ≤ 8 KB),
`received_at`, `processed_at`. The application role may `INSERT`/`SELECT` and `UPDATE` only
`payment_id, result, needs_review, processed_at`; no `DELETE`. `docs/DATABASE/08` amended.

## 6. Authorization

No user. Authenticity is the signature, checked by the gateway adapter before anything is read. The
payment is found by `(provider, provider_reference_id)` from the **verified** event only; a claimed
reference on an invalid notification is recorded as text and never looked up.

## 7. Validation and Sanitization

Body is JSON (Express, `BODY_LIMIT`). Provider-specific validation in the adapter. No free text is
rendered anywhere; the raw payload is stored as JSON and never logged.

## 8. State Transitions

On a verified **success** for a payment not already `success` (amount matching):

| Order was | Order becomes | Invitation (`new_publish`) | Result | Review |
|---|---|---|---|---|
| `pending` | `paid` | `pending_payment → paid` | `applied` | no |
| `expired`, `failed` | `paid` | `pending_payment → paid`, or **`draft → paid`** (new edge) | `late_payment` | **yes** |
| `paid` | unchanged | unchanged | `duplicate_charge` | **yes** — a second payment for one order |
| `refunded` | unchanged | unchanged | `refunded_order` | **yes** |

`renewal` orders: order `paid`; the invitation is not changed here — extending `expiry_date` and
`expired → published` are `P3-13`'s (flagged in the record as an obligation).

An invitation in a state the machine refuses (e.g. already `published` from a trial) → the order is still
`paid`, the transition is skipped and the notification flagged.

On a verified **failed** for a `pending` payment: payment `failed`; if the order has no other `pending`
or `success` payment: order `pending → failed`, invitation `pending_payment → draft` (SYSTEM). Never
downgrades a `success`.

**pending**: record the method; no status change. **ignored** (refund, chargeback, unknown): recorded
and flagged, nothing changed. **Amount different from `payments.amount`**: nothing changed, flagged.
**Unknown reference**: nothing changed, flagged, 200.

## 9. Side Effects

1. Insert the notification row (own statement, committed even if processing later fails).
2. Invalid: increment `wi_payment_webhook_signature_invalid_total{provider,reason}`, log
   `payment.invalid_signature` (warn), 401.
3. Valid: one transaction — lock payment, apply §8, update the notification row. Commit.
4. After commit, only if this delivery moved the order to `paid`: enqueue `notification.send`
   `{ template: "order_paid", orderId }` with idempotency key `order.paid:<orderId>`; log
   `payment.confirmed`. Increment `wi_payment_webhook_processed_total{provider,result}`.

## 10. Failure Modes

- Database down before the notification row: 500 → provider retries.
- Failure inside the transaction: rollback of payment, order and invitation together; notification row
  keeps `result = null`; 500 → retry.
- Queue down after commit: the enqueue is logged and swallowed; the payment is still confirmed.
- Provider never retries after a 500: `P3-06` reconciliation queries the provider.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Forged success, no signature | `SECURITY/07` | 401, recorded `signature_valid=false`, no state change | `payment-webhook.itest.ts` › "a notification without a signature…" |
| Wrong signature | `SECURITY/07` | 401, recorded, no change, metric +1 | "a forged success changes nothing…" |
| Forged claim naming a real payment | ADR-077 | Real payment row untouched | "a forged notification naming a real payment does not touch it" |
| Replayed valid webhook ×5 | § Idempotency | One change, one `order.paid` | "the same success delivered five times…" |
| Concurrent duplicates | § Idempotency | One change | "five concurrent deliveries…" |
| Unknown reference | `BACKEND/05` | 200, flagged, no change | "a verified notification for an unknown payment…" |
| Amount differs | `SECURITY/07` | Flagged, no entitlement | "a success for a different amount grants nothing" |
| After order expiry | § Timeout & Expiry | Processed, flagged | "a success after the order expired is applied and flagged" |
| Success then failed/pending (out of order) | — | No downgrade | "a failure arriving after the success changes nothing" |
| Mid-transaction failure | card DoD 3 | All three tables unchanged | "a failure mid-transaction rolls back payment, order and invitation" |
| Wrong provider in the path | — | 404, no processing | HTTP spec |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit | Metrics registry exposition; exempt path; HTTP status mapping; metrics endpoint auth |
| Integration | § 11 rows; failed payment → order failed + draft, and not when another payment is live; ignored flagged; pending records method; renewal order paid without invitation change; timing < 5 s with the enqueue asserted; role permissions on `payment_notifications` |
| Security | IDOR inventory exemption with named test; alert rule references a registered metric |

## 13. Observability

`payment.invalid_signature` (warn), `payment.confirmed` (info), `payment.needs_review` (error — a
human must look), `payment.unknown_reference` (warn). Metrics above. Alert: more than 5 invalid
signatures in 10 minutes → security channel.

## 14. Open Questions

None blocking. Renewal entitlement is `P3-13`'s. A second pending order created after a late payment is
flagged, not cancelled — `P3-07` owns that case.
