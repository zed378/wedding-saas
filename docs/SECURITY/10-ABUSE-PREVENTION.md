# 10 - Abuse Prevention

## Rate Limiting (per endpoint category)
| Endpoint | Limit | Window | Key |
|---|---|---|---|
| `POST /auth/login` | 5 failed attempts | 15 minutes | (email, IP) |
| `POST /auth/register` | 5 | 1 hour | IP |
| `POST /auth/forgot-password` | 3 | 1 hour | (email, IP) |
| `POST /public/i/:slug/rsvp` | 10 | 1 hour | (IP hash, slug) |
| `POST /public/i/:slug/guestbook` | 10 | 1 hour | (IP hash, slug) |
| `POST /invitations` (create new) | 10 | 1 day | user_id |
| `POST /invitations/:id/media` | 60 | 1 hour | user_id |
| General authenticated API | 300 | 1 minute | user_id |
| General public API | 100 | 1 minute | IP |

The limits above are an initial baseline — to be adjusted based on real traffic data post-launch, and are configurable (not hard-coded) for easy tuning.

## Slug Blocklist
- Forbidden words: reserved system words (`admin`,`api`,`www`,`app`,`mail`,`ftp`, etc.), hate speech/profanity (a separately curated list, managed by admins, updatable without a deploy). Stored in the `slug_blocklist` table — see DATABASE/12-PLATFORM-CONFIG.md for the schema, the `exact` versus `substring` match semantics, and the governance rules.
- Validation is case-insensitive and includes basic substring checks for common variations (basic leetspeak) if needed.
- **Every path segment served on the public invitation host is a reserved slug.** Invitations sit at the root of that host (PLAN/10), so an unreserved route would be able to shadow a published invitation and take it offline silently. CI fails if a route exists whose segment is not in `slug_blocklist` (see the admin blocklist task in TASKS Phase 5).

## Guestbook/RSVP Spam
- The rate limits above + optional CAPTCHA (e.g., hCaptcha/Turnstile), automatically enabled if a suspicious-traffic threshold is exceeded on a given slug (adaptive, not always-on — preserving guest UX).
- Simple spam pattern detection: identical repeated messages from different IP hashes in a short time window → auto-flagged for moderation, not auto-blocked (avoiding false positives).

## Content Moderation
- Guestbook & free-text fields may go through a basic profanity filter (optional, togglable per invitation) as an additional layer before entering the manual moderation queue (PLAN/12).

## Preventing Enumeration
- Non-sequential UUIDs for all IDs that are exposed (SECURITY/05).
- Public endpoints don't leak, via timing/differing responses, whether a slug ever existed vs. was never registered at all (a consistent 404 response).

## Account Abuse
- Detect mass account creation (a disposable-email domain blocklist, per-IP rate limiting on registration) to prevent free-tier draft-invitation quota abuse.

## Monitoring & Auto-block
- An IP/device that repeatedly violates rate limits within a short period is temporarily blocked (e.g., 1 hour), with the duration increasing on repeat violations — managed automatically by the system, with the possibility of a manual admin override.
