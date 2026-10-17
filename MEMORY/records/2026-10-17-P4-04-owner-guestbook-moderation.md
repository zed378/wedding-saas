# P4-04 — Owner Guestbook Moderation

| | |
|---|---|
| **Date** | 2026-10-17 |
| **Task** | `TASKS/PHASE-4-ENGAGEMENT.md` § P4-04 |
| **Phase** | Phase 4 |
| **Surface** | backend |
| **Author** | AI |
| **Commits / PR** | |
| **Status** | Completed |

---

## What Changed

Added owner guestbook moderation and management endpoints scoped to tenant-owned invitations:
- `GET /api/v1/invitations/:id/guestbook`: Paginated listing of guestbook entries (`id`, `guest_name`, `message`, `status`, `submitted_ip_hash`, `moderated_by`, `moderated_at`, `created_at`) with optional `status` filter (`pending`, `approved`, `rejected`).
- `PATCH /api/v1/invitations/:id/guestbook/:entry_id`: Body `{ status: "approved" | "rejected" }`, records `moderated_by` (current user ID) and `moderated_at` (now). Automatically invalidates `PublicInvitationCache` when an entry status change involves `approved` (either becoming approved or revoking an approved entry).
- `DELETE /api/v1/invitations/:id/guestbook/:entry_id`: Permanently deletes an entry; invalidates `PublicInvitationCache` if the deleted entry was `approved`.
- Enforces strict query-level tenant scoping (`WHERE owner_id = :scope AND deleted_at IS NULL`), returning 404 for non-owners (never 403) and 404 for cross-invitation entry IDs.
- Updated IDOR sweep coverage in `test/integration/idor-sweep.itest.ts` and verified `test/idor-sweep-inventory.spec.ts`.

## Why

Implements the owner guestbook moderation requirements specified in `docs/PLAN/02-BUSINESS-RULES.md` (BR-7.3), `docs/PLAN/04-DETAILED-REQUIREMENTS.md` § F11, `docs/API/04-INVITATION-API.md` § Sub-resource: Guestbook (owner side), `docs/ARCHITECTURE/06-CACHE-STRATEGY.md`, and `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md`.

## How

1. **Repository Layer (`GuestbookRepository`)**:
   - `getInvitationOwnerScope`: queries `{ slug: string | null }` scoped by `invitationId`, `ownerId = scope`, and `deletedAt IS NULL`.
   - `findGuestbookForOwner`: paginated query for all guestbook entries belonging to the invitation, with optional `status` filter (`eq(invitationGuestbook.status, options.status)`), ordered newest first (`createdAt DESC`).
   - `moderateGuestbookEntryForOwner`: verifies entry belongs to `invitationId`, updates `status`, `moderatedBy`, and `moderatedAt`, and returns the updated row along with `slug` and `previousStatus` for cache invalidation.
   - `deleteGuestbookEntryForOwner`: verifies entry belongs to `invitationId`, deletes row, and returns `slug` and `previousStatus` for cache invalidation.
2. **Service Layer (`GuestbookService`)**:
   - `findForOwner`: checks scope and returns paginated entries with total count.
   - `moderateEntry`: validates scope, updates entry, and if status transition affects public display (`newStatus === 'approved' || previousStatus === 'approved'`), triggers `cache.invalidate({ slug, invitationId })`.
   - `deleteEntry`: validates scope, deletes entry, and if `previousStatus === 'approved'`, triggers `cache.invalidate({ slug, invitationId })`.
3. **Controller Layer (`OwnerGuestbookController`)**:
   - Guarded with `requireAuth()` and extracts authenticated user via `@CurrentUserParam()`.
   - Validates query params (`page`, `per_page` / `limit`, `status`) and body (`status: 'approved' | 'rejected'`) with Zod schemas.
   - Returns responses formatted in standard `ok()` envelope.
4. **IDOR Sweep & Test Support**:
   - Added `guestbookId` fixture in `test/support/phase-one-tenant.ts`.
   - Added owner guestbook routes (`GET /api/v1/invitations/:id/guestbook`, `PATCH /api/v1/invitations/:id/guestbook/:entry_id`, `DELETE /api/v1/invitations/:id/guestbook/:entry_id`) and `"invitation_guestbook"` table cleanup to `test/integration/idor-sweep.itest.ts`.

## Files and Components Touched

| Path | Change |
|---|---|
| `MEMORY/specs/P4-04-owner-guestbook-moderation.md` | Feature spec created before implementation |
| `backend/api/src/shared/tenancy/guestbook-repository.ts` | Owner data methods (`getInvitationOwnerScope`, `findGuestbookForOwner`, `moderateGuestbookEntryForOwner`, `deleteGuestbookEntryForOwner`) |
| `backend/api/src/modules/guestbook/guestbook.service.ts` | Owner moderation & deletion methods with cache invalidation |
| `backend/api/src/modules/guestbook/owner-guestbook.controller.ts` | Controller handling owner guestbook routes |
| `backend/api/src/modules/guestbook/guestbook.module.ts` | Registered `OwnerGuestbookController`, imported `AuthModule` & `PublishingModule` |
| `backend/api/test/support/phase-one-tenant.ts` | Added `guestbookId` tenant fixture |
| `backend/api/test/integration/idor-sweep.itest.ts` | Added owner guestbook routes to IDOR sweep |
| `backend/api/test/integration/owner-guestbook.itest.ts` | Integration test suite with 8 test cases |
| `docs/API/04-INVITATION-API.md` | Documented owner guestbook moderation endpoints and cache invalidation contract |
| `MEMORY/records/2026-10-17-P4-04-owner-guestbook-moderation.md` | Change record |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Cache invalidation on both approval and revocation/deletion of approved entries | When an entry becomes `approved`, it must show up immediately on the public page; when an already-approved entry is rejected or deleted, it must disappear immediately without stale cache persistence | ADR-088 |
| Cross-invitation entry ID returns 404 (not 403 or 400) | Per `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md`, child resource existence under another tenant/invitation must never leak through error codes | ADR-088 |

## Deviations from `docs/`

None. Follows `docs/PLAN/02-BUSINESS-RULES.md`, `docs/API/04-INVITATION-API.md`, and `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md`.

## Tests Added

| Layer | What it covers |
|---|---|
| Integration | `test/integration/owner-guestbook.itest.ts`: Lists all guestbook entries with pagination and allows filtering by status (`pending`, `approved`, `rejected`) |
| Integration | Approves a pending entry, sets `moderated_by` & `moderated_at`, and invalidates public cache |
| Integration | Rejects an entry with status `rejected` and records moderation metadata |
| Integration | Deletes an entry and invalidates public cache if the deleted entry was approved |
| Integration | Enforces tenant boundary: non-owner receives 404 on list, moderate, and delete |
| Integration | Enforces cross-invitation isolation: entry belonging to another invitation returns 404 |
| Integration | Rejects invalid moderation status with 400 validation error |
| Integration | Rejects unauthenticated requests with 401 |

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Query-level tenant scoping / 404 for non-owners | `docs/SECURITY/05` § Object-Level Authorization | `test/integration/owner-guestbook.itest.ts` > "enforces tenant boundary: non-owner receives 404 on list, moderate, and delete" |
| Cross-tenant child ID protection (404) | `docs/SECURITY/05` § Parent-Child Verification | `test/integration/owner-guestbook.itest.ts` > "returns 404 when attempting to moderate or delete an entry belonging to another invitation" |
| Audit tracking of moderation actions | `docs/DATABASE/09` | `test/integration/owner-guestbook.itest.ts` > "approves a pending entry, sets moderated_by and moderated_at" |
| Authentication requirement (401) | `docs/SECURITY/03` | `test/integration/owner-guestbook.itest.ts` > "rejects unauthenticated requests with 401" |
| Input validation and status enum whitelisting | `docs/SECURITY/08` | `test/integration/owner-guestbook.itest.ts` > "rejects invalid status with 400 validation error" |

## Abuse Cases Covered

- **Cross-tenant modification/deletion**: Attacker tries to approve/reject/delete messages on another couple's wedding invitation. Refused at SQL query level (`owner_id = scope`) returning 404.
- **Child traversal / confused deputy**: Owner tries to delete an entry ID belonging to another wedding by appending it to their own invitation ID. Refused at SQL query level (`invitation_id = :id`) returning 404.
- **Stale public cache attack**: Spam message accidentally approved by owner is retracted to rejected/deleted. Public cache is invalidated immediately so visitors do not see retracted content.

## Definition of Done Verification

- [x] Feature spec written in `MEMORY/specs/` before implementation
- [x] Query-level tenant scoping enforced (`WHERE owner_id = :scope`)
- [x] Non-owner access returns 404, never 403
- [x] No `SELECT *` passed to responses; explicit output shapes
- [x] All 5 guard scripts pass (`check-sanitized-fields`, `check-tenant-scope`, `check-status-writes`, `check-storage-paths`, `check-secrets`)
- [x] Full unit test suite passes (772/772)
- [x] Integration tests pass (8/8)
- [x] IDOR sweep inventory verified and passing
- [x] Docs updated in `docs/API/04-INVITATION-API.md`
- [x] Change record recorded in `MEMORY/records/`

## What Did Not Work

Initial TypeScript check failed due to `GuestbookEntryStatus` not being exported from `guestbook.service.ts` and `invitations.slug` in Drizzle being typed as `string | null` instead of non-null `string`. Resolved by re-exporting the type and typing slug as `string | null`, adding a guard before `cache.invalidate()`.

## Follow-ups

- Next task: `P4-05 — Abuse controls and adaptive CAPTCHA` (Cloudflare Turnstile, threshold `OQ-14`).
