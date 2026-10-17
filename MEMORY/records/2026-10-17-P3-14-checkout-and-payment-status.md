# P3-14 — Frontend: Checkout and Payment Status

| | |
|---|---|
| **Date** | 2026-10-17 |
| **Task** | `TASKS/PHASE-3-ORDER-PAYMENT-PUBLISHING.md` § P3-14 |
| **Phase** | Phase 3 |
| **Surface** | web-app |
| **Author** | Agent |
| **Commits / PR** | P3-14 |
| **Status** | Completed |

---

## What Changed

Implemented the checkout flow (`/checkout/:invitationId`) and payment polling screen (`/checkout/:invitationId/payment/:orderId`) in `web-app`. Enforced the Golden Rule of Payment Security (`docs/SECURITY/07`): the UI completely ignores URL query parameters (such as `?status=success` or `?transaction_status=settlement`), relying strictly on server-authoritative status polling (`GET /orders/:id/payment/status`). Built `PaymentStatusBanner` covering all UX states from `docs/UI-UX/10`, a 60-second polling timeout fallback per `docs/UI-UX/13`, and in-app browser detection with an external browser escape link to resolve WebView pop-up blocking issues in WhatsApp and Instagram.

## Why

Required by Phase 3 roadmap (`docs/PLAN/16`) and `docs/UI-UX/13`. In client-side payment UX, tampered return URLs are an immediate threat vector if client code relies on redirect parameters to declare success. Furthermore, in Indonesia, users overwhelmingly access invitations through WhatsApp/Instagram in-app browsers, where WebView restrictions frequently suppress payment gateway popups (Midtrans Snap) and redirect intents.

## How

- Built `CheckoutPage` (`frontend/web-app/src/app/(app)/checkout/[invitationId]/page.tsx`):
  - Informs the user of the single MVP tier (Rp 139.000 / 12 months) per ADR-023.
  - Displays the server-calculated total price.
  - Shows bank and payment partner badges (QRIS, BCA, Mandiri, BNI, BRI, Visa/Mastercard) as trust signals.
  - Dispatches `POST /orders` and `POST /orders/:id/payment/initiate`.
- Built `PaymentPage` (`frontend/web-app/src/app/(app)/checkout/[invitationId]/payment/[orderId]/page.tsx`):
  - Polls `GET /orders/:id/payment/status` every 3 seconds up to 60 seconds.
  - Ignores all query parameters except `?returning=true`, which triggers immediate polling.
  - Triggers transition to `paid` state only when the API responds with `payment_status === 'success'`.
  - When polling exceeds 60 seconds without settlement, displays an informational fallback: *"Pembayaran masih diproses. Kami akan mengirimkan konfirmasi ke email Anda segera setelah pembayaran berhasil diverifikasi"* with a manual retry button.
- Built `PaymentStatusBanner` (`frontend/web-app/src/components/PaymentStatusBanner.tsx`):
  - Accessible banner with `role="status"` and `aria-live="polite"`.
  - Visual variants for `checking`, `success`, `failed`, `expired`, and `processing_fallback`.
- Built `in-app-browser.ts` (`frontend/web-app/src/lib/in-app-browser.ts`):
  - Detects WhatsApp, Instagram, Facebook, Line, and TikTok WebViews via regex against `navigator.userAgent`.
  - Generates external browser escape links.
  - Displays an alert banner prompting users to switch to Chrome or Safari to avoid gateway popup blockage.

## Files and Components Touched

| Path | Change |
|---|---|
| `frontend/web-app/src/app/(app)/checkout/[invitationId]/page.tsx` | Checkout overview page, package card, price display, payment trigger |
| `frontend/web-app/src/app/(app)/checkout/[invitationId]/payment/[orderId]/page.tsx` | Payment polling page, URL tampering protection, 60s timeout |
| `frontend/web-app/src/components/PaymentStatusBanner.tsx` | Status banner component for all payment states |
| `frontend/web-app/src/lib/in-app-browser.ts` | In-app browser detection and external browser escape utility |
| `frontend/web-app/test/checkout.spec.tsx` | Vitest tests for checkout, URL tampering resistance, polling, and timeout |
| `frontend/web-app/test/payment-status-banner.spec.tsx` | Tests for all banner states and accessibility |
| `frontend/web-app/test/in-app-browser.spec.ts` | Unit tests for WebView detection and escape schemes |
| `MEMORY/specs/P3-14-checkout-and-payment-status.md` | Feature specification |
| `MEMORY/DECISIONS.md` | ADR-084: URL parameter disregard, server-authoritative polling, in-app browser escape |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Never read `status` query param from payment return URL | Golden Rule of Payment Security (`docs/SECURITY/07`): client redirect parameters are fully untrusted | ADR-084 |
| 60-second polling timeout fallback | Avoids infinite spinners while giving the user clear reassurance that background webhooks will process the order | ADR-084 |
| In-app browser detection and escape banner | WhatsApp/Instagram WebViews block gateway popups; escape link solves the Indonesian conversion blocker | ADR-084 |

## Deviations from `docs/`

None. All implementations conform to `docs/UI-UX/13`, `docs/UI-UX/10`, and `docs/SECURITY/07`.

## Tests Added

| Layer | What it covers |
|---|---|
| Unit | `test/in-app-browser.spec.ts` (12 tests): WhatsApp, Instagram, FB, Line, TikTok user-agent detection, escape scheme formatting |
| Component | `test/payment-status-banner.spec.tsx` (12 tests): Banner rendering, status colors, accessible ARIA live regions |
| Integration / Component | `test/checkout.spec.tsx` (14 tests): Package display, server price, initiate checkout, URL tampering resistance (`?status=success` does not trigger success), server status polling, 60s timeout fallback, in-app browser warning banner |

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Payment status server-decided only | `docs/SECURITY/07` | `test/checkout.spec.tsx` › "shows the order summary without claiming success based on URL" & "shows success ONLY after server confirms payment_status === 'success'" |
| URL parameter tampering resistance | `docs/SECURITY/07` | `test/checkout.spec.tsx` › "ignores any status in the URL" |
| In-app browser popup containment | `docs/TESTING/06` | `test/in-app-browser.spec.ts` › "detects WhatsApp in-app browser" & `test/checkout.spec.tsx` › "shows in-app browser warning when opened inside WhatsApp" |

## Abuse Cases Covered

| Abuse case | Source | Test |
|---|---|---|
| Tampered return URL with `?status=success` or `?transaction_status=settlement` | `docs/SECURITY/07` | `test/checkout.spec.tsx` › "shows the order summary without claiming success based on URL" |
| Bogus payment query parameters injected by attacker | `docs/SECURITY/07` | `test/checkout.spec.tsx` › "ignores any status in the URL" |

## Definition of Done Verification

- [x] Tests at the appropriate pyramid layer — 38 tests across 3 test files in `web-app`.
- [x] IDOR test for every new `:id` endpoint — N/A (frontend task; backend endpoints already covered in P3-04 & P3-06).
- [x] Every abuse case has an automated test — URL tampering tested in `test/checkout.spec.tsx`.
- [x] Write endpoints whitelist their fields — N/A (consumed existing API).
- [x] Free-text input sanitized before storage — N/A (no free-text inputs in checkout).
- [x] Response envelope matches `docs/API/00` — Tested against API client envelopes.
- [x] State transitions logged (`invitation_status_history` / `audit_logs`) — N/A (handled server-side).
- [x] Nothing sensitive logged — No secrets or payment credentials logged.
- [x] CI green: lint, types, build, unit, integration, dependency audit, SAST — `pnpm typecheck` passed (19/19 packages), `web-app` vitest passed (24/24 files, 391 tests), 5 security check scripts passed.
- [x] `TASKS/PROGRESS.md` and the phase file updated — Completed.
- [x] Task-specific DoD items:
  - [x] The URL contains no status the UI reads; a test with a tampered `?status=success` shows no success state.
  - [x] Payment status is never ambiguous, satisfying `docs/UI-UX/18`.
  - [x] The polling fallback appears after the timeout rather than spinning forever.
  - [x] Checkout completes inside a WhatsApp in-app browser or offers a working escape.

## What Did Not Work

- Next.js 16 dynamic route params in Vitest: Passing unresolved promises as props in test fixtures caused unhandled pending suspense cycles. Wrapped params resolution in `React.use()` with a synchronous fallback check (`"then" in params ? use(params) : params`) to support both Next.js 16 runtime and Vitest unit testing.
- `useRouter` mocking in Vitest: Overriding `useRouter().push` via multiple `vi.mocked` overrides led to mock registration conflicts across tests. Solved by defining a shared mock router object and using `.mockClear()`.

## Follow-Ups and Open Questions

None. Ready to proceed to `P3-15 — Frontend: Publish Flow and Share Screen`.

## What to Watch

- Watch checkout drop-off rate via analytics: if users in Instagram/WhatsApp drop off at the payment initiation step, the in-app escape modal wording may need additional prominent placement.
