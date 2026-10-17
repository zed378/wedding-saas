# P3-13 — Feature Spec: Invitation Expiry Job, Renewal, and Retention Chain

| | |
|---|---|
| **Task** | `P3-13` |
| **Date** | 2026-10-17 |
| **Author** | Antigravity |
| **Status** | Draft |

---

## 1. Goal

Invitations expire on an automated schedule (daily at 00:05 WIB) rather than mid-request, transitioning `published` invitations past their `expiry_date` to `expired` with status history, cache eviction, and owner notification. When an order with `order_type = 'renewal'` becomes `paid`, `expiry_date` is extended from `GREATEST(expiry_date, now() in WIB)` by the purchased package duration, restoring `published` status if the invitation had expired. Expired invitations show the friendly "invitation has ended" page to guests while the API returns an undifferentiated 404. Finally, the retention lifecycle from BR-9 and ADR-055/P1-19 runs daily (01:00 WIB) to soft-delete invitations expired for 90 days, hard-delete invitations soft-deleted for 30 days (purging all user media from storage), and permanently remove individually soft-deleted media files past their 7-day grace period.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/BACKEND/06-PUBLISHING.md` | § Expiry Check & Renewal | Daily expiry SQL query; renewal logic extending `GREATEST(expiry_date, now())` + package duration; restores `published` from `expired`. |
| `docs/PLAN/02-BUSINESS-RULES.md` | § BR-2.6, BR-2.8, BR-9.1 | `published` past `expiry_date` becomes `expired`; trial expires identically; 90 days expired without renewal -> soft-delete, then hard-delete after 30 days. |
| `docs/PLAN/06-INVITATION-LIFECYCLE.md` | § State Machine & Transition Rules | `published → expired` by SYSTEM via daily job, never on-the-fly; `expired → published` by SYSTEM upon renewal; `expired → soft_deleted` after 90 days; hard deletion outcome. |
| `docs/BACKEND/08-JOBS-WORKERS.md` | Scheduled Jobs | `invitation_expiry_check` (daily 00:05 WIB) and `invitation_soft_delete_cleanup` (daily 01:00 WIB). Domain jobs consumed by API's jobs process (`api-jobs`) per ADR-078. |
| `docs/ARCHITECTURE/05-STORAGE-ARCHITECTURE.md` | § Quota & Lifecycle | Files associated with hard-deleted invitations removed via async job from `user-media`. |
| `docs/PLAN/11-MEDIA-ASSET-MANAGEMENT.md` | § Deletion | Gallery photos soft-deleted on removal are physically purged from storage and DB after a 7-day grace period. |
| `docs/UI-UX/14-PUBLIC-INVITATION-UX.md` | § Special States | Expired/not found shows friendly fallback page, not a technical error. |
| `docs/API/08-PUBLIC-INVITATION-API.md` | Error Handling | Returns undifferentiated 404 without leaking status reason ("never published" vs "expired" vs "unpublished"). |
| ADR-055, ADR-077, ADR-078, ADR-081, ADR-082 | Decisions | Renewal orders marked paid without touching invitation in P3-05 must now be applied; domain jobs consumed by API; cache invalidation on expiry/renewal. |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-2.6 | A `published` invitation passing `expiry_date` becomes `expired` | `InvitationExpiryService.expireOverdueInvitations()` (daily job) |
| BR-2.8 | Free trial expires identically to paid invitations | `InvitationExpiryService.expireOverdueInvitations()` (reads `expiry_date` regardless of trial/paid) |
| BR-06 § Renewal | Renewal extends `GREATEST(expiry_date, now())` by package duration and restores `published` | `OrderService.settlePaid` / `InvitationRenewalService.applyRenewal()` |
| BR-9.1 | 90 days expired without renewal → soft-delete, then hard-delete after 30 days | `InvitationRetentionService.sweep()` (`invitation_soft_delete_cleanup`) |
| PLAN/11 § Deletion | Removed gallery photos purged from storage after 7 days | `InvitationRetentionService.cleanupOrphanedMedia()` |

## 4. API Contract

No new public endpoints.
- `GET /public/invitations/:slug`: continues to query `WHERE slug = :slug AND status = 'published' AND deleted_at IS NULL`. For an expired invitation, returns 404 (undifferentiated).
- Public invitation frontend: renders `not-found.tsx` ("Undangan tidak tersedia") with friendly tone.
- `POST /invitations/:id/orders`: already creates renewal orders (`order_type = 'renewal'`) when invitation status is `published` or `expired`.

## 5. Data Model Impact

No schema migrations required. Uses existing tables and columns:
- `invitations`: `status`, `expiry_date`, `published_at`, `deleted_at`, `updated_at`.
- `invitation_status_history`: records status transitions with actor `SYSTEM` (`user_id = null`).
- `orders`: `order_type`, `package_id`, `status`.
- `packages`: `duration_months`.
- `media`: `deleted_at`, `storage_path`, `invitation_id`.

## 6. Authorization

- Expiry and retention jobs run under the `SYSTEM` actor (`userId: null`), which is permitted by `InvitationStatusService` for `published → expired`, `expired → published`, and `expired → soft_deleted`.
- Renewal application is triggered by verified payment callbacks or reconciliation, which run under `SYSTEM`.
- Tenant isolation: All queries in jobs target explicitly identified rows or batch by specific predicates without leaking across tenant boundaries.

## 7. State Transitions

1. **Daily Expiry Sweep (`invitation_expiry_check`)**:
   - Precondition: `status = 'published' AND expiry_date < (now() AT TIME ZONE 'Asia/Jakarta')::date AND deleted_at IS NULL`.
   - Transition: `published → expired` by `SYSTEM`.
   - Side effect: Status history recorded, cache invalidated immediately, `notification.send` event (`invitation_expired`) enqueued.

2. **Renewal on Payment Confirmed (`order.paid`)**:
   - Precondition: `order.status = 'paid' AND order.order_type = 'renewal'`.
   - Expiry extension: `expiry_date = GREATEST(expiry_date, (now() AT TIME ZONE 'Asia/Jakarta')::date) + duration_months`.
   - Transition: if `status === 'expired'`, transition `expired → published` by `SYSTEM`. If already `published`, status remains `published`.
   - Side effect: Status history recorded (if status changed), cache invalidated, renewal confirmation notification enqueued.

3. **Retention Sweep (`invitation_soft_delete_cleanup`)**:
   - Step A: `expired` invitations with no renewal for >= 90 days → transition `expired → soft_deleted` by `SYSTEM`, set `deleted_at = now()`.
   - Step B: `soft_deleted` invitations past 30 days → hard delete from database (cascades to child tables) and purge all storage objects under `user-media/invitations/{id}/`.
   - Step C: Individually soft-deleted media rows (`deleted_at < now() - interval '7 days'`) → delete physical objects (`thumbnail`, `medium`, `large` variants) from `user-media`, delete `media` rows from database.

## 8. Failure Modes & Idempotency

- **Idempotency**:
  - `invitation_expiry_check`: predicate `status = 'published' AND expiry_date < ...` ensures already expired rows are not processed again.
  - Renewal: `settlePaid` executes inside a serializable/row-locked transaction; duplicate deliveries return `duplicate_charge` without extending dates twice.
  - Retention: `soft_deleted` only selects `expired` > 90 days; hard delete removes rows permanently; storage deletion is idempotent.
- **Fail-Open/Closed**:
  - Redis error during cache invalidation fails open (logs warning, does not fail expiry/renewal transaction).
  - Storage deletion failures during cleanup are caught and logged so individual file errors do not abort the database transaction.

## 9. Observability & Metrics

- Metrics:
  - `wi_invitations_expired_total`: counter for invitations expired by the sweep.
  - `wi_invitations_renewed_total`: counter for renewals applied.
  - `wi_invitations_soft_deleted_total`: counter for invitations soft-deleted by retention.
  - `wi_invitations_hard_deleted_total`: counter for invitations permanently removed.
  - `wi_media_orphans_cleaned_total`: counter for orphaned media files purged.
- Structured Pino logging for all sweeps and transitions.

## 10. Test Plan

1. **Unit Tests**:
   - `InvitationExpiryService`: expires published past date, ignores future expiry date, ignores unpublished.
   - `OrderService` / Renewal: extends future expiry date by N months; extends past expiry date from today; restores `expired → published`; leaves `published` status intact.
   - `InvitationRetentionService`: 90-day soft delete, 30-day hard delete + storage purge, 7-day media purge.
2. **Integration Tests (`backend/api/test/integration/`)**:
   - `invitation-expiry.itest.ts`: Real Postgres + Redis test verifying:
     - Scheduled job expires published invitations past expiry date and writes status history.
     - Cache is invalidated and subsequent public request returns 404.
     - Renewal payment extends date from `GREATEST` and restores `published`.
     - Retention job soft-deletes after 90 days, hard-deletes after 30 days with S3 storage cleanup.
     - 7-day orphaned media cleanup purges storage objects.
