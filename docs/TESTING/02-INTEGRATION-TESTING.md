# 02 - Integration Testing

## Scope
Real interaction between layers: Controller → Service → Repository → Database (a testcontainer, not a mock DB) — verifying the wiring & DB constraints actually work as designed.

## Setup
- A PostgreSQL testcontainer (a fresh instance per test suite run, migrations run automatically) — consistent with the DATABASE/ schema.
- A Redis testcontainer for tests involving cache/rate-limit.
- Mock EXTERNAL dependencies only (the payment gateway API, the email provider) via HTTP mocking (e.g., nock/MSW) — the internal stack (DB, cache) stays real.

## Mandatory Scenarios per Module
- **Invitation module**: create → update a sub-resource (event, gallery) → verify data consistency via GET → delete (soft) → verify it's absent from the list but still exists in the DB with `deleted_at` populated.
- **Media module**: upload → verify the `media` record's status transitions `processing→ready` (with the job run synchronously in the test environment) → attach to the gallery → verify FK constraints (media belonging to a different invitation is rejected when attaching).
- **Order/Payment module**: create an order → simulate a webhook (a valid payload + signature) → verify Order, Payment, Invitation state all changed within a single transaction (also test a partial-failure scenario — if one update fails, all of it rolls back).
- **Publishing module**: publish with complete data (success) vs. incomplete data (failure, the response contains the missing fields) vs. a slug conflict (409).
- **RBAC/Authorization**: every `:id` endpoint — a request from a different (non-owner) user → 404; from an admin → success (and logged to the audit log if that endpoint genuinely bypasses ownership).

## Test Pattern
```
beforeEach: reset the DB to a clean state (a transaction rollback per test OR truncate the tables)
test: arrange data (a factory/fixture) → call the endpoint via a test HTTP client → assert the response + directly assert the DB state (a verification query)
```

## Test Data Factory
- Use a factory function/library (not repeatedly hard-coded object literals) to create consistent test data (`createTestUser()`, `createTestInvitation({ owner })`, etc.) — makes complex scenarios easier (e.g., 2 users each with their own invitation for an IDOR test).
