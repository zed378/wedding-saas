# Change Record: P5-08 Manual Refund

| | |
|---|---|
| **Task** | `P5-08` — Manual Refund |
| **Date** | 2026-10-19 |
| **Author** | Agent |
| **Status** | Complete |

---

## 1. Summary

Implemented the administrative manual refund flow across backend API and admin frontend per ADR-019 and BR-5.4:
- **Backend API**:
  - `POST /api/v1/admin/orders/:id/refund`: Secured by `requireAuth()`, `requireRole('admin', 'super_admin')`, and `StepUpGuard` requiring fresh 2FA re-authentication (either via `X-MFA-Step-Up` header or `step_up_code` in request body).
  - Validation requires a mandatory reason of 5 to 500 characters.
  - Only orders in `paid` status can be refunded (other statuses throw `409 ConflictError('ORDER_NOT_PAID')`).
- **Atomic State Transitions & Entitlement Invariants (ADR-019 & BR-5.4)**:
  - Updates order status to `refunded`.
  - Reverses invitation entitlement by resetting invitation status to `draft` (unpublishing the invitation).
  - Inserts record into `invitation_status_history` capturing `fromStatus` -> `draft` with admin attribution and reason.
  - Inserts record into `audit_logs` capturing `order.refund` action with `beforeState` and `afterState`.
  - Immediately purges public invitation edge/Redis cache via `PublicInvitationCache.invalidate()` and enqueues background `cache.invalidate` job if previously published.
- **Explicit Manual Money Movement Notice**:
  - To prevent operator confusion, the response and frontend UI explicitly clarify that database refund does not automatically initiate banking/gateway disbursements; actual customer fund transfers must be executed manually via the payment gateway (Midtrans).
- **Admin Frontend (`OrdersPage.tsx`)**:
  - Added "Refund" action buttons on paid orders in table and inside order detail modal footer.
  - Confirmation modal featuring prominent ADR-019 entitlement revocation and manual money movement warnings.
  - Real-time validation requiring reason (>= 5 chars) and 2FA TOTP code.

---

## 2. Files Changed

### Backend API
- `backend/api/src/modules/admin/schemas/admin-order.schema.ts` — Added `adminOrderRefundSchema`.
- `backend/api/src/modules/admin/admin-orders.service.ts` — Implemented `refundOrder` with atomic transaction, lock, audit, history, and cache purging.
- `backend/api/src/modules/admin/admin-orders.controller.ts` — Mounted `POST :id/refund` route with `StepUpGuard`.
- `backend/api/src/modules/auth/mfa/step-up.guard.ts` — Verified step-up token and direct body TOTP code verification with `maybeCurrentUser`.
- `backend/api/src/modules/auth/auth.module.ts` — Exported `StepUpGuard`.
- `backend/api/test/idor-sweep-inventory.spec.ts` — Registered `POST /api/v1/admin/orders/:id/refund` exemption.
- `backend/api/test/admin-orders.spec.ts` — Added 8 integration tests covering authorization, 2FA step-up, validation, status conflict, and successful ADR-019 execution (17/17 passing).

### Admin Frontend
- `admin/src/pages/OrdersPage.tsx` — Added refund action buttons, state management, and modal with warnings and 2FA input.
- `admin/src/pages/orders.spec.tsx` — Added test suite covering refund modal opening, validation button disabling, and API submission (8/8 passing).

### Documentation & Memory
- `MEMORY/specs/P5-08-manual-refund.md` — Feature specification written before implementation.
- `MEMORY/DECISIONS.md` — Added ADR-103.
- `MEMORY/MEMORY-INDEX.md` — Added index entry.
- `MEMORY/CHANGELOG.md` — Added changelog summary.
- `TASKS/PROGRESS.md` — Updated counts (105 / 140 done, Phase 5: 8 / 14 done).
- `TASKS/PHASE-5-ADMIN-PANEL.md` — Marked P5-08 as DONE.

---

## 3. Decisions & Deviations

See **ADR-103** in `MEMORY/DECISIONS.md`.
- **Reset to Draft (ADR-019)**: Refunding a paid order irrevocably revokes publication privileges, resetting the invitation status to `draft` and invalidating cache immediately.
- **Dual Step-Up Verification**: `StepUpGuard` accepts either a cached step-up JWT token (`X-MFA-Step-Up`) or a fresh 6-digit TOTP code directly in the refund payload (`step_up_code`).

---

## 4. Test Verification

- `backend/api/test/admin-orders.spec.ts`: 17 passed.
- `backend/api/test/idor-sweep-inventory.spec.ts`: 3 passed.
- `admin/src/pages/orders.spec.tsx`: 8 passed.
- `pnpm --filter @wi/admin test`: 38 passed.
- `pnpm --filter @wi/admin build`: Success.
- `pnpm typecheck`: 19/19 packages passed.
- Scripts: `check-sanitized-fields.mjs`, `check-secrets.mjs`, `check-id-endpoint-tests.mjs` all passed.
