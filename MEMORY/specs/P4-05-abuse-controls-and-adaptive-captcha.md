# P4-05 — Feature Spec: Public Abuse Controls and Adaptive CAPTCHA

| | |
|---|---|
| **Task** | P4-05 |
| **Date** | 2026-10-17 |
| **Author** | AI |
| **Status** | Draft |

---

## 1. Goal

Provide layered abuse controls for public wedding invitation interactions (`POST /public/i/:slug/rsvp` and `POST /public/i/:slug/guestbook`) that remain completely invisible during normal weddings, but dynamically activate Cloudflare Turnstile challenges (`ADR-011`) when a slug experiences suspicious traffic floods (`OQ-14`). Escalate temporary IP blocks on repeat rate-limit violators, provide an optional per-invitation profanity filter that routes flagged entries to the moderation queue rather than blocking outright, and emit real-time abuse metrics with Prometheus alert rules (`docs/DEVOPS/07`).

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/SECURITY/10-ABUSE-PREVENTION.md` | § Guestbook/RSVP Spam | Adaptive CAPTCHA (Turnstile) enabled when suspicious-traffic threshold exceeded on a slug; duplicate spam detection flags to moderation |
| `docs/SECURITY/10-ABUSE-PREVENTION.md` | § Content Moderation | Basic profanity filter (optional, togglable per invitation) before entering manual moderation queue |
| `docs/SECURITY/10-ABUSE-PREVENTION.md` | § Monitoring & Auto-block | Escalating temporary blocks for repeat violators, with manual admin override |
| `docs/PLAN/18-RISK-REGISTER.md` | R8 | RSVP/guestbook spam disrupts UX & storage — mitigated by rate limits and CAPTCHA |
| `docs/DEVOPS/07-ALERTING.md` | § Key Alerts | Alerts on suspicious abuse floods and consecutive security failures |
| `docs/DATABASE/04-INVITATIONS.md` | `invitation_settings` | Per-invitation settings table, extended with `profanity_filter_enabled` |
| `TASKS/BACKLOG.md` | `OQ-14` | CAPTCHA activation threshold: initial threshold set to 20 submissions per 10 minutes per slug, activating for 30 minutes |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-7.1 / BR-7.3 | Guestbook moderation & status management | `GuestbookService`: profanity match routes entry to `pending` queue |
| R8 | RSVP/Guestbook spam mitigation | `CaptchaService`: adaptive challenge activation under flood |
| OQ-14 | Adaptive threshold | `AbuseProtectionService`: activates CAPTCHA on slug receiving > 20 requests in 10m window |
| Monitoring & Auto-block | Escalating rate-limit blocks | `RateLimiter`: 15m doubling per strike up to 24h, plus admin unblock |

## 4. API Contract

### 4.1. Public Submissions (`POST /public/i/:slug/rsvp` & `POST /public/i/:slug/guestbook`)
- Body additions: optional `captcha_token?: string`.
- When CAPTCHA is **inactive** on the slug: `captcha_token` is optional and ignored; normal guests experience zero challenge.
- When CAPTCHA is **active** on the slug:
  - If `captcha_token` is missing or empty: returns `422 Unprocessable Entity`:
    ```json
    {
      "error": {
        "code": "CAPTCHA_REQUIRED",
        "message": "Verifikasi keamanan diperlukan. Silakan selesaikan CAPTCHA."
      }
    }
    ```
  - If `captcha_token` is present but verification fails with Cloudflare: returns `422 Unprocessable Entity`:
    ```json
    {
      "error": {
        "code": "CAPTCHA_INVALID",
        "message": "Verifikasi CAPTCHA gagal. Silakan coba lagi."
      }
    }
    ```

### 4.2. Captcha Status Check (`GET /public/i/:slug/captcha-status`)
- Returns whether Turnstile is currently required for submissions on the slug:
  ```json
  {
    "data": {
      "captcha_required": false
    }
  }
  ```

### 4.3. Invitation Settings (`PATCH /api/v1/invitations/:id/settings`)
- Accepted fields include `profanity_filter_enabled?: boolean`.
- Response: updated `invitation_settings` including `profanity_filter_enabled`.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `invitation_settings` | Read & Write | Add `profanity_filter_enabled` (`BOOLEAN NOT NULL DEFAULT false`). Expand-only migration `0015_profanity_filter`. |
| `slug_blocklist` | Read | Read terms with `category = 'profanity'` and `match_type = 'substring'`. |

Migration required: Yes (`0015_profanity_filter.sql` and `0015_profanity_filter.down.sql`). Expand-contract safe: column has default `false`.

## 6. Authorization

- Public submission endpoints remain unauthenticated (`docs/API/08`).
- Settings endpoints enforce query-level tenant scoping (`WHERE owner_id = :scope AND deleted_at IS NULL`) returning 404 for non-owners (`docs/SECURITY/05`).
- Admin unblock method: callable by admin / internal service with audit logging.

## 7. Validation and Sanitization

- `captcha_token`: string, trimmed, max 2048 chars, optional when inactive, required when active.
- `profanity_filter_enabled`: boolean.
- Profanity checking:
  - Checks text against `slug_blocklist` profanity terms using leetspeak normalization (`foldLeet`).
  - If profanity is detected and `profanity_filter_enabled` is true:
    - Guestbook: forces entry status to `pending` (for owner moderation) regardless of `guestbook_moderation` setting.
    - RSVP: preserves submission while recording profanity flag in log and internal metadata.

## 8. State Transitions

- Guestbook entry that matches profanity filter transitions to `status = 'pending'`, ensuring offensive content never displays publicly without explicit owner approval.

## 9. Side Effects

- Redis velocity tracking: increments rolling 10-minute window counter `abuse:velocity:<slug>`.
- If velocity exceeds 20, sets `abuse:captcha:<slug>` with TTL 1800s (30m).
- Increments Prometheus counters in `metrics.ts`:
  - `wi_abuse_captcha_verifications_total{result="success|failure|missing"}`
  - `wi_abuse_captcha_activations_total{slug="..."}`
  - `wi_abuse_rate_limit_blocks_total{policy="..."}`
  - `wi_abuse_profanity_flagged_total{surface="guestbook|rsvp"}`

## 10. Failure Modes

- Cloudflare Turnstile API outage / timeout:
  - If `TURNSTILE_SECRET_KEY` is not set or network fails in test environment, use mock/fallback behavior.
  - In production, log error and fail closed if challenge was explicitly triggered by abuse flood.
- Redis unavailable:
  - Public limiter fails open per `ADR-050`, but logs error.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Flooding submissions without CAPTCHA under attack | `docs/SECURITY/10` | Automatic activation after 20 attempts; subsequent requests rejected with 422 `CAPTCHA_REQUIRED` | `activates CAPTCHA automatically under a simulated flood and rejects requests without token` |
| Forged or invalid CAPTCHA token | `docs/SECURITY/10` | Cloudflare verification fails; returns 422 `CAPTCHA_INVALID` | `rejects invalid Turnstile token with 422 CAPTCHA_INVALID` |
| Repeat rate limit offender | `docs/SECURITY/10` | Temporary escalating block applied with Retry-After header | `escalates temporary blocks on repeat rate-limit violations` |
| Admin manual block lift | `docs/SECURITY/10` | Admin unblocks key; subsequent requests permitted immediately | `allows manual admin override to lift block` |
| Profanity injection in guestbook | `docs/SECURITY/10` | Routed to pending queue when profanity filter is enabled | `routes guestbook message with profanity to pending moderation` |

## 12. Test Plan

- Unit tests: Turnstile verification, adaptive trigger window, profanity detection algorithm.
- Integration tests: End-to-end simulated flood on public RSVP & guestbook triggering CAPTCHA, verifying valid Turnstile token unlocks submission, testing profanity filter routing to pending queue, and testing escalating rate-limit blocks and admin lift.

## 13. Observability

- Metrics in `metrics.ts`:
  - `wi_abuse_captcha_verifications_total`
  - `wi_abuse_captcha_activations_total`
  - `wi_abuse_rate_limit_blocks_total`
  - `wi_abuse_profanity_flagged_total`
- Prometheus Alert Rules in `deploy/prometheus/alerts.yml`:
  - `AbuseCaptchaFloodDetected`: Fires when `sum(increase(wi_abuse_captcha_activations_total[10m])) > 3`
  - `AbuseRateLimitBlocksSpike`: Fires when `sum(increase(wi_abuse_rate_limit_blocks_total[10m])) > 10`
