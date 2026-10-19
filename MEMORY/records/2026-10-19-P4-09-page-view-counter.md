# P4-09 — Page View Counter with Write-Behind Flush

| | |
|---|---|
| **Date** | 2026-10-19 |
| **Task** | `TASKS/PHASE-4-ENGAGEMENT.md` § P4-09 |
| **Phase** | Phase 4 — Engagement |
| **Surface** | backend, worker, public-invite |
| **Author** | Agent |
| **Status** | Completed |

---

## What Changed

- Implemented in-memory page view counter via Redis hash increments (`POST /public/i/:slug/view`) with zero synchronous database writes during public visitor page loads.
- Implemented write-behind atomic flush job `analytics_counter_flush` running every 1 minute via scheduled domain jobs to batch upsert view counts into `invitation_view_counts` at daily grain (`Asia/Jakarta`).
- Added client-side beacon `<PageViewTracker slug={slug} />` in `frontend/public-invite` mounted in public invitation pages with same-origin proxy `/public/i/[slug]/view/route.ts`.
- Implemented `AnalyticsRepository` with tenant-scoped aggregate summaries and batch upsert logic adhering to `scripts/check-tenant-scope.mjs`.

## Why

Implements `docs/PLAN/14-ANALYTICS.md`, `docs/DATABASE/11-ANALYTICS.md`, `docs/ARCHITECTURE/07-BACKGROUND-PROCESSING.md`, and ADR-093. Digital wedding invitations experience extreme traffic spikes upon delivery to hundreds of guests. Synchronous writes to PostgreSQL on every visit create severe database contention and denial-of-service risks. An in-memory write-behind flush buffers spikes into periodic atomic batch upserts while guaranteeing zero PII storage (no IP, user-agent, or cookies).

## How

1. **Redis Pending Buffer**: Public view requests increment key `${invitationId}:${viewDate}` inside hash `analytics:views:pending` via `HINCRBY`. Calendar date is evaluated in `Asia/Jakarta` (`en-CA` format `YYYY-MM-DD`).
2. **Fail-open Resiliency**: If Redis is degraded or unavailable, `AnalyticsService.recordView` logs a warning and returns `{ recorded: false }`. The visitor request succeeds without interruption (`wi_page_views_total{status="failed"}`).
3. **Atomic Write-Behind Flush**: Scheduled job `analytics_counter_flush` renames `analytics:views:pending` to a unique batch key `analytics:views:flushing:<uuid>`. Concurrent increments immediately seed a fresh pending hash without lost writes. The batch is retrieved via `HGETALL` and upserted via `AnalyticsRepository.recordBatch` (`ON CONFLICT (invitation_id, view_date) DO UPDATE SET view_count = invitation_view_counts.view_count + EXCLUDED.view_count`).
4. **Best-Effort Tolerance**: Per `docs/ARCHITECTURE/07`, flush failures log and increment `wi_analytics_flush_total{status="failure"}` without failing or retrying in a dead-letter queue.
5. **Client Beacon & Same-Origin Proxy**: `<PageViewTracker />` fires `navigator.sendBeacon` (falling back to `fetch(..., { keepalive: true })`) on mount. `frontend/public-invite/src/app/public/i/[slug]/view/route.ts` proxies requests to the API with `X-Forwarded-For` and payload capped at 1KB.

## Files and Components Touched

| Path | Change |
|---|---|
| `MEMORY/specs/P4-09-page-view-counter.md` | Feature specification for in-memory view tracking and write-behind flush |
| `backend/api/src/shared/metrics/metrics.ts` | Added `pageViews` and `analyticsFlush` Prometheus counters |
| `backend/api/src/shared/tenancy/analytics-repository.ts` | Implemented `AnalyticsRepository` with `recordBatch` and tenant-scoped `getViewSummary` |
| `backend/api/src/shared/tenancy/tenancy.module.ts` | Registered and exported `AnalyticsRepository` |
| `backend/api/src/modules/analytics/analytics.service.ts` | View recording, Redis pending buffering, and atomic write-behind flush logic |
| `backend/api/src/modules/analytics/public-view.controller.ts` | `POST /public/i/:slug/view` with rate limiting and input validation |
| `backend/api/src/modules/analytics/analytics.module.ts` | Created NestJS module for analytics |
| `backend/api/src/app.module.ts` | Registered `AnalyticsModule` |
| `backend/api/src/jobs/domain-jobs.ts` | Registered `analytics_counter_flush` scheduled job |
| `backend/api/test/analytics.spec.ts` | Unit tests for service, controller, and flush handling |
| `backend/api/test/idor-sweep-inventory.spec.ts` | Registered `POST /public/i/:slug/view` in EXEMPT inventory |
| `frontend/public-invite/src/components/PageViewTracker.tsx` | Client beacon tracking public invitation view |
| `frontend/public-invite/src/app/public/i/[slug]/view/route.ts` | Same-origin proxy route forwarding view beacon to API |
| `frontend/public-invite/src/app/[slug]/page.tsx` | Mounted `PageViewTracker` in public invitation template |
| `frontend/public-invite/test/page-view-tracker.spec.tsx` | Tests for client beacon and proxy route |
| `MEMORY/DECISIONS.md` | Added ADR-093 |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Redis hash `analytics:views:pending` with atomic rename flush | Guarantees non-blocking view requests and zero race conditions during flush | ADR-093 |
| Fail-open on Redis errors | Analytics monitoring must never disrupt guest invitation access | ADR-093 |
| Best-effort flush without DLQ | Losing an aggregate view batch during catastrophic DB downtime is an acceptable trade per `docs/ARCHITECTURE/07` | ADR-093 |
| Daily grain in `Asia/Jakarta` | Aligns analytics day boundary with wedding events timezone (WIB) | ADR-093 |

## Deviations from `docs/`

None. Follows `docs/PLAN/14-ANALYTICS.md`, `docs/DATABASE/11-ANALYTICS.md`, and `docs/ARCHITECTURE/07-BACKGROUND-PROCESSING.md`.

## Tests Added

| Layer | What it covers |
|---|---|
| Unit (`backend/api/test/analytics.spec.ts`) | Redis increment on published invitation, 404 on missing/draft/expired slug, fail-open on Redis error, atomic rename and batch upsert in `flushViewCounts`, clean handling of empty pending hash, best-effort error handling, controller validation. |
| Inventory (`backend/api/test/idor-sweep-inventory.spec.ts`) | Verified route inventory coverage with explicit exemption for public view beacon. |
| Unit (`frontend/public-invite/test/page-view-tracker.spec.tsx`) | `sendBeacon` dispatch, `fetch` fallback with `keepalive: true`, exception swallowing, duplicate render suppression, proxy route forwarding with forwarded-for headers, 413 on oversized body, 204 on upstream error. |

## Security Verification

| Control | How it was tested |
|---|---|
| Tenant data isolation | `AnalyticsRepository.getViewSummary` scopes query strictly by `i.owner_id = scope` and `i.deleted_at IS NULL`. Verified in `scripts/check-tenant-scope.mjs`. |
| Zero PII / Fingerprinting | Beacon payload is empty `{}` and stored table `invitation_view_counts` stores only `(invitation_id, view_date, view_count)`. No IP, user-agent, or cookies stored. |
| Mass assignment / unexpected body | `PublicViewController` enforces strict schema (`viewSchema.strict()`), rejecting any unexpected body fields with `ValidationError`. |
| Rate limiting | Guarded by `@UseGuards(rateLimit("general-public"))` allowing 100 requests/minute per client IP. |
| Oversized payload protection | Same-origin proxy route rejects bodies > 1KB with HTTP 413. |

## Abuse Cases Covered

- **Spamming view beacon**: Rate-limited under `general-public` (100 req/min per IP); updates only aggregate in-memory counter with zero synchronous DB load.
- **Malformed/Unexpected payload**: Strict schema validation rejects payloads containing unexpected attributes with 400 `ValidationError`.
- **Probing draft/unpublished invitations**: `recordView` validates published status via `PublicInvitationRepository.findPublishedBySlug` and throws 404 for draft, expired, or non-existent invitations.

## DoD Verification

- [x] Feature spec written to `MEMORY/specs/P4-09-page-view-counter.md`.
- [x] In-memory Redis counter increments on public invitation requests with fail-open resiliency.
- [x] Scheduled domain job `analytics_counter_flush` performs atomic rename and batch upsert.
- [x] Client beacon `<PageViewTracker />` and same-origin proxy route implemented.
- [x] Unit tests pass: `test/analytics.spec.ts`, `test/idor-sweep-inventory.spec.ts`, `test/page-view-tracker.spec.tsx`.
- [x] All 799 tests in `@wi/api` pass; all 127 tests in `@wi/public-invite` pass.
- [x] `scripts/check-tenant-scope.mjs`, `scripts/check-id-endpoint-tests.mjs`, `scripts/check-secrets.mjs` pass.
- [x] `turbo run typecheck` passes cleanly across all 13 packages.
- [x] ADR-093 recorded in `MEMORY/DECISIONS.md`.

## What Did Not Work

- Initial `analytics-repository.ts` typed `scope` as an object expecting `.userId`, whereas `TenantScope` is a branded string representing the owner ID directly. Caught and fixed via `turbo run typecheck`.

## Follow-ups

- `P4-10` (Visitor RSVP Flow with Phone & Plus-One) will build upon the guest engagement pipeline.
- `P4-11` (Guestbook Moderation & Bad Word Filter) will add moderation tools for couples.
