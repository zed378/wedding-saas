# 05 - Performance Testing

## Load Test Scenarios

### 1. Public Invitation — Traffic Spike Simulation
Simulates a real-world condition: many guests opening the same invitation link close together (on the wedding day).
```
Tools: k6/Artillery
Scenario: ramp-up from 10 → 1000 concurrent virtual users over 2 minutes,
          all requesting the SAME public invitation page (the hardest case for the cache).
Target: p95 response time < 1s, error rate < 0.1%, cache hit ratio stays > 90% after the initial warm-up.
```

### 2. General API — Sustained Load
```
Scenario: 200 req/s sustained for 10 minutes against a mixed set of authenticated invitation CRUD endpoints.
Target: p95 < 500ms (aligned with PLAN/17-ACCEPTANCE-CRITERIA.md), no 5xx errors from resource exhaustion.
```

### 3. Media Upload — Concurrent Upload
```
Scenario: 50 concurrent users each uploading a ~5MB photo simultaneously.
Target: all uploads finish processing (status ready) within a reasonable time (< 30 seconds to enter the queue + process), no job gets stuck/times out.
```

### 4. Payment Webhook — Burst
```
Scenario: simulate a burst of simultaneously incoming webhooks (a provider retry storm).
Target: idempotency remains correct (no double-processing), no race condition on the status update.
```

## Test Conditions
- Run on the `staging` environment with resource specs similar to production (or proportionally scaled with results normalized).
- Database & cache in a warmed state (not a cold-start) for a realistic scenario, AND also tested separately for a cold-start condition to determine the worst case.

## Bottleneck Investigation
- If the target isn't met: profile slow DB queries (the slow query log), analyze the cache miss pattern, check container resource limits (CPU/memory throttling).

## Cadence
- Mandatory before the MVP launch (PLAN/17). After launch: periodically (e.g., quarterly) or before an anticipated high-traffic event (wedding season).
