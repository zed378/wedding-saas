# 05 - Monitoring

## Key Metrics (per component)
| Component | Metric |
|---|---|
| Backend API | Request rate, error rate (4xx/5xx), latency p50/p95/p99, per endpoint |
| Public Invitation | Cache hit ratio, response time, traffic per invitation (spike detection) |
| Database | Connection pool usage, query latency, replication lag (if a replica exists), disk usage |
| Redis | Memory usage, hit ratio, eviction rate |
| Queue/Worker | Queue depth, job processing time, dead-letter queue size |
| Object Storage | Storage usage growth, request rate |
| Payment | Webhook success rate, signature validation failure rate (an indicator of fraud attempts) |

## Dashboard
- A real-time operational dashboard (e.g., Grafana) showing the metrics above, with drill-down per environment.
- A separate business dashboard (for the Product Owner): invitations per status, daily revenue, conversion funnel — from PLAN/14-ANALYTICS.md.

## Health Check
- A `/health` endpoint in every service (API, Worker) — checked by the load balancer before routing traffic (readiness) and for auto-restart if unhealthy (liveness).
- The health check verifies connectivity to critical dependencies (DB, Redis) without performing heavy operations.

## Synthetic Monitoring
- Periodic external uptime checks (e.g., every 1 minute) for key public endpoints (the landing page, a sample invitation page, the API health check) from outside the infrastructure — detecting issues that might not be caught by internal monitoring (e.g., a DNS/CDN issue).

## Cache Hit Ratio Target
- Public Invitation: target > 90% during normal traffic (ARCHITECTURE/06) — a significant drop from the baseline triggers investigation (could indicate excessive cache invalidation/a bug).

## Distributed Tracing (optional, recommended as scale grows)
- A `trace_id` consistent from the incoming request through to the related worker job, making it easier to debug async flows (e.g., tracing a single photo upload from the request all the way through worker processing).
