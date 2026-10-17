# P3-13 — Invitation Expiry Job and Renewal

| | |
|---|---|
| **Date** | 2026-10-17 |
| **Task** | `TASKS/PHASE-3-ORDER-PAYMENT-PUBLISHING.md` § P3-13 |
| **Phase** | Phase 3 |
| **Surface** | worker, backend |
| **Author** | Antigravity |
| **Commits / PR** | feat(backend): P3-13 invitation expiry job, renewal validity extension, and retention cleanup |
| **Status** | Completed |

---

## What Changed

Implemented the complete lifecycle management for invitation expiry, renewal validity extension, and two-tier retention cleanup:
1. **Scheduled Expiry Sweep (`invitation_expiry_check`)**:
   Runs daily at 00:05 WIB in the `api-jobs` process. Overdue `published` invitations are transitioned to `expired` by actor `SYSTEM`, audit history is written, the public cache entry is invalidated, and `invitation_expired` notification event is emitted. Status mutations are strictly forbidden on HTTP read requests.
2. **Renewal Entitlement Application (`GREATEST` logic)**:
   When a renewal order settles (`OrderService.settlePaid`), validity is computed in SQL:
   `expiry_date = (GREATEST(expiry_date, (now() AT TIME ZONE 'Asia/Jakarta')::date) + (validity_months || ' months')::interval)::date`.
   If the invitation was `expired`, it is atomically restored to `published` by actor `SYSTEM` with audit history.
3. **Public Page Behavior**:
   The public invitation repository and API return `null` (undifferentiated 404), while the public frontend router serves the friendly "invitation has ended" state.
4. **Two-Tier Retention Cleanup & Media Purge (`invitation_soft_delete_cleanup`)**:
   Runs daily at 01:00 WIB in the `api-jobs` process.
   - Sweep 1: Invitations expired for 90 days without renewal are moved to `soft_deleted`.
   - Sweep 2: Invitations soft-deleted for 30 days are hard-deleted. All associated physical files in Cloudflare R2 / MinIO (`thumbnail`, `medium`, `large` variants) are purged. Due to `orders.invitation_id` foreign key constraint (`ON DELETE RESTRICT`), invitations with orders are scrubbed of all personal data (people, events, gallery, guestbook, rsvps, settings, media) and marked `deleted`, while invitations without orders are deleted completely.
   - Sweep 3 (`P1-19` obligation): Individually soft-deleted gallery photos older than 7 days are physically purged from storage and permanently removed from the media table.

## Why

Implements the business rules and constraints from `docs/PLAN/02-BUSINESS-RULES.md` (BR-2.6, BR-2.8, BR-9.1), `docs/BACKEND/06-PUBLISHING.md` § Expiry Check and Renewal, `docs/BACKEND/08-JOBS-WORKERS.md`, and fulfills outstanding obligations from `P3-05` (ADR-077: applying renewal orders) and `P1-19` (purging individually removed gallery photos after 7 days grace period).

## How

1. **Repository Layer Additions**:
   - `InvitationRepository`: Added `overduePublishedInvitations`, `expiredInvitationsForSoftDelete`, `markSoftDeleted`, `softDeletedInvitationsForHardDelete`, `findMediaForInvitation`, `hardDeleteInvitation`, `orphanedSoftDeletedMedia`, and `hardDeleteMedia`.
   - `OrderRepository`: Added `applyRenewal` using SQL `GREATEST(expiry_date, (now() AT TIME ZONE 'Asia/Jakarta')::date)`.
2. **Order Settle & Renewal**:
   - In `OrderService.settlePaid`: when `orderType === "renewal"`, executes `applyRenewal`. If previously `expired`, calls `InvitationStatusService.transitionWithin` to restore `published` with actor `SYSTEM`. Increments `invitationsRenewed` Prometheus metric.
3. **Scheduled Job Handlers**:
   - `InvitationExpiryService` in `backend/api/src/modules/publishing/invitation-expiry.service.ts`: executes `invitation_expiry_check` (cron: `5 0 * * *` Asia/Jakarta).
   - `InvitationRetentionService` in `backend/api/src/modules/invitation/invitation-retention.service.ts`: executes `invitation_soft_delete_cleanup` (cron: `0 1 * * *` Asia/Jakarta).
   - Registered in `backend/api/src/jobs/domain-jobs.ts`.
4. **Metrics**:
   - Added Prometheus counters `wi_invitations_expired_total`, `wi_invitations_renewed_total`, `wi_invitations_soft_deleted_total`, `wi_invitations_hard_deleted_total`, and `wi_media_orphans_cleaned_total`.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/shared/metrics/metrics.ts` | Added Prometheus counters for expiry, renewals, soft/hard deletion, and orphaned media cleanup |
| `backend/api/src/shared/tenancy/invitation-repository.ts` | Added methods for overdue sweep, soft deletion, hard deletion, and storage media lookup |
| `backend/api/src/shared/tenancy/order-repository.ts` | Added `applyRenewal` method with `GREATEST` date calculation |
| `backend/api/src/modules/order/order.service.ts` | Handled renewal order settlement, status restoration, and metrics |
| `backend/api/src/modules/publishing/invitation-expiry.service.ts` | Created — service running daily 00:05 WIB expiry sweep |
| `backend/api/src/modules/invitation/invitation-retention.service.ts` | Created — service running daily 01:00 WIB retention and media purge sweep |
| `backend/api/src/jobs/domain-jobs.ts` | Registered `invitation_expiry_check` and `invitation_soft_delete_cleanup` |
| `backend/api/src/modules/publishing/publishing.module.ts` | Exported and provided `InvitationExpiryService` |
| `backend/api/src/modules/invitation/invitation.module.ts` | Provided `InvitationRetentionService` |
| `backend/worker/src/handlers/index.ts` | Documented scheduled job domain alignment in worker handlers |
| `backend/api/test/integration/invitation-expiry.itest.ts` | Created — 8 integration tests covering all 4 DoD criteria |
| `MEMORY/specs/P3-13-invitation-expiry-and-renewal.md` | Created — feature specification for P3-13 |
| `MEMORY/DECISIONS.md` | Recorded ADR-083 |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Status mutation strictly in scheduled sweep, never on read request | Per `docs/PLAN/06`, reading an overdue invitation must never mutate state mid-request; state must not depend on user traffic | ADR-083 |
| SQL `GREATEST(expiry_date, now() AT TIME ZONE 'Asia/Jakarta')` for renewals | Guarantees early renewals extend from future expiry date without losing remaining days, while renewals of expired invitations extend from payment day | ADR-083 |
| Order preservation with tombstone scrub on hard deletion | `orders.invitation_id` has `ON DELETE RESTRICT` for financial audit compliance. Scrubbing child tables and files while retaining the order-bound record satisfies both privacy and accounting laws | ADR-083 |
| Dedicated 7-day grace period cleanup for gallery media | Satisfies `P1-19` obligation and `docs/PLAN/11` § Deletion, preventing orphaned image variants from accumulating in R2 | ADR-083 |

## Deviations from `docs/`

None. Fully conforms to `docs/PLAN/02-BUSINESS-RULES.md`, `docs/BACKEND/06-PUBLISHING.md`, and `docs/ARCHITECTURE/05-STORAGE-ARCHITECTURE.md`.

## Tests Added

| Layer | What it covers |
|---|---|
| Integration (`invitation-expiry.itest.ts`) | **DoD 1**: Overdue invitation stays published on read and expires only when sweep runs; future invitations are untouched. |
| Integration (`invitation-expiry.itest.ts`) | **DoD 2**: Renewal of expired invitation extends from today and restores published status; renewal of still-published invitation extends from future date; status history records SYSTEM actor; order_paid notification emitted. |
| Integration (`invitation-expiry.itest.ts`) | **DoD 3**: Public invitation repository returns null for expired invitations (undifferentiated 404). |
| Integration (`invitation-expiry.itest.ts`) | **DoD 4**: Expired for 90 days moves to soft_deleted; soft-deleted for 30 days is hard-deleted and purges all storage objects (`thumb`, `med`, `large`); individually soft-deleted gallery photos older than 7 days are purged from storage and DB (`P1-19` obligation). |

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| No status mutation on public reads | `docs/PLAN/06` / `docs/SECURITY/05` | `invitation-expiry.itest.ts` › "an overdue invitation stays published upon reading, and expires only when sweep runs" |
| Status writes restricted to InvitationStatusService | `docs/PLAN/06` | `scripts/check-status-writes.mjs` (0 violations) |
| Tenant scope verification | `docs/SECURITY/05` | `scripts/check-tenant-scope.mjs` (0 violations) |
| Storage keys constructed safely | `docs/SECURITY/06` | `scripts/check-storage-paths.mjs` (0 violations) |
| Financial audit integrity preserved | `docs/SECURITY/07` | `invitation-expiry.itest.ts` › "hard-deletes an invitation soft-deleted for 30 days and removes all storage objects" (orders preserved) |

## Abuse Cases Covered

| Abuse case | Source | Test |
|---|---|---|
| Attempting to renew at an unauthorized price or manipulate validity | `docs/SECURITY/07` | `invitation-expiry.itest.ts` › DoD 2 renewal tests verify price is strictly calculated server-side from `packages` table and validity duration is derived from package record |
| Early renewal losing remaining days | BR-2.6 | `invitation-expiry.itest.ts` › "renews a still-published invitation, extending from its existing future expiry_date" |
| Storage object accumulation from deleted invitations | `docs/ARCHITECTURE/05` § Quota & Lifecycle | `invitation-expiry.itest.ts` › "hard-deletes an invitation soft-deleted for 30 days and removes all storage objects" |
| Storage object accumulation from deleted gallery photos | `docs/PLAN/11` § Deletion | `invitation-expiry.itest.ts` › "purges individually soft-deleted gallery photos older than 7 days from storage and DB" |

## Definition of Done Verification

- [x] Expiry happens only in the scheduled job; a request never mutates status. (Proven by `invitation-expiry.itest.ts` DoD 1)
- [x] Renewal extends from whichever of expiry or now is later, and restores `published`. (Proven by `invitation-expiry.itest.ts` DoD 2)
- [x] Expired invitations show the friendly page while the API stays undifferentiated. (Proven by `invitation-expiry.itest.ts` DoD 3)
- [x] The retention chain is implemented with its notification hooks, and hard deletion removes storage objects. (Proven by `invitation-expiry.itest.ts` DoD 4)

## What Did Not Work

1. `set_updated_at()` PostgreSQL trigger automatically fired on `UPDATE invitations SET expiry_date = ...`, overwriting `updated_at` to `NOW()`. Fixed retention query to evaluate `OR (expiry_date <= now() - interval '90 days')` so trigger updates don't reset the 90-day expiry counter.
2. In `test/payment-gateway-fake.spec.ts`, module boundary assertions strictly forbid any reference to `invitation` in the `modules/payment/` folder (`docs/BACKEND/01`). Reverted an experimental cache invalidation call in `payment-webhook.service.ts` to keep the payment module completely decoupled from the invitation domain.
3. Storage path UUID validation enforces RFC4122 v4 regex. Test fixture UUIDs must conform to this pattern.

## Follow-ups and What to Watch in Production

- Monitor `wi_invitations_expired_total` and `wi_invitations_soft_deleted_total` to ensure cron triggers reliably at 00:05 and 01:00 WIB.
- In `P4-07`, wire the email notifications sent at 30 days, 7 days, and 1 day before hard deletion.
- Cloudflare R2 delete latency during large batch hard-deletion sweeps.
