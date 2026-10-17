# P4-05 — Public Abuse Controls and Adaptive CAPTCHA

| | |
|---|---|
| **Date** | 2026-10-17 |
| **Task** | `TASKS/PHASE-4-ENGAGEMENT.md` § P4-05 |
| **Phase** | Phase 4 |
| **Surface** | backend / infra / docs |
| **Author** | Agent |
| **Commits / PR** | P4-05: Public abuse controls and adaptive CAPTCHA |
| **Status** | Completed |

---

## What Changed

Integrated multi-layered abuse protection for public submission surfaces (`POST /public/i/:slug/rsvp` and `POST /public/i/:slug/guestbook`):
1. Integrated Cloudflare Turnstile server-side verification (`ADR-011`) with test token bypass for local/CI environments.
2. Implemented adaptive challenge activation (`OQ-14`): CAPTCHA challenge remains invisible to ordinary guests; automatically triggers when a published invitation receives 20 submissions within a 10-minute sliding window, persisting for 30 minutes in Redis (`abuse:captcha:<slug>`). Added public probe `GET /public/i/:slug/captcha-status`.
3. Implemented temporary block escalation and manual admin override utilities in `RateLimiter` (`unblockKey`, `unblockIp`).
4. Added optional per-invitation profanity filter (`profanity_filter_enabled` in `invitation_settings`), checking text against `slug_blocklist` using leetspeak normalization (`foldLeet`). Flagged guestbook entries are routed to `pending` moderation queue rather than denied with error.
5. Emitted Prometheus abuse metrics (`wi_abuse_captcha_verifications_total`, `wi_abuse_captcha_activations_total`, `wi_abuse_rate_limit_blocks_total`, `wi_abuse_profanity_flagged_total`) and configured alerting rules in `deploy/prometheus/alerts.yml`.

## Why

Per `docs/SECURITY/10` § Abuse Prevention, `docs/SECURITY/08` § Input Validation, and `OQ-14`:
- Public wedding invitation guestbooks and RSVP forms are high-value targets for comment spam and spam flooding.
- Forcing every genuine guest to solve a CAPTCHA adds friction to wedding invitations. The adaptive velocity circuit-breaker activates Turnstile only when abnormal flood traffic is observed.
- Profanity filters prevent offensive slurs from appearing publicly while ensuring genuine messages are preserved for owner review in moderation (`pending`).

## How

- Created `backend/api/src/shared/abuse/turnstile.service.ts`: Verifies tokens with Cloudflare Turnstile API endpoint using standard form POST. Supports test tokens `1x...` and failure tokens `2x...`/`3x...` in test environment.
- Created `backend/api/src/shared/abuse/profanity.service.ts`: Queries terms from `slug_blocklist` (`category = 'profanity'`), caches for 5 minutes, and checks normalized leetspeak folded input (`foldLeet`).
- Created `backend/api/src/shared/abuse/abuse-protection.service.ts`: Tracks sliding window timestamps in Redis ZSET (`abuse:submissions:<slug>`). Checks if CAPTCHA is required before submission attempt; if threshold (20 in 10m) is crossed, sets `abuse:captcha:<slug>` with 1800s TTL. Enforces Turnstile token validation and profanity checks.
- Created `backend/api/src/shared/abuse/abuse.module.ts` and registered it globally in `AppModule`.
- Added migration `0015_profanity_filter.sql` and `0015_profanity_filter.down.sql` adding `profanity_filter_enabled` (`BOOLEAN NOT NULL DEFAULT false`) to `invitation_settings`.
- Updated `invitation_settings` schema, repositories (`InvitationRepository`, `GuestbookRepository`, `RsvpRepository`), settings service/controller, and DTOs.
- Updated `PublicGuestbookController` and `PublicRsvpController` schemas with `captcha_token`.
- Added `GET /public/i/:slug/captcha-status` to `PublicGuestbookController` and registered in `test/idor-sweep-inventory.spec.ts` under `EXEMPT`.

## Files and Components Touched

| Path | Change |
|---|---|
| `MEMORY/specs/P4-05-abuse-controls-and-adaptive-captcha.md` | Feature spec for P4-05 |
| `backend/api/migrations/0015_profanity_filter.sql` | Up migration adding profanity_filter_enabled |
| `backend/api/migrations/0015_profanity_filter.down.sql` | Down migration dropping profanity_filter_enabled |
| `backend/api/migrations/meta/_journal.json` | Migration journal entry 0015 |
| `backend/api/src/infra/db/schema/invitations.ts` | Schema column `profanityFilterEnabled` |
| `docs/DATABASE/04-INVITATIONS.md` | Documented `profanity_filter_enabled` in table spec |
| `backend/api/src/shared/tenancy/invitation-repository.ts` | Tenancy updates for settings with profanity filter |
| `backend/api/src/shared/tenancy/guestbook-repository.ts` | Returned `profanityFilterEnabled` in target |
| `backend/api/src/shared/tenancy/rsvp-repository.ts` | Returned `profanityFilterEnabled` in target |
| `backend/api/src/modules/invitation/invitation.dto.ts` | Added `profanity_filter_enabled` to DTO & default settings |
| `backend/api/src/modules/invitation/settings.service.ts` | Patched settings with `profanityFilterEnabled` |
| `backend/api/src/modules/invitation/invitation.controller.ts` | Controller validation and patch for profanity filter |
| `backend/api/src/shared/metrics/metrics.ts` | Abuse metrics counters added |
| `deploy/prometheus/alerts.yml` | Alerts `AbuseCaptchaFloodDetected`, `AbuseRateLimitBlocksSpike` |
| `backend/api/src/shared/rate-limit/rate-limiter.ts` | Added unblock methods and block metrics |
| `backend/api/src/shared/sanitizer/registry.ts` | Added `captcha_token` exemption to `NOT_USER_TEXT` |
| `backend/api/src/shared/abuse/turnstile.service.ts` | Cloudflare Turnstile verification service |
| `backend/api/src/shared/abuse/profanity.service.ts` | Profanity term detection service with cache and foldLeet |
| `backend/api/src/shared/abuse/abuse-protection.service.ts` | Velocity tracker and adaptive CAPTCHA governor |
| `backend/api/src/shared/abuse/abuse.module.ts` | NestJS module exporting abuse services |
| `backend/api/src/app.module.ts` | Registered `AbuseModule` |
| `backend/api/src/modules/guestbook/guestbook.service.ts` | Integrated abuse protection and profanity routing |
| `backend/api/src/modules/guestbook/public-guestbook.controller.ts` | Added captcha_token and captcha-status route |
| `backend/api/src/modules/rsvp/rsvp.service.ts` | Integrated abuse protection in RSVP service |
| `backend/api/src/modules/rsvp/public-rsvp.controller.ts` | Added captcha_token to RSVP schema |
| `backend/api/test/idor-sweep-inventory.spec.ts` | Registered GET /public/i/:slug/captcha-status in EXEMPT |
| `backend/api/test/integration/abuse-controls.itest.ts` | Comprehensive integration tests for P4-05 |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Adaptive CAPTCHA Threshold (20 submissions / 10 minutes -> 30 min challenge) | Preserves invisible frictionless experience for normal wedding guests while stopping automated floods (OQ-14). | ADR-089 |
| Profanity routing to `pending` instead of 4xx rejection | Prevents false-positive denial of service for guest wishes while keeping public display clean until reviewed. | ADR-089 |

## Deviations from `docs/`

None. All implementations align with `docs/SECURITY/10`, `docs/DATABASE/04`, and `OQ-14`.

## Tests Added

| Layer | What it covers |
|---|---|
| Integration | `test/integration/abuse-controls.itest.ts` (7 tests):<br>1. Probe returns captcha_required flag for given slug<br>2. Normal traffic succeeds without challenge<br>3. Simulated flood (20 submissions/10m) activates CAPTCHA; rejects missing token with 422 CAPTCHA_REQUIRED<br>4. Rejects invalid Turnstile token with 422 CAPTCHA_INVALID<br>5. Accepts Turnstile test token under active CAPTCHA<br>6. Routes guestbook entry with profanity (and leetspeak) to `pending` when filter enabled<br>7. Preserves `approved` when filter disabled<br>8. Escalates rate-limit blocks and supports manual admin override |
| Unit | `test/idor-sweep-inventory.spec.ts` passes with `/public/i/:slug/captcha-status` registered |
| Security / Architecture | All 5 guard scripts (`check-sanitized-fields`, `check-tenant-scope`, `check-status-writes`, `check-storage-paths`, `check-secrets`) pass cleanly |

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Object-level authorization (404 for a non-owner) | `docs/SECURITY/05` | `idor-sweep-inventory.spec.ts`, `settings.service.ts` scoped query |
| Field whitelisting / no mass assignment | `docs/SECURITY/08` | `settingsSchema.strict()` in `invitation.controller.ts`, `submitGuestbookSchema.strict()`, `submitRsvpSchema.strict()` |
| Free-text sanitization | `docs/SECURITY/08` | `check-sanitized-fields.mjs` (captcha_token in NOT_USER_TEXT) |
| Adaptive flood challenge | `docs/SECURITY/10` | `abuse-controls.itest.ts › 'activates CAPTCHA automatically under a simulated flood and rejects requests without token'` |
| Repeat rate-limit block escalation | `docs/SECURITY/10` | `abuse-controls.itest.ts › 'escalates temporary blocks on repeat rate-limit violations and allows manual admin override'` |

## Abuse Cases Covered

| Abuse case | Source | Test |
|---|---|---|
| Flooding submissions without CAPTCHA under attack | `docs/SECURITY/10` | `abuse-controls.itest.ts › 'activates CAPTCHA automatically under a simulated flood and rejects requests without token'` |
| Forged or invalid CAPTCHA token | `docs/SECURITY/10` | `abuse-controls.itest.ts › 'rejects invalid Turnstile token with 422 CAPTCHA_INVALID'` |
| Repeat rate limit offender | `docs/SECURITY/10` | `abuse-controls.itest.ts › 'escalates temporary blocks on repeat rate-limit violations and allows manual admin override'` |
| Admin manual block lift | `docs/SECURITY/10` | `abuse-controls.itest.ts › 'escalates temporary blocks on repeat rate-limit violations and allows manual admin override'` |
| Profanity injection via leetspeak | `docs/SECURITY/10` | `abuse-controls.itest.ts › 'routes guestbook submission to pending when profanity filter is enabled and profanity is detected'` |

## Definition of Done Verification

- [x] Tests at the appropriate pyramid layer (`abuse-controls.itest.ts`, `idor-sweep-inventory.spec.ts`)
- [x] IDOR test for every new `:id` endpoint / route registered in inventory
- [x] Every abuse case has an automated test
- [x] Write endpoints whitelist their fields (`strict()`)
- [x] Free-text input sanitized before storage; non-user tokens exempted with justification
- [x] Response envelope matches `docs/API/00` (`ok(...)`, standard errors)
- [x] State transitions logged (`metrics` and security logger for blocks)
- [x] Nothing sensitive logged (IP hashed)
- [x] CI green: lint, types (`pnpm typecheck`), unit (772 passing), integration, guards (5/5 passing)
- [x] `TASKS/PROGRESS.md` and the phase file updated
- [x] Task-specific DoD items: Turnstile integration, adaptive trigger, block escalation, profanity filter, metrics & alerts

## What Did Not Work

- In Redis commands, glob pattern `{abuse,rl}:*` does not perform shell brace expansion — separate patterns `abuse:*` and `rl:*` must be retrieved and deleted.
- In Turnstile token verification, mock testing must check for substring inclusion rather than exact match so various mock tokens work across test harnesses.

## Follow-Ups and Open Questions

- Phase 5 (Admin Portal) will wire the admin unblock UI endpoint to `RateLimiter.unblockIp` / `RateLimiter.unblockKey`.

## What to Watch

- Monitor `wi_abuse_captcha_activations_total` for wedding invitations that go viral legitimately.
- Alert `AbuseCaptchaFloodDetected` indicates sustained high-frequency submission attack against public endpoints.
