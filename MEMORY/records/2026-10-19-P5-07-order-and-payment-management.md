# Change Record: P5-07 Order and Payment Management

| | |
|---|---|
| **Task** | `P5-07` — Order and Payment Management |
| **Date** | 2026-10-19 |
| **Author** | Agent |
| **Status** | Complete |

---

## 1. Summary

Implemented the administrative order and payment management module across backend API and admin frontend:
- **Backend API**:
  - `GET /api/v1/admin/orders`: List orders with search (order ID, email, invitation slug), status filter (`all`, `pending`, `paid`, `failed`, `expired`, `refunded`), and `PageMeta` pagination (`page`, `per_page`, `total`). Whitelisted fields strictly exclude provider secrets and raw payloads.
  - `GET /api/v1/admin/orders/:id`: Detail view assembling order summary, customer profile, associated invitation, payment attempts from `payments` (redacting `rawCallbackPayload`), chronological webhook/query notifications from `payment_notifications`, invoice data, and explicit fraud warning flag `hasFraudAlert`.
  - `GET /api/v1/admin/payments/:id/raw-log`: Separately gated to `super_admin` only, recording `admin.sensitive_data_access` security logs and audit log row upon inspection (DoD 2).
- **Payment Invariants & Fraud Signals**:
  - Automatically identifies signature mismatches and unverified callbacks in `payment_notifications`, surfacing a prominent security warning banner when `hasFraudAlert` is true without exposing provider keys.
  - Makes stuck payments diagnosable directly from the panel by rendering the full timeline of attempts, provider statuses (`settlement`, `pending`), and transition results (`applied`, `ignored`, `reconciliation_mismatch`).
- **Admin Frontend (`OrdersPage.tsx`)**:
  - Interactive table with status badges and ID formatting.
  - Filter by status and instant query search.
  - Comprehensive detail drawer displaying customer details, invitation link, gateway attempts, and chronological notification timeline.
  - Super admin raw callback viewer modal.

---

## 2. Files Changed

### Backend API
- `backend/api/src/modules/admin/schemas/admin-order.schema.ts` — Query schema with validation and pagination defaults.
- `backend/api/src/modules/admin/admin-orders.service.ts` — Implemented list, detail, fraud detection, and payment notification aggregation.
- `backend/api/src/modules/admin/admin-orders.controller.ts` — Role-gated controller (`requireRole('admin', 'super_admin')`).
- `backend/api/src/modules/admin/admin.module.ts` — Registered `AdminOrdersController` and `AdminOrdersService`.
- `backend/api/test/idor-sweep-inventory.spec.ts` — Registered `GET /api/v1/admin/orders/:id` exemption pointing to `admin-orders.spec.ts`.
- `backend/api/test/admin-orders.spec.ts` — Comprehensive unit and integration test suite (9/9 passing).

### Admin Frontend
- `admin/src/pages/OrdersPage.tsx` — Complete Order and Payment Management interface.
- `admin/src/pages/orders.spec.tsx` — Test suite for order list, filter, detail, and fraud warning banner (5/5 passing).

### Documentation & Memory
- `MEMORY/specs/P5-07-order-and-payment-management.md` — Feature specification written before implementation.
- `MEMORY/DECISIONS.md` — Added ADR-102.
- `MEMORY/MEMORY-INDEX.md` — Added index entry.
- `MEMORY/CHANGELOG.md` — Added changelog summary.
- `TASKS/PROGRESS.md` — Updated counts (104 / 140 done, Phase 5: 7 / 14 done).
- `TASKS/PHASE-5-ADMIN-PANEL.md` — Marked P5-07 as DONE.

---

## 3. Decisions & Deviations

See **ADR-102** in `MEMORY/DECISIONS.md`.
- **Default Redaction of Raw Callbacks**: Standard detail view omits `rawCallbackPayload` from `payments` records, satisfying DoD 1. Only `super_admin` accessing the dedicated raw-log endpoint receives the unredacted payload.
- **Surfacing Fraud Signal via Timeline**: Rather than hiding failed webhook callbacks, forged callbacks are surfaced in the timeline with signature invalidity and prominent warning banners to facilitate support triage.

---

## 4. Test Verification

- `backend/api/test/admin-orders.spec.ts`: 9/9 passing tests.
  - 401 unauthenticated, 403 regular user, 200 admin.
  - Status filtering (`status=paid`).
  - Search filtering (`search=budi`).
  - Secret redaction (no server keys, client keys, or raw callback payloads in order list or detail).
  - Fraud alert surfacing on signature mismatch in timeline.
  - 404 for non-existent order.
- `admin/src/pages/orders.spec.tsx`: 5/5 passing tests.
  - Render list, search filter, status filter, detail drawer, and fraud alert banner.
- Repo Guards:
  - `node scripts/check-sanitized-fields.mjs`: PASSED.
  - `node scripts/check-secrets.mjs`: PASSED.
  - `node scripts/check-id-endpoint-tests.mjs`: PASSED.
  - `pnpm typecheck`: PASSED (19/19 packages clean).
  - `pnpm --filter @wi/admin build`: PASSED.

---

## 5. Security Controls Verified

| Control | Document | Proven by test |
|---|---|---|
| Admin Role Gating | `docs/SECURITY/04` | `admin-orders.spec.ts` > `rejects regular user requests with 403 Forbidden` |
| Sensitive Data Access Gating & Redaction | `docs/SECURITY/07` | `admin-orders.spec.ts` > `never exposes provider secrets or credentials in order list` & `returns order detail with payments and timeline` |
| Fraud Signal Detection on Forged Webhooks | `docs/DEVOPS/07` | `admin-orders.spec.ts` > `surfaces fraud alert flag when fake notification has signature mismatch (DoD 4)` |
