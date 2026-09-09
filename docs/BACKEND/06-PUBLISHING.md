# 06 - Publishing (Technical Implementation)

Technical complement to PLAN/10-DOMAIN-PUBLISHING.md and BACKEND/02-SERVICE-LAYER.md (see the `publish()` example).

## Slug Resolution & Routing

Resolution is implemented **once**, behind a configured strategy, so the MVP's path-based addresses and the eventual per-invitation subdomains are the same code path (PLAN/10-DOMAIN-PUBLISHING.md, MEMORY ADR-024).

```
A request arrives at the Public Invitation app
  → Middleware resolves the slug by the configured strategy:
      'path'      (MVP)      → first path segment of the URL: "/andi-sarah" → slug="andi-sarah"
      'subdomain' (later)    → leading label of the Host header: "andi-sarah.invitation..." → slug="andi-sarah"
      custom domain (Phase 2) → Host lookup in invitation_custom_domains, checked before either of the above
  → Normalize and validate the slug shape BEFORE querying (a path segment is untrusted input,
     and so is a proxy-supplied header — neither is a fact)
  → Query the invitation WHERE slug = :slug AND status = 'published' AND deleted_at IS NULL
  → if not found: the 404 handler
  → if found: continue to the render pipeline (FRONTEND/07-PUBLIC-INVITATION.md)
```

Only three paths are routed to the public app: `/{slug}`, `/preview/{token}` and the proxied `/public/*`. Everything else on that host is a 404 — which is what keeps an application route from ever shadowing an invitation.

When the strategy changes from `path` to `subdomain`, the old path form must answer with a permanent redirect to the new canonical address, indefinitely.

## Publish Endpoint (additional detail beyond BACKEND/02)
- After `publish()` succeeds, the service triggers:
  1. Cache warm/invalidate (ARCHITECTURE/06) — proactively generating the public page cache so the guest's first request isn't a cache-miss.
  2. An `invitation.published` event → the notification module sends a confirmation email to the owner.
  3. An event for the analytics module (optional, recording the publish time for funnel metrics per PLAN/14).

## Unpublish Endpoint
```
POST /invitations/:id/unpublish
  → guard: status === 'published'
  → set status = 'paid' (NOT draft — the rule in PLAN/06), published_at is not reset (history)
  → invalidate this invitation's public page cache IMMEDIATELY (to avoid a window where the old page is still cached even though it should no longer be public)
  → statusHistory.record(...)
```

## Job: Expiry Check (daily)
```
UPDATE invitations SET status = 'expired'
WHERE status = 'published' AND expiry_date < CURRENT_DATE AND deleted_at IS NULL
-- for every row updated: statusHistory.record(), invalidate the cache, enqueue an 'invitation.expired' notification
```
Idempotent: safe to run repeatedly, only affecting rows that meet the condition.

## Renewal
```
After a renewal order's 'order.paid' event fires (with order_type='renewal'):
  → if invitation.status === 'expired': set status = 'published' again
  → expiry_date = GREATEST(expiry_date, now()) + package_duration  -- extend from whichever is greater between the old expiry or now
  → invalidate the cache, send a renewal confirmation notification
```

## Slug Validation at Publish Time
- Uniqueness check (a partial unique index, DATABASE/04) + a check against the forbidden-word blocklist (SECURITY/10) are run in the service BEFORE committing — a race condition is handled as a last-resort safety net via the DB's unique constraint (catch the unique-violation exception → return 409 `SLUG_TAKEN`).
