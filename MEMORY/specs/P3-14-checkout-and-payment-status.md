# P3-14 — Feature Spec: Frontend Checkout and Payment Status

Written for `P3-14 — Frontend: Checkout and Payment Status` (`TASKS/PHASE-3-ORDER-PAYMENT-PUBLISHING.md`). Saved as `MEMORY/specs/P3-14-checkout-and-payment-status.md`.

| | |
|---|---|
| **Task** | P3-14 — Frontend: Checkout and Payment Status |
| **Date** | 2026-10-17 |
| **Author** | Agent |
| **Status** | Implemented |

---

## 1. Goal

Provide a secure, unambiguous checkout experience (`/checkout/:invitationId`) and payment polling screen (`/checkout/:invitationId/payment/:orderId`) in `web-app`. Enforce the Golden Rule of Payment Security (`docs/SECURITY/07`): client UI never trusts URL query parameters (e.g. `?status=success` or `?transaction_status=settlement`), and instead polls server-authoritative status `GET /orders/:id/payment/status`. Handle WhatsApp/Instagram in-app browser quirks with detection and escape links.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/UI-UX/13-CHECKOUT-UX.md` | § Package Page, Payment Pending, Return Flow | Single package card at MVP, server-calculated total, trust badges, timeout fallback |
| `docs/UI-UX/10-CORE-COMPONENTS.md` | § PaymentStatusBanner | Status banner variants: pending/polling, success, failed, expired with retry |
| `docs/SECURITY/07-PAYMENT-SECURITY.md` | § Golden Rule, Return URL Tampering | Never trust return URL params; only signed webhooks or server polling resolve payment |
| `docs/FRONTEND/01-WEB-APP-ARCHITECTURE.md` | § Query Parameters | Client ignores status in redirect; reads only `?returning=true` for polling trigger |
| `docs/TESTING/06-DEVICE-BROWSER-TESTING.md` | § In-App Browsers | WhatsApp/IG WebViews block popups/intents; detect UA and provide escape to external browser |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-5.1 | One package and pricing tier at MVP (Rp 139.000 / 12 months) | `CheckoutPage`, server pricing `OrderService` |
| BR-5.2 | Client displays total calculated by server, never computing client-side price | `CheckoutPage` fetching `/orders` and `/invitations/:id` |
| BR-5.4 | Payment resolution strictly governed by server-side payment status | `PaymentPage` polling `/orders/:orderId/payment/status` |

## 4. API Contract

- `POST /orders`:
  - Request: `{ invitation_id: string, package_id: string, addon_ids?: string[] }`
  - Response: `{ data: { id: string, invitation_id: string, package_id: string, total_amount: number, status: string } }`
- `POST /orders/:id/payment/initiate`:
  - Request: `{ payment_method: "snap" }`
  - Response: `{ data: { payment_id: string, order_id: string, redirect_url: string, snap_token: string, status: "pending" } }`
- `GET /orders/:id/payment/status`:
  - Response: `{ data: { order_id: string, order_status: string, payment_status: string, paid_at?: string } }`

## 5. Data Model Impact

No direct frontend database changes. Consumes existing `orders`, `packages`, `payments` tables via API.

## 6. Authorization

- Endpoints `/orders`, `/orders/:id/payment/initiate`, `/orders/:id/payment/status` are JWT authenticated and scoped to `WHERE owner_id = :current_user_id`.
- Non-owner requests receive 404 from the server; client router safely handles 404 error states.

## 7. Validation and Sanitization

- Client checks invitation ownership and status before checkout.
- URL parameters (`invitationId`, `orderId`) validated as UUIDs/valid route strings.
- In-app browser detection uses safe regex patterns against `navigator.userAgent`.

## 8. State Transitions

Frontend orchestrates transitions by observing server state:
- `draft` → `pending_payment` on order creation and payment initiation.
- `pending_payment` → `paid` (success banner + redirect to publish flow).
- `pending_payment` → `failed` / `expired` (failure banner + retry CTA).

## 9. Side Effects

- Initiates Midtrans Snap pop-up or window redirect.
- Polls `GET /orders/:id/payment/status` with interval (3s), up to 60s timeout before showing "Masih diproses, kami akan kirim email konfirmasi" fallback.

## 10. Failure Modes

- Network failure during polling: Banner indicates connection retry without falsely marking order as failed.
- Timeout after 60s: Transition to non-blocking informational fallback banner.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Attacker appends `?status=success` to payment return URL | `docs/SECURITY/07` | UI ignores `status=success`, displays pending status, awaits server polling confirmation | `test/checkout.spec.tsx` › "shows the order summary without claiming success based on URL" |
| Attacker appends `?transaction_status=settlement` | `docs/SECURITY/07` | Ignored, does not display success screen | `test/checkout.spec.tsx` › "ignores any status in the URL" |
| In-app browser popup blocking | `docs/TESTING/06` | Warning banner with "Buka di Browser Lain" link | `test/in-app-browser.spec.ts` & `test/checkout.spec.tsx` |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit / Component | `test/checkout.spec.tsx`: Checkout layout, price summary, initiate payment, URL tampering protection, server status polling, timeout fallback |
| Component | `test/payment-status-banner.spec.tsx`: Pending spinner, success, failed, expired, processing fallback |
| Unit | `test/in-app-browser.spec.ts`: Detection of WhatsApp, Instagram, FB, Line, TikTok WebViews and escape URL generator |

## 13. Observability

- Console error logging for failed polling cycles and Snap SDK loading issues.
- User-facing error announcements in accessible live regions (`aria-live="polite"`).

## 14. Open Questions

None. MVP single package configuration is locked under ADR-023.
