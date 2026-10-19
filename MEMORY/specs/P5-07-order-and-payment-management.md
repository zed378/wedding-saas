# P5-07 — Feature Spec: Order and Payment Management

Written **before** implementation for task `P5-07: Order and Payment Management` (`Spec required: Yes — payment`).

| | |
|---|---|
| **Task** | `TASKS/PHASE-5-ADMIN-PANEL.md` § P5-07 |
| **Date** | 2026-10-19 |
| **Author** | Agent |
| **Status** | Implemented |

---

## 1. Goal

Provide support staff and platform administrators with complete operational visibility into customer orders, payment attempts, and transaction timelines to diagnose stuck payments, investigate gateway webhooks, and surface signature validation failures (fraud signals) without direct database access, while strictly redacting sensitive raw payloads by default and reserving raw log inspection to `super_admin` under sensitive data access auditing.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/09-ADMIN-API.md` | § Order & Payment Management | Endpoints: `GET /orders`, `GET /orders/:id`, `GET /payments/:id/raw-log`. Sensitive data access logging. |
| `docs/PLAN/12-ADMIN-PANEL.md` | § Modules (Order & Payment) | Order list with status filter, payment detail, raw callback log for debugging, payment timeline. |
| `docs/SECURITY/07-PAYMENT-SECURITY.md` | § Logging & Redaction | Redact sensitive financial data; never log or return card numbers or provider secrets. |
| `docs/DATABASE/08-PAYMENTS.md` | § payments & payment_notifications | Data model for payment attempts and notifications (including forged callbacks). |
| `docs/DEVOPS/07-INCIDENT-RESPONSE.md` | § Payment Fraud Signals | Surface failed signature verifications as fraud alerts. |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-Admin.1 | All admin routes role-gated to `admin` and `super_admin`. | `requireRole('admin', 'super_admin')` guard |
| BR-Admin.2 | Raw callback payload inspection strictly restricted to `super_admin` and audited as sensitive data access. | `AdminPaymentsController` (`GET :id/raw-log`) |
| BR-Payment.1 | Prices and order totals are immutable snapshots stored in `orders.amount_total`. | `AdminOrdersService` |
| BR-Payment.2 | Signature verification status tracked; signature mismatch is flagged as a fraud alert. | `AdminOrdersService.getOrder` (`hasFraudAlert`) |
| BR-Payment.3 | Provider server keys, webhook secrets, and full card details are never exposed. | Response DTO whitelist |

## 4. API Contract

### Endpoints
- `GET /api/v1/admin/orders?status=&search=&page=&limit=`
  - Auth: `requireRole('admin', 'super_admin')`
  - Query:
    - `status`: optional `'all' | 'pending' | 'paid' | 'failed' | 'expired' | 'refunded'`
    - `search`: optional string (searches order ID, user email, or invitation slug)
    - `page`: int >= 1 (default 1)
    - `limit`: int 1..100 (default 20)
  - Success: 200 `{ data: OrderSummaryItem[], meta: PageMeta }`
  - Per item: `id`, `invitationId`, `userId`, `packageId`, `addonIds`, `amountTotal`, `status`, `orderType`, `userEmail`, `userFullName`, `invitationSlug`, `createdAt`, `expiredAt`, `paymentCount`.
- `GET /api/v1/admin/orders/:id`
  - Auth: `requireRole('admin', 'super_admin')`
  - Success: 200 `{ data: OrderDetailItem }`
  - Detail item contains:
    - Order fields: `id`, `invitationId`, `userId`, `packageId`, `addonIds`, `amountTotal`, `status`, `orderType`, `createdAt`, `updatedAt`, `expiredAt`
    - Customer fields: `user: { id, email, fullName, phone }`
    - Invitation fields: `invitation: { id, slug, internalName }`
    - Payments list (`payments` rows): `id`, `provider`, `providerReferenceId`, `method`, `amount`, `status`, `signatureValid`, `verifiedAt`, `createdAt` (no `rawCallbackPayload`)
    - Notifications & Timeline list (`payment_notifications` rows): `id`, `source`, `provider`, `claimedReference`, `signatureValid`, `rejectionReason`, `outcome`, `providerStatus`, `amount`, `result`, `needsReview`, `receivedAt`, `processedAt`
    - Fraud alert flag: `hasFraudAlert: boolean`
    - Invoice summary (if available): `invoice: { number, generatedAt } | null`
  - 404 if order not found.
- `GET /api/v1/admin/payments/:id/raw-log`
  - Auth: `requireRole('super_admin')`
  - Success: 200 `{ data: { payment_id, order_id, provider, raw_callback_payload, ... } }`
  - Side effect: writes `audit_logs` row and logs `admin.sensitive_data_access`.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `orders` | Read | Filtered query for list, lookup by id for detail. |
| `users` | Read | Joined for email and name. |
| `invitations` | Read | Joined for slug and internalName. |
| `payments` | Read | Listed under order for payment attempts. |
| `payment_notifications` | Read | Queried by order payment IDs or claimed reference to construct timeline. |
| `invoices` | Read | Checks if invoice was issued for order. |
| `audit_logs` | Write | Logged when raw payment log is inspected. |

Migration required: No.

## 6. Authorization

- **Who may call this**: Users with role `admin` or `super_admin`. Regular users receive HTTP 403 Forbidden.
- **Raw Log Access**: Users with role `super_admin` only. Admins with `role: 'admin'` receive HTTP 403 Forbidden.
- **Privacy & Secret Redaction**: No endpoint ever returns `MIDTRANS_SERVER_KEY`, webhook signature secrets, or raw banking passwords.

## 7. Abuse Cases

| Abuse case | Expected behavior | Test |
|---|---|---|
| Regular user requests orders list or detail | HTTP 403 Forbidden | `rejects regular user requests with 403` |
| Regular admin attempts to access raw payment payload | HTTP 403 Forbidden | Covered in `admin-payments.spec.ts` |
| Forged callback notification received | Timeline surfaces signature mismatch with fraud warning badge | `surfaces fraud signal on signature mismatch` |
| Detail request for non-existent order | HTTP 404 Not Found | `returns 404 for unknown order` |
| Credential leak in response | Strict whitelist ensures no secrets exist in payload | `never exposes provider secrets or credentials` |

## 8. Test Plan

- Backend unit and integration tests in `backend/api/test/admin-orders.spec.ts`.
- Frontend UI tests in `admin/src/pages/orders.spec.tsx`.
