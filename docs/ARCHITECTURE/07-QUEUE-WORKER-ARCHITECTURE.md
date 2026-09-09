# 07 - Queue & Worker Architecture

## Technology
- A message queue (e.g., a Redis-based BullMQ/Sidekiq-equivalent, or a managed SQS) — the choice is flexible per stack; the principles below are mandatory.

## Job Types
| Job | Trigger | Priority | Retry Policy |
|---|---|---|---|
| Payment webhook processing | Incoming webhook | High | Idempotent retry, max 5x exponential backoff |
| Media processing (resize, strip EXIF) | Upload received | High | Retry 3x, dead-letter on failure |
| Email notification | Various domain events | Medium | Retry 3x, dead-letter |
| Cache invalidation/regeneration | Invitation update | Medium | Retry 3x |
| Invitation expiry check | Daily cron | Low | Idempotent, safe to re-run |
| Soft-delete → hard-delete cleanup | Daily cron | Low | Idempotent |
| Analytics counter flush | Cron per minute | Low | Best-effort, safe to drop on failure (non-critical) |
| Custom domain DNS verification (Phase 2) | Periodic cron | Medium | Retry with long backoff |

## Principles
- All jobs MUST be idempotent (safe to run more than once with the same payload) — crucial for payment webhooks & media processing.
- Permanently failed jobs go into a **dead-letter queue**, which is monitored & alerted on (see DEVOPS/07-ALERTING.md) and must never be silently dropped for "High"/"Medium" category jobs.
- Workers run separately from the main API process (independent scaling) — workers can scale up during heavy upload/webhook periods without affecting API latency.

## Scheduling (Cron Jobs)
- Invitation expiry check: daily at 00:05 WIB.
- Soft-delete cleanup: daily at 01:00 WIB.
- H-7/H-1 reminder email: daily at 08:00 WIB.
- Analytics flush: every 1 minute.

## Observability
- Every job execution logs: job type, related invitation_id/order_id, execution duration, status (success/fail/retry) — for debugging & monitoring (DEVOPS/06-LOGGING.md).
