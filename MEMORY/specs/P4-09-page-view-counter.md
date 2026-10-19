# P4-09 — Feature Spec: Page View Counter with Write-Behind Flush

| | |
|---|---|
| **Task** | `TASKS/PHASE-4-ENGAGEMENT.md` § P4-09 |
| **Date** | 2026-10-19 |
| **Author** | Agent |
| **Status** | Reviewed |

---

## 1. Goal

Track page views for published wedding invitations at a daily aggregate grain without writing to the primary PostgreSQL database synchronously on every visitor request. The public page sends a fire-and-forget beacon to `POST /public/i/:slug/view`, which increments an in-memory Redis counter. A scheduled domain job (`analytics_counter_flush`, executing every 1 minute) folds the accumulated view increments into `invitation_view_counts` using an idempotent SQL upsert.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/PLAN/14-ANALYTICS.md` | § MVP, § Implementation Summary, § Privacy | MVP aggregate counter without personal visitor tracking; Redis cache counter with write-behind periodic flush. |
| `docs/DATABASE/11-ANALYTICS.md` | § Table: invitation_view_counts, § Write Path, § Privacy, § Retention | Schema for `invitation_view_counts` (composite PK: `invitation_id`, `view_date`), upsert query on conflict, best-effort failure semantics, zero visitor PII. |
| `docs/API/08-PUBLIC-INVITATION-API.md` | § Endpoints list | `POST /public/i/:slug/view` endpoint, rate-limited, fire-and-forget from client. |
| `docs/ARCHITECTURE/06-CACHING-ARCHITECTURE.md` | § What Is Cached | Analytics counter in Redis with periodic flush to DB (every 1 min). |
| `docs/BACKEND/08-JOBS-WORKERS.md` | § Scheduled Job List | `analytics_counter_flush` every 1 minute scheduled by `worker-cron`, consumed by API jobs process. |
| `docs/SECURITY/09-PRIVACY-DATA-PROTECTION.md` | § Anonymous Visitors | No personal data stored for passive page views (no IP, no user agent, no cookies, no visitor fingerprinting). |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-Analytics-1 | Page views are aggregated per invitation and per day in WIB (`Asia/Jakarta`). | `AnalyticsService` |
| BR-Analytics-2 | A page view performs no synchronous write to the primary PostgreSQL database. | `PublicViewController` & `AnalyticsService.recordView` |
| BR-Analytics-3 | Zero per-visitor data (no IP, no UA, no fingerprint) is stored. | `AnalyticsService` |
| BR-Analytics-4 | The 1-minute flush job is idempotent and its failure mode is explicitly best-effort. | `AnalyticsService.flushViewCounts` |

## 4. API Contract

### Method and Path
- `POST /public/i/:slug/view`

### Request Schema
- Headers: standard HTTP headers; `X-Forwarded-For` forwarded for rate limiting.
- Body: empty or empty JSON object `{}` (strict schema, unknown fields rejected if a JSON body is sent).

### Success Response
- Status: `200 OK`
- Envelope:
  ```json
  {
    "success": true,
    "data": {
      "recorded": true
    }
  }
  ```

### Error Cases
- `404 Not Found`: slug not found, not published, or soft-deleted (`NOT_FOUND`).
- `429 Too Many Requests`: exceeded public rate limit (`TOO_MANY_ATTEMPTS`).
- Degraded dependency: If Redis is unavailable, the endpoint logs a warning and fails open, returning `200 OK` (`recorded: false`) so that a monitoring failure never degrades guest page rendering.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `invitation_view_counts` | Read / Write | Upserted by `analytics_counter_flush` job every 1 min. Read in Phase 4 P4-10 for owner analytics. |
| `invitations` | Read | Validated via `publicInvitationRepo.findPublishedBySlug(slug)` or `PublicInvitationCache`. |

- Migration required: **No**. Table `invitation_view_counts` was already generated and applied in baseline migration `0003_invitations.sql` with composite primary key `(invitation_id, view_date)` and foreign key to `invitations(id) ON DELETE CASCADE`.

## 6. Authorization

- Who may call this? Any anonymous guest viewing a public invitation page.
- How is authorization enforced? Public route checked against `status = 'published' AND deleted_at IS NULL`. Unpublished or draft invitations return `404 Not Found`, disclosing nothing.
- Non-owner: Not applicable for public surface; 404 for nonexistent/unpublished invitations.
- Rate limiting: `rateLimit("general-public")` per IP hash so malicious actors cannot flood the counter.

## 7. Validation and Sanitization

- Structural validation: optional empty object `z.object({}).strict().optional()`.
- Business validation: slug exists and belongs to an active `published` invitation.
- Free-text fields: none.
- Explicitly not accepted: visitor IDs, tracking parameters, arbitrary timestamps.

## 8. State Transitions

- None. Invitation lifecycle state is untouched.

## 9. Side Effects

- Atomic Redis hash increment: `HINCRBY analytics:views:pending "${invitationId}:${todayWib}" 1`.
- Every minute: `worker-cron` triggers `analytics_counter_flush` domain job.
- `analytics_counter_flush` performs atomic rename to `analytics:views:flushing:<uuid>`, reads accumulated counts, batch upserts to `invitation_view_counts`, and deletes the flushing key.

## 10. Failure Modes

- Redis unreachable: `recordView` catches error, logs warning, and returns `{ recorded: false }`. No 500 error is returned to the public guest (fail open for non-critical analytics).
- Database unreachable during flush: Job catches error, logs warning, and increments Prometheus failure metric. As documented in `docs/DATABASE/11` and `docs/ARCHITECTURE/07`, the flush is explicitly best-effort: dropping a batch on persistent DB failure is an acceptable trade for a vanity metric during traffic spikes.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Flooding view counter | `docs/SECURITY/10` | Rate limiter throttles rapid successive requests with 429. | `PublicViewController > rate limits excessive view requests` |
| View counter on unpublished draft | `docs/SECURITY/05` | Returns 404; no counter increment recorded in Redis. | `PublicViewController > returns 404 and does not increment for draft or nonexistent invitation` |
| Injecting tracking payload / PII | `docs/SECURITY/09` | Payload validation rejects non-whitelisted keys with 400; no IP/UA stored. | `PublicViewController > rejects non-whitelisted body keys` |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit (`backend/api/test/analytics.spec.ts`) | 1. Incrementing view counter in Redis.<br>2. Handling unpublished/missing slugs (404).<br>3. Fail-open when Redis is unavailable.<br>4. Flush job folds Redis counts into `invitation_view_counts` via upsert.<br>5. Consecutive flushes accumulate view counts correctly.<br>6. Zero visitor identity/IP stored. |
| Integration (`frontend/public-invite`) | Client beacon component mounts on public invitation page and dispatches fire-and-forget view request. |

## 13. Observability

- Prometheus metric `wi_page_views_total{status="recorded|failed"}`.
- Prometheus metric `wi_analytics_flush_total{status="success|failure"}`.
- Structured logger events: `analytics.view_recorded`, `analytics.flush_completed`.
