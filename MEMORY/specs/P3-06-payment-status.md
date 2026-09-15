# P3-06 — Feature Spec: Payment Status Polling and Provider Reconciliation

| | |
|---|---|
| **Task** | `P3-06` |
| **Date** | 2026-09-15 |
| **Author** | Claude (autonomous run) |
| **Status** | Implemented — **written alongside the code, not before it** (see the record) |

---

## 1. Goal

The client can ask what the server believes about an order's payment; the server can ask the provider
about a payment whose webhook may be lost; neither can be told what to believe. A daily job catches a
webhook that never arrived.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/07` | § Status Polling | `GET /orders/:order_id/payment/status` → `{ order_status, payment_status, paid_at }`; display only |
| `docs/BACKEND/05` | § Status Polling, § Supporting Jobs | Optional active query after a delay, verified before changing state; daily `payment.reconciliation` flags mismatches |
| `docs/SECURITY/07` | Golden rule | A server query is a legitimate source; a client parameter is not |
| `docs/BACKEND/08`, `docs/ARCHITECTURE/07` | Jobs | `payment_reconciliation` daily 03:00 WIB; workers separate from the API process |

**Gaps** (ADR-078): Midtrans's documented API has a per-order status query but no transaction listing, so
reconciliation queries local candidates rather than comparing lists; and a job that must run domain
services has no home in `backend/worker`, which carries none of them.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-5.2 | Status only from a verified callback or a server query | Status endpoint has no status input; query results go through `PaymentWebhookService.applyVerified` |
| BR-5.4 | Only an admin refund reverses a payment | Reconciliation never downgrades a success; it flags |

## 4. API Contract

`GET /api/v1/orders/:order_id/payment/status`, authenticated, rate limited `general-authenticated`,
`Cache-Control: private, max-age=2`. `200 { order_status, payment_status | null, paid_at | null }`.
404 for another user's, unknown or malformed order. Query parameters are ignored.

## 5. Data Model Impact

Migration `0013`: `payment_notifications.source` (`webhook` | `query` | `reconciliation`), default `webhook`.

## 6. Authorization

`OrderService.ownedOrderStatus(scope, orderId)` — `user_id` in the `WHERE`. The provider is only asked
after ownership is established.

## 7. Validation and Sanitization

No input beyond the path id (UUID-shaped before any query).

## 8. State Transitions

None directly. A verified provider answer (`success`, `failed`, `ignored`) is applied by
`applyVerified(event, "query" | "reconciliation")` — the webhook's transaction and outcome table (P3-05 § 8).

## 9. Side Effects

- **Query fallback**: order `pending`, displayed payment `pending` and older than 120 s, provider matches,
  not asked in the last 30 s (Redis throttle per reference) → `queryStatus`; a non-pending verified answer
  is applied, then the state is re-read. Failures are logged and ignored.
- **Reconciliation** (`payment_reconciliation`, daily): pending payments 10 min–48 h old and successes
  verified in the last 48 h. Pending + provider non-pending → applied, always flagged. Success + provider
  not success → `reconciliation_mismatch`; success + provider has none → `reconciliation_missing`; both
  flagged, nothing changed.
- **Where it runs** (ADR-078): scheduled by `worker-cron`; consumed by the API jobs process
  (`dist/jobs/main.js`, compose service `api-jobs`).

## 10. Failure Modes

Provider down: polling answers from the database; reconciliation counts an error and the next run (48 h
lookback) covers it. Jobs process down: jobs wait in their queues.

## 11. Abuse Cases

| Abuse case | Expected behaviour | Test name |
|---|---|---|
| `?status=paid` on the status URL | Ignored | `payment-http.spec.ts` › "GET …/payment/status ignores any status a client tries to supply" |
| Polling another user's order | 404, provider not asked | `payment-status.itest.ts` › "answers another user's order with 404, and asks the provider nothing"; IDOR sweep |
| Polling to hammer the provider | One query per 30 s per payment | "asks at most once per throttle window…" |

## 12. Test Plan

Integration: read cases, fallback applies through the webhook path (same history reason, `source=query`),
throttle, provider down, pending answer; reconciliation recover/mismatch/missing/agree/error; jobs process
boots `AppModule` and runs the job. Unit: HTTP headers and ignored query; worker/API job contract.

## 13. Observability

`payment.status_query_failed` (warn), `payment.reconciliation_finished` (info with counts),
`payment.needs_review` + `wi_payment_needs_review_total` for findings, `job started/finished/failed`.

## 14. Open Questions

None blocking.
