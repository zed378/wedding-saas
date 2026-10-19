# P5-08 — Feature Spec: Manual Refund

Written **before** implementation for task `P5-08: Manual Refund` (`Spec required: Yes — payment, business rule`).

| | |
|---|---|
| **Task** | `TASKS/PHASE-5-ADMIN-PANEL.md` § P5-08 |
| **Date** | 2026-10-19 |
| **Author** | Agent |
| **Status** | Implemented |

---

## 1. Goal

Allow authorized administrators to process manual refunds for customer orders under mandatory 2FA step-up re-authentication. In a single database transaction, the order is marked `refunded`, the associated wedding invitation is demoted to `draft` (unpublishing it and purging the public cache immediately per ADR-019), lifecycle history and administrative audit rows are recorded with the required reason, and the operator is clearly informed that physical money movement is performed manually in the gateway dashboard.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/09-ADMIN-API.md` | § Order & Payment Management | `POST /admin/orders/:id/refund` requiring `{ reason }`. |
| `docs/BACKEND/05-PAYMENT-FLOW.md` | § Refund | Single transaction: order `refunded`, invitation `draft`, audit log, event enqueue. |
| `docs/PLAN/02-BUSINESS-RULES.md` | § BR-5.4 | A refund reverses access entitlement and returns invitation to `draft`. |
| `docs/PLAN/06-LIFECYCLE-STATES.md` | § Transitions | Order `paid` → `refunded`, Invitation `published`/`paid` → `draft`. |
| `MEMORY/DECISIONS.md` | ADR-019 | Authoritative resolution of status contradiction: invitation lands in `draft`, not `paid`. |
| `docs/SECURITY/03-AUTHENTICATION-SECURITY.md` | § Admin Re-authentication | High-risk actions require step-up 2FA re-authentication. |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-Admin.1 | Gated to `admin` and `super_admin` roles. | `requireRole('admin', 'super_admin')` |
| BR-Admin.3 | Mandatory non-empty reason (min 5 chars) recorded in audit log and status history. | `adminOrderRefundSchema` & `AdminOrdersService.refundOrder` |
| BR-Admin.4 | 2FA step-up re-authentication required for manual refunds. | `StepUpGuard` (`X-MFA-Step-Up` or `step_up_code`) |
| BR-5.4 & ADR-019 | Refund demotes invitation from any state (including `published`) directly to `draft`. | `AdminOrdersService.refundOrder` |
| BR-3.4 | A refunded published invitation stops being publicly reachable immediately from cache and origin. | `PublicInvitationCache.invalidate()` & queue event |
| BR-Payment.4 | Physical money movement mode explicitly indicated as manual in UI and API response. | `AdminOrdersService` & `OrdersPage.tsx` |

## 4. API Contract

### Endpoint
- `POST /api/v1/admin/orders/:id/refund`
  - Auth: `requireAuth()`, `requireRole('admin', 'super_admin')`, `StepUpGuard`
  - Headers: `X-MFA-Step-Up?: string` (valid 10-minute step-up token)
  - Body:
    ```json
    {
      "reason": "Customer cancellation within 24h grace window per support ticket #4921",
      "step_up_code": "123456" // optional if X-MFA-Step-Up header is provided
    }
    ```
  - Success Response: 200 OK
    ```json
    {
      "success": true,
      "data": {
        "orderId": "33333333-3333-4333-8333-333333333331",
        "status": "refunded",
        "invitationId": "22222222-2222-4222-8222-222222222221",
        "invitationStatus": "draft",
        "moneyMovement": "manual",
        "message": "Pesanan berhasil direfund di sistem dan status undangan dikembalikan ke draft. Pengembalian uang riil ke rekening/e-wallet pelanggan wajib diproses manual melalui dashboard gateway pembayaran (Midtrans)."
      }
    }
    ```
  - Error Cases:
    - 400 `VALIDATION_ERROR`: `reason` missing or shorter than 5 characters.
    - 401 `UNAUTHENTICATED`: missing or invalid session bearer token.
    - 403 `FORBIDDEN` / `MFA_STEP_UP_REQUIRED`: caller is not admin or step-up factor is missing/invalid.
    - 404 `NOT_FOUND`: order not found.
    - 409 `ORDER_NOT_PAID`: order status is not `paid` (e.g. already `refunded` or still `pending`).

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `orders` | Read & Write | Checks `status = 'paid'`; updates `status = 'refunded'`, `updated_at = now()`. |
| `invitations` | Read & Write | Reads current status; updates `status = 'draft'`, `updated_at = now()`. |
| `invitation_status_history` | Write | Records transition from previous status to `draft` with admin ID and reason. |
| `audit_logs` | Write | Records `order.refund` action with actor ID, reason, before/after states. |
| `payment_notifications` | Read | Correlated records preserved for timeline evidence. |

Migration required: No.

## 6. Authorization & Step-Up Security

- Execution requires two authentication checks:
  1. Valid administrator session (`requireAuth()`, `requireRole('admin', 'super_admin')`).
  2. Verified second factor (`StepUpGuard`): either a valid 10-minute step-up ticket in `X-MFA-Step-Up` or a live 6-digit TOTP code in `body.step_up_code`.
- Prevents stolen session tokens from executing unauthorized financial refunds.

## 7. Abuse Cases

| Abuse case | Expected behavior | Test |
|---|---|---|
| Regular user attempts refund | HTTP 403 Forbidden | `rejects regular user requests with 403` |
| Admin attempts refund without 2FA step-up factor | HTTP 403 `MFA_STEP_UP_REQUIRED` | `refuses refund when 2FA step-up is missing` |
| Admin attempts refund with empty reason | HTTP 400 `VALIDATION_ERROR` | `refuses refund without valid reason` |
| Attempting to refund an unpaid order (`pending`, `failed`, `expired`) | HTTP 409 `ORDER_NOT_PAID` | `refuses refund for unpaid order` |
| Attempting to refund an already refunded order | HTTP 409 `ORDER_NOT_PAID` | `refuses refund for already refunded order` |
| Published invitation refund | Invitation immediately demoted to `draft`, public cache purged | `demotes published invitation to draft and invalidates cache` |

## 8. Test Plan

- Backend integration tests in `backend/api/test/admin-orders.spec.ts`.
- Frontend UI tests in `admin/src/pages/orders.spec.tsx`.
