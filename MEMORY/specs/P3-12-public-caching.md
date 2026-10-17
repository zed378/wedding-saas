# P3-12 — Feature Spec: Public Page Caching and Invalidation

Written **before** implementation for task `P3-12` (`Spec required: Yes — availability`) in `TASKS/PHASE-3-ORDER-PAYMENT-PUBLISHING.md`.

| | |
|---|---|
| **Task** | P3-12 — Public Page Caching and Invalidation |
| **Date** | 2026-10-17 |
| **Author** | Agent (pair programming with user) |
| **Status** | Draft |

---

## 1. Goal

Serve public invitation pages with high throughput and low latency from an application/Redis cache with event-driven invalidation and singleflight stampede protection, mitigating Risk R3 (traffic spikes bringing down public pages on wedding day). Cold cache under 100 concurrent requests produces exactly one origin query; owner edits/unpublish/slug changes invalidate the cache immediately; and cache hit ratio is tracked with Prometheus metrics and alerted when falling below 50%.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/ARCHITECTURE/06-CACHING-ARCHITECTURE.md` | Cache Layers, What Is Cached, Invalidation, Stampede Protection | Cache key must include `invitation_id + template_version_id`; event-driven invalidation on `invitation.updated`, `published`, `unpublished`, `expired`; absolute fallback TTL 1 hour; stampede protection via lock/singleflight; personalization excluded from cached HTML. |
| `docs/FRONTEND/07-PUBLIC-INVITATION.md` | Strategy, Data Fetching, Personalization | SSR initial load, `?to=` personalization strictly client-side to prevent cache segmentation explosion; cache invalidation on update. |
| `docs/PLAN/18-RISK-REGISTER.md` | R3 | Availability risk mitigation: aggressive caching, CDN, survivability during wedding spikes. |
| `docs/DEVOPS/05-MONITORING.md` | Key Metrics, Cache Hit Ratio Target | Monitor cache hit ratio, response time; target > 90% during normal traffic. |
| `docs/DEVOPS/07-ALERTING.md` | Key Alerts | High alert when public invitation cache hit ratio drops drastically (< 50%). |
| `docs/ARCHITECTURE/05-STORAGE-ARCHITECTURE.md` | CDN | Immutable media cache headers with 1-year TTL based on UUID filenames. |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-4.1 | Only enabled sections are exposed on public pages | `toPublicInvitation` (cached DTO preserves section filtering). |
| BR-6.2 | Post-publish slug change breaks old links and invalidates old cache | `SettingsService.update` and `cache.invalidate` handler. |
| BR-2.5 | Unpublish removes invitation from public display immediately | `UnpublishService` and `cache.invalidate` handler (immediate cache eviction, 404 on next read). |

## 4. API Contract

No change to the external HTTP envelope or endpoint paths:
- `GET /public/i/:slug`:
  - Returns `PublicInvitationDto` in standard envelope (`docs/API/08`).
  - Cache headers: `Cache-Control: public, max-age=0, s-maxage=3600, stale-while-revalidate=60` (or managed by proxy/edge, internal fetch).
  - Metrics tracked per request: hits and misses.
- Worker job `cache.invalidate`:
  - Payload: `{ slug?: string, invitationId: string, templateVersionId?: string, reason: "published" | "unpublished" | "updated" | "slug_changed" | "expired" }`.

## 5. Data Model Impact

No schema migrations required. Existing tables read:
- `invitations`, `invitation_settings`, `template_versions`, `media`, etc.
Redis cache keys:
- Slug index: `cache:public:slug:{slug}` -> `{ invitationId: string, templateVersionId: string }` (TTL 3600s).
- Invitation payload: `cache:public:invitation:{invitationId}:{templateVersionId}` -> `PublicInvitationDto` (TTL 3600s).

Migration required: no.

## 6. Authorization

- `GET /public/i/:slug` is unauthenticated. Tenancy/authorization is enforced exclusively via `status = 'published' AND deleted_at IS NULL` in the repository query.
- Draft, expired, unpublished, or non-existent invitations return an undifferentiated 404 (`NotFoundError`), and are never cached as public invitations.
- Cache invalidation jobs are queued from authenticated owner operations (`requireOwnership` in service layer) or administrative lifecycle events.

## 7. Validation and Sanitization

- Slugs are validated with `checkSlugFormat` before cache lookup or database querying.
- Malformed slugs are rejected with 404 without querying Redis or PostgreSQL.
- Personalization parameter `?to=` is ignored by the backend API and never touches the cached payload or cache key.

## 8. State Transitions

- Publish (`draft` or `paid` -> `published`): enqueues `cache.invalidate` with `reason: "published"` (or directly warms cache).
- Unpublish (`published` -> `paid` or `draft`): enqueues `cache.invalidate` with `reason: "unpublished"`, immediately removing cached keys.
- Slug change after publish: enqueues `cache.invalidate` for the old slug (`reason: "slug_changed"`), immediately purging old slug index.
- Content updates while `published`: enqueues `cache.invalidate` with `reason: "updated"`, invalidating old payload and proactively regenerating.

## 9. Side Effects

- On cache miss: queries database once under singleflight protection, populates Redis cache, increments miss metric.
- On cache hit: reads from Redis cache without querying database, increments hit metric.
- Invalidation handler: removes slug mapping and invitation cache key; if invitation is still published, proactively fetches and rewarms cache.

## 10. Failure Modes

- Redis unreachable or erroring: `RedisCache` and `PublicInvitationService` fail open. If Redis fails, fall back gracefully to direct database query. The public page must NEVER 500 because Redis is down.
- Worker down: 1-hour absolute TTL acts as fallback safety net for missed invalidation events.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Cache stampede (100 simultaneous requests on cold cache) | `docs/ARCHITECTURE/06` | Exactly 1 DB query executed; remaining 99 await singleflight | "100 concurrent requests on a cold cache query origin exactly once" |
| Access unpublished invitation via cache poisoning | `docs/SECURITY/05` | Unpublished invitation is never cached; returns 404 | "never caches an unpublished or draft invitation" |
| Stale cache after template version change | `docs/ARCHITECTURE/06` | Key includes template_version_id; new version misses cache | "serves fresh content when template version changes" |
| Immediate 404 after unpublish through cache | `P3-10` obligation | Unpublishing evicts cache; subsequent read returns 404 immediately | "public page 404s immediately after unpublish through cache" |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit | Singleflight deduplication; cache key formatting with invitation_id and template_version_id; hit/miss metrics recording. |
| Integration (`public-invitation.itest.ts`) | Cache hit and miss flow; 100 concurrent requests singleflight; invalidation on unpublish; invalidation on content update; template version change cache bypass; Redis fail-open fallback. |
| E2E | Published page served with cache headers, unpublish reflects live in < 5s. |

## 13. Observability

- Metrics:
  - `wi_public_invitation_cache_hits_total` (counter)
  - `wi_public_invitation_cache_misses_total` (counter)
- Prometheus Alert:
  - `PublicInvitationCacheHitRatioLow`: fires if hit ratio < 50% over 5m with minimum traffic threshold (> 1 req/s).
- Logs:
  - Structured log `cache.public_invitation.miss`, `cache.public_invitation.hit`, `cache.public_invitation.invalidated` with redacted context.

## 14. Open Questions

None blocking.
