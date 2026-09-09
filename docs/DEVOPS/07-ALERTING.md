# 07 - Alerting

## Principle
- Alerts should only fire for conditions that require human action (actionable) — avoiding alert fatigue from excessive noise.

## Key Alerts
| Condition | Severity | Channel |
|---|---|---|
| API error rate > 5% for 5 minutes | Critical | Page on-call directly (e.g., PagerDuty) |
| Public Invitation cache hit ratio drops drastically (< 50%) suddenly | High | Slack + investigate |
| Database connection pool > 90% used | High | Slack + investigate |
| Database backup job failed | Critical | Page on-call |
| Dead-letter queue grows (payment/media job permanently failed) | High | Slack + investigate |
| Payment webhook signature invalid above a threshold within a short period | High (indicates a possible fraud attempt) | Slack security channel |
| Consecutive failed logins from the same IP well above a threshold | Medium | Slack security channel |
| Storage disk usage > 85% | Medium | Slack |
| SSL certificate nearing expiry (< 14 days) | Medium | Slack + email |
| A synthetic uptime check fails 2x in a row | Critical | Page on-call |
| Custom domain DNS verification repeatedly fails (Phase 2) | Low | Dashboard only (no paging) |

## Escalation
- A Critical alert without acknowledgement within 15 minutes → escalates to secondary on-call/the lead.
- Every Critical/High alert triggers an evaluation of whether it meets the criteria for Incident Response (SECURITY/12-INCIDENT-RESPONSE.md).

## Periodic Review
- Alert rules are reviewed monthly — removing/tuning rules that frequently false-positive, adding new alerts for incidents that have occurred but weren't yet covered (a post-mortem action item).
