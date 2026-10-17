# P3-12 — Public Page Caching and Invalidation

| | |
|---|---|
| **Date** | 2026-10-17 |
| **Task** | `TASKS/PHASE-3-ORDER-PAYMENT-PUBLISHING.md` § P3-12 |
| **Phase** | Phase 3 |
| **Surface** | backend, infra |
| **Author** | Antigravity |
| **Commits / PR** | feat(backend): P3-12 public invitation caching and invalidation |
| **Status** | Completed |

---

## What Changed

Added a resilient, two-level caching and stampede-protection architecture for public invitation endpoints. Public invitations are now cached in Redis using versioned payload keys (`{invitationId}:{templateVersionId}`) and slug pointers (`slug:{slug}`), backed by an in-process `Singleflight` deduplication utility that collapses concurrent cold-cache misses into a single database query. Event-driven invalidation removes cached keys on content edits, template changes, and unpublish (satisfying `P3-10` obligation to immediately 404 through cache). Cache hits/misses are tracked via Prometheus metrics with an alert on low hit ratio (< 50%). Static assets and Next.js static bundles are configured with immutable cache-control headers (`max-age=31536000, immutable`) in Caddy.

## Why

Mitigates R3 (`docs/PLAN/18-RISK-REGISTER.md`): the risk of traffic spikes (guests opening links on the wedding day) overwhelming the database or degrading response times. Implements the caching, stampede protection, and invalidation rules specified in `docs/ARCHITECTURE/06-CACHING-ARCHITECTURE.md`, `docs/API/08-PUBLIC-INVITATION-API.md`, and `docs/DEVOPS/05-MONITORING.md`.

## How

1. **In-process Singleflight**:
   `Singleflight` utility (`backend/api/src/shared/utils/singleflight.ts`) tracks in-flight promises by key (slug). When 100 concurrent requests arrive for a cold slug, exactly one execution queries the database and computes the DTO; the other 99 await the shared promise.
2. **Two-Level Redis Cache Keying**:
   - `cache:public_invitation:{gen}:slug:{slug}` stores `{ invitationId, templateVersionId }`.
   - `cache:public_invitation:{gen}:{invitationId}:{templateVersionId}` stores `PublicInvitationDto`.
   Keying on template version ensures that template changes never serve stale layouts or mismatched sections.
3. **Fail-Open Resilience**:
   Cache reads/writes wrap operations defensively. If Redis is down, times out, or errors, `PublicInvitationService` falls back to the database and serves 200 OK without failing.
4. **Immediate In-Process and Worker Invalidation**:
   - `UnpublishService` and `PublishService` immediately delete the slug and versioned cache entries in-process, ensuring a subsequent request through the cache returns 404 immediately (`P3-10` obligation).
   - `cache.invalidate` handler in `backend/worker/src/handlers/cache-invalidate.handler.ts` cleans up keys across cache generations in Redis.
5. **Observability & Alerting**:
   Added `wi_public_invitation_cache_hits_total` and `wi_public_invitation_cache_misses_total` counters to `backend/api/src/shared/metrics/metrics.ts`. Configured `PublicInvitationCacheHitRatioLow` Prometheus alert in `deploy/prometheus/alerts.yml`.
6. **Immutable Static Caching**:
   Updated `deploy/Caddyfile.production` to set `Cache-Control: public, max-age=31536000, immutable` for static assets (`/_next/static/*`).

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/shared/utils/singleflight.ts` | Created — in-process singleflight stampede protection |
| `backend/api/test/singleflight.spec.ts` | Created — unit tests for Singleflight (concurrency, error cleanup, key isolation) |
| `backend/api/src/infra/cache/cache.port.ts` | Added `delete(namespace, key)` to CachePort interface |
| `backend/api/src/infra/cache/redis-cache.ts` | Implemented `delete` on RedisCache |
| `backend/api/src/shared/metrics/metrics.ts` | Added `publicInvitationCacheHits` and `publicInvitationCacheMisses` counters |
| `backend/api/src/modules/publishing/public-invitation-cache.ts` | Created — cache service managing slug pointer, versioned payload, and invalidation |
| `backend/api/src/modules/publishing/public-invitation.service.ts` | Integrated cache lookup, singleflight fallback on miss, fail-open try/catch, and `warm(slug)` |
| `backend/api/src/modules/publishing/publish.service.ts` | Added cache invalidation on successful publish |
| `backend/api/src/modules/publishing/unpublish.service.ts` | Added immediate in-process cache invalidation |
| `backend/api/src/modules/publishing/publishing.module.ts` | Exported and provided `PublicInvitationCache` |
| `backend/api/src/modules/invitation/settings.service.ts` | Added `cache.invalidate` queueing on settings updates |
| `backend/worker/src/handlers/cache-invalidate.handler.ts` | Created — worker general pool handler deleting cached keys across generations |
| `backend/worker/src/handlers/index.ts` | Registered `cache.invalidate` handler in worker runner |
| `backend/worker/src/runner.ts` | Exposed `redis` getter on `JobRunner` |
| `deploy/prometheus/alerts.yml` | Added `PublicInvitationCacheHitRatioLow` alert |
| `deploy/Caddyfile.production` | Added immutable `Cache-Control` header for Next.js static assets |
| `backend/api/test/integration/public-invitation-cache.itest.ts` | Created — 6 integration tests verifying singleflight, hits, version changes, edits, unpublish 404, and fail-open |
| `MEMORY/specs/P3-12-public-caching.md` | Created — feature specification for public caching |
| `MEMORY/DECISIONS.md` | Recorded ADR-082 |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Two-level cache keying (`slug` pointer + `invitation_id:template_version_id` payload) | Prevents stale layouts and section mismatches after template updates while keeping slug lookups O(1) | ADR-082 |
| Singleflight promise sharing per slug | Collapses concurrent misses into exactly 1 database query without heavy distributed locks | ADR-082 |
| Fail-open on Redis errors | Public invitations must never return 500 to guests because of cache service degradation | ADR-082 |
| Synchronous in-process eviction alongside background queueing | Guarantees instant 404 immediately after unpublish without waiting for worker poll | ADR-082 |

## Deviations from `docs/`

None. Fully conforms to `docs/ARCHITECTURE/06-CACHING-ARCHITECTURE.md` and `docs/API/08-PUBLIC-INVITATION-API.md`.

## Tests Added

| Layer | What it covers |
|---|---|
| Unit (`singleflight.spec.ts`) | Singleflight deduplication across 100 concurrent callers, error isolation, key independence |
| Unit (`metrics.spec.ts`) | Prometheus metric exposition for cache hits and misses |
| Integration (`public-invitation-cache.itest.ts`) | 100 concurrent requests produce 1 origin render; cache hit returns without DB query; template version update serves fresh data; owner edit reflects immediately; unpublish 404s immediately through cache; Redis failure fails open |

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Object-level authorization (404 for non-published/non-owned) | `docs/SECURITY/05` | `public-invitation.itest.ts` › "nothing that is not published is served" |
| Unpublish immediate eviction through cache | `P3-10` obligation / `docs/SECURITY/05` | `public-invitation-cache.itest.ts` › "public page 404s immediately after unpublish through the cache layer" |
| Information disclosure prevention | `docs/SECURITY/01` | `public-invitation-cache.itest.ts` › "fails open gracefully to origin DB when Redis encounters an error" (never leaks 500 error trace) |

## Abuse Cases Covered

| Abuse case | Source | Test |
|---|---|---|
| Cache stampede on cold cache (100 concurrent requests) | `docs/ARCHITECTURE/06` § Cache Stampede | `public-invitation-cache.itest.ts` › "100 concurrent requests on a cold cache query origin exactly once (DoD 2 singleflight)" |
| Accessing unpublished invitation via stale cache | `docs/SECURITY/05` / `P3-10` obligation | `public-invitation-cache.itest.ts` › "public page 404s immediately after unpublish through the cache layer" |
| Stale template layout after template version change | `docs/ARCHITECTURE/06` § Invalidation | `public-invitation-cache.itest.ts` › "serves fresh content when template version changes (DoD 3)" |

## Definition of Done Verification

- [x] Tests at the appropriate pyramid layer (unit: singleflight & metrics; integration: public-invitation-cache itest)
- [x] IDOR test for every new `:id` endpoint (No new `:id` endpoints added; checked by `check-id-endpoint-tests.mjs`)
- [x] Every abuse case has an automated test
- [x] Write endpoints whitelist their fields
- [x] Free-text input sanitized before storage
- [x] Response envelope matches `docs/API/00`
- [x] State transitions logged (`invitation_status_history` / `audit_logs`)
- [x] Nothing sensitive logged
- [x] CI green: lint, types, build, unit, integration, dependency audit, SAST
- [x] `TASKS/PROGRESS.md` and the phase file updated
- [x] Task-specific DoD items:
  - [x] An owner's edit is visible publicly within seconds without a manual purge.
  - [x] A cold cache under 100 concurrent requests produces one origin render, proven by a test.
  - [x] Cache keys include the template version; a version change does not serve stale HTML.
  - [x] Hit ratio is measured and alerted on.
  - [x] Unpublishing removes the page from cache immediately.

## What Did Not Work

- Direct mock of `PublicInvitationCache.get` in `PublicInvitationService` bypassed internal try/catch block, initially causing an unhandled rejection in the unit test suite. Fixed by guarding cache calls directly in `PublicInvitationService` with try/catch and making cache injection optional for unit test instantiation.

## Follow-Ups and Open Questions

- `P3-13` (Invitation Expiry Job and Renewal): Daily sweep at 00:05 WIB should trigger cache invalidation upon transitioning published invitations past `expiry_date` to `expired`.

## What to Watch

- Metric: `wi_public_invitation_cache_hits_total` / (`wi_public_invitation_cache_hits_total` + `wi_public_invitation_cache_misses_total`).
- Alert: `PublicInvitationCacheHitRatioLow` in Prometheus. If hit ratio drops below 50% under sustained load, investigate Redis latency or cache key churn.
