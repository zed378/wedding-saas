# 14 - Analytics

## MVP (Minimal)
- Page view counter per public invitation (increment counter, individual per-visitor tracking is NOT needed for MVP — aggregate is sufficient).
- Number of RSVPs submitted vs. total guests invited (if manually entered by the owner as a target, optional).
- Simple dashboard on the owner's page: total visits, total RSVP attending/not-attending/maybe, total guestbook messages.

## Phase 2
- More detailed analytics: unique visitors (via hashed IP+UA, not full PII — a privacy consideration), referrer (where traffic comes from, e.g., WhatsApp share), device breakdown, peak visit times.
- Internal product funnel (admin-facing): draft → paid → published conversion, drop-off per editor step.
- Event tracking: most popular templates chosen, sections most frequently disabled (feedback for template design).

## Implementation Summary
- MVP: increment the counter directly in the public page request handler with write-behind/batching to the DB (avoid per-request writes directly to the primary DB — use a cache counter + periodic flush, see ARCHITECTURE/06-CACHING-ARCHITECTURE.md). The destination table and the flush semantics are specified in DATABASE/11-ANALYTICS.md.
- Phase 2: consider a third-party analytics tool (privacy-friendly, e.g., Plausible) for public pages, combined with custom internal events for the product funnel.

## Privacy
- No personal data is stored for anonymous visitors without a clear purpose (aligned with SECURITY/09-PRIVACY-DATA-PROTECTION.md). RSVP/guestbook is data consciously provided by the visitor, not passive tracking.
