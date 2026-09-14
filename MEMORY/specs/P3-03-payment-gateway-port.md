# P3-03 — Feature Spec: Payment Gateway Port and Midtrans Adapter

| | |
|---|---|
| **Task** | `P3-03` |
| **Date** | 2026-09-14 |
| **Author** | Claude (autonomous run) |
| **Status** | Implemented |

---

## 1. Goal

A `PaymentGatewayPort` that `P3-04` (initiation), `P3-05` (webhook) and `P3-06` (status query) call
without knowing which provider is behind it, one Midtrans Snap adapter implemented from Midtrans's
current documentation, and a fake adapter that produces every notification the abuse suites need.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/BACKEND/05` | Initiation, Webhook, Polling | `createTransaction({ order_id, amount, customer })`; verify before logic; a provider query is verified too |
| `docs/BACKEND/01` | § order & payment | `payment` does not know `Invitation`; talks to `order` |
| `docs/SECURITY/07` | Golden Rule, Signature, PCI | Status only from a verified webhook or a server query; card data never touches us |
| `docs/SECURITY/09` | Third-Party Data Sharing | Name and email only |
| `docs/DEVOPS/06` | Redaction | Raw callback payload never in application logs |
| `docs/PLAN/18` | R9 | Vendor lock-in mitigated by the port |
| ADR-012 | — | Midtrans Snap |
| **Midtrans documentation (fetched 2026-09-14)** | see § 14 | The algorithm and endpoints below |

**Disagreement found**: `docs/BACKEND/05` and `docs/API/07` describe verification as
`verifySignature(rawBody, signatureHeader, secret)` with a *signature header* and a *webhook secret*;
`P0-18` added `MIDTRANS_WEBHOOK_SECRET` for it. Midtrans has neither: the signature is the
`signature_key` **field in the JSON body**, computed with the **server key**. The adapter follows
Midtrans (card step 2 says the provider's documentation wins); the port takes the parsed body; the
unused variable is removed; `docs/API/07` and `docs/BACKEND/05` are amended to say the signature's
location is provider-specific. ADR-075.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-5.2 | Status only from a verified callback or server query | The port offers no unverified notification: `verifyNotification` returns `valid: false` or a parsed, verified result; `queryStatus` verifies the status response's own `signature_key` |

## 4. API Contract

No HTTP endpoint (those are `P3-04`–`P3-06`). The port:

```ts
interface PaymentGatewayPort {
  readonly provider: string;                          // stored in payments.provider
  createTransaction(input): Promise<CreatedTransaction>;   // { providerReferenceId, redirectUrl, token }
  verifyNotification(body: unknown): NotificationVerdict;  // valid + VerifiedPaymentEvent | invalid + reason
  queryStatus(providerReferenceId): Promise<VerifiedPaymentEvent | null>;  // null = provider has no such transaction
}
```

`VerifiedPaymentEvent` = `{ providerReferenceId, outcome, amount (bigint rupiah), method | null,
providerStatus, raw }`. `outcome` is `pending | success | failed | ignored`: the three the card names,
plus `ignored` for statuses that must not change payment state automatically (refund, partial refund,
chargeback, authorize, anything unknown) — `P3-05` records and flags those; BR-5.4 makes refunds
admin-only. `raw` is for `payments.raw_callback_payload`, never for a log.

Errors: `PaymentProviderError { retryable }` — network failure, timeout, 5xx retryable; 4xx not.

## 5. Data Model Impact

None. `payments.provider` = `"midtrans"`; `payments.provider_reference_id` = the `order_id` sent to
Midtrans (the Snap response carries no transaction id, and every notification carries `order_id`).

## 6. Authorization

Server-to-server only. Basic auth with `base64(serverKey + ":")`. The key is chosen by environment
through `P0-18`'s rules (a `SB-` key is sandbox; production refuses a sandbox key); the base URL
follows the key, so a sandbox key can never be sent to the production API or the reverse.

## 7. Validation and Sanitization

- `providerReferenceId`: Midtrans `order_id` rules — `^[A-Za-z0-9\-_~.]{1,50}$`, checked before any call.
- `amount`: a positive bigint that is a safe integer (Snap takes a JSON number).
- Customer: trimmed name (≤ 255) and email only.
- Notifications: `order_id`, `status_code`, `gross_amount`, `signature_key`, `transaction_status` must
  be strings; `gross_amount` must be `digits.00` (IDR has no minor unit); otherwise `malformed`.

## 8. State Transitions

None here.

## 9. Side Effects

HTTPS calls to Midtrans with a 10-second timeout. Info logs `payment.provider_call` with provider,
operation, reference, HTTP status and duration — no body, no key, no payload.

## 10. Failure Modes

- Timeout, DNS, 5xx: `PaymentProviderError(retryable: true)`; `P3-04` shows a retryable message.
- 401 from Midtrans (bad key): not retryable, logged at `error` — an operator problem.
- Midtrans key absent outside development and test: the gateway is `unconfigured`; every call throws
  `PaymentProviderError(retryable: false)` (the API still boots, like Google OAuth in `P1-04`).
  **Production** refuses to boot without a server key (`secret-rules.ts`).
- Development/test with no key: the fake gateway, with a per-process random signing key, so no one
  outside the process can forge a notification for it.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Forged signature | `SECURITY/07` | `valid: false, reason: signature_mismatch` | `midtrans-gateway.spec.ts` › "rejects a signature made with another key" |
| Amount tampered after signing | — | mismatch | `midtrans-gateway.spec.ts` › "rejects a notification whose amount was changed after signing" |
| Status flipped to settlement after signing | — | mismatch | "rejects a notification whose status_code was changed after signing" |
| Missing / non-string fields | — | `malformed` | "treats a notification missing … as malformed" |
| Uppercase or truncated signature | — | mismatch, constant-time | "compares signatures exactly" |
| `capture` with `fraud_status: deny` counted as paid | Midtrans | `failed` | status table test |
| Refund notification failing a paid payment | BR-5.4 | `ignored` | status table test |
| Status query response with a bad signature | `BACKEND/05` § Polling | throws, never trusted | "refuses a status response whose signature does not verify" |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit | Signature against an independently computed vector from Midtrans's documented inputs; tamper cases; status normalisation table; amount parsing; request construction (URL by key, auth header, body, customer minimisation); response handling (201, 4xx, 5xx, timeout, malformed JSON); status query (200 verified, 404 → null, bad signature); fake adapter produces valid, forged, duplicate and out-of-order notifications that its own `verifyNotification` classifies correctly |
| Structure | `payment-module-boundaries.spec.ts`: no `invitation` in `src/modules/payment`; no `midtrans` outside its adapter folder and config |
| Integration | None needed: no database. `P3-04` covers the first persisted use |

## 13. Observability

`payment.provider_call` (info), `payment.provider_error` (warn; error for non-retryable). A spike in
retryable errors is a Midtrans incident; any non-retryable is a credential problem.

## 14. Open Questions

- **Commercial terms** (ADR-012) still unconfirmed; the adapter works in sandbox regardless.
- **Midtrans sources used** (fetched 2026-09-14): HTTP(S) Notification / Webhooks
  (docs.midtrans.com/docs/https-notification-webhooks), Receiving Notifications
  (docs.midtrans.com/reference/receiving-notifications), Snap integration guide
  (docs.midtrans.com/docs/snap-snap-integration-guide), Backend integration
  (docs.midtrans.com/reference/backend-integration), Get Transaction Status
  (docs.midtrans.com/reference/get-transaction-status).
- The Snap `expiry` option was not in the fetched pages; `P3-04` should confirm it before aligning the
  Snap page's expiry with `orders.expired_at`.
