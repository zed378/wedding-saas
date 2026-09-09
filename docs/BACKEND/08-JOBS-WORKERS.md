# 08 - Jobs & Workers (Technical Implementation)

Technical complement to ARCHITECTURE/07-QUEUE-WORKER-ARCHITECTURE.md.

## Scheduled Job List (Cron)
```
media_cleanup_staging        every 1 hour    — deletes orphaned staging files > 1 hour old
order_expire_check            every 15 minutes — sets pending orders past expiry to expired
invitation_expiry_check        daily 00:05 WIB — sets published invitations past expiry to expired
invitation_soft_delete_cleanup  daily 01:00 WIB — hard-deletes soft_deleted items > 90 days old
reminder_email_h7_h1             daily 08:00 WIB — sends expiry reminders
analytics_counter_flush           every 1 minute — flushes the Redis counter → DB
custom_domain_dns_check (Phase 2)  every 10 minutes — verifies pending DNS status for custom domains
payment_reconciliation (optional)   daily 03:00 WIB — cross-checks transactions against the provider
```

## Event-Driven (Triggered) Job List
```
media.process                 from a received media upload
payment.webhook_process        from an incoming webhook (if processed async, optional — can also be sync within the handler if it's fast enough)
notification.send                from various domain events (see 07-NOTIFICATION.md)
cache.invalidate                  from invitation.updated/published/unpublished
```

## Worker Configuration
- Separate worker pools per load category: `worker-media` (CPU-intensive, scales independently), `worker-general` (email, cache, other light jobs), `worker-cron` (scheduled process runner, usually 1 instance with leader-election if multi-instance to avoid duplicate execution of cron jobs).

## Idempotency Pattern (applied to all jobs)
```
async function processJob(jobData) {
  const alreadyProcessed = await checkIdempotencyKey(jobData.idempotencyKey);
  if (alreadyProcessed) return; // a safe no-op
  await doWork(jobData);
  await markProcessed(jobData.idempotencyKey);
}
```

## Retry & Dead Letter
- Per-job retry configuration (see the table in ARCHITECTURE/07) — critical jobs (payment, media) retry more aggressively than best-effort jobs (analytics flush).
- The dead-letter queue is monitored via a separate dashboard, alerting the on-call channel when a new entry appears for "High"/"Medium" category jobs (DEVOPS/07-ALERTING.md).

## Observability per Job
- Every job execution logs: `job_name`, `started_at`, `finished_at`, `status`, `related_id` (invitation_id/order_id if relevant), `error_message` on failure — for the monitoring dashboard & debugging (DEVOPS/05-MONITORING.md).
