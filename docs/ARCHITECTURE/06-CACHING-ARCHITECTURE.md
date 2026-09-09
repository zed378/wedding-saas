# 06 - Caching Architecture

Caching is a critical component because public page traffic is read-heavy & spiky (near/during wedding events).

## Cache Layers
```
Browser Cache (static assets, immutable media)
     ↓
CDN Edge Cache (public invitation pages, static assets)
     ↓
Application Cache / Redis (expensive DB query results, session, rate-limit counters, rendered template fragments)
     ↓
Database
```

## What Is Cached
| Data | Layer | TTL / Invalidation |
|---|---|---|
| Public invitation page (rendered HTML) | CDN + app cache | Cached until data changes (invalidate on update) or a 1-hour TTL fallback |
| Template definition (schema, theme) | App cache (Redis) | Invalidated when an admin publishes a new version |
| Media (photos) | CDN | Immutable, very long TTL (1 year) |
| Session/token blacklist | Redis | Per token expiry |
| Rate-limit counters (RSVP, login) | Redis | Sliding window per policy (SECURITY/10) |
| Analytics counter (page views) | Redis (write-behind) | Flushed to DB periodically (e.g., every 1 minute) |

## Invalidation Strategy
- **Event-driven invalidation**: every update to a `published` invitation emits an `invitation.updated` event → the public page cache key for that invitation is invalidated (and optionally proactively regenerated for high-traffic invitations).
- The cache key MUST include `invitation_id` + `template_version_id` (not just the slug) so that a template version change doesn't serve a stale cache.
- Fallback: an absolute TTL as a safety net if event invalidation fails to be delivered.

## Cache Stampede Protection
- Use a lock/singleflight mechanism on cache miss for high-traffic invitations (preventing many concurrent requests from hitting the DB simultaneously when the cache expires at once).

## Cache Segmentation
- The public page with `?to=Name` (personalization) — the personalized portion is NOT cached in the full HTML layer (it must be rendered/injected client-side or via an edge-side include); only the common portion is cached, to avoid an explosive per-guest-name cache.

## Monitoring
- Cache hit ratio is monitored (target > 90% for public pages during normal traffic) — see DEVOPS/05-MONITORING.md.
