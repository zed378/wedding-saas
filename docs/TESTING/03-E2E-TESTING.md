# 03 - E2E Testing

## Critical Flows That Must Be Covered (see also FRONTEND/10-TESTING.md)
1. **Full happy path**: Register → verify email (mocked) → select a template → fill in minimal complete invitation data → checkout → simulate a successful payment (a sandbox provider) → publish → open the public page → verify the data displays correctly.
2. **Changing templates mid-flow**: fill in data with Template A → switch to Template B → verify relevant data remains, unsupported sections are hidden.
3. **Public RSVP & Guestbook**: open the public page (without logging in) → submit an RSVP → submit a guestbook entry → (if moderation is enabled) verify it doesn't appear publicly until the owner approves it from the dashboard.
4. **Multi-tenancy isolation (E2E level)**: log in as User A, create an invitation → log in as User B (a separate browser context) → try accessing User A's editor URL directly → verify it's denied/redirected, WITHOUT displaying User A's data.
5. **Failed/expired payment**: an order is created but not paid until it expires → verify the UI shows the correct status & the user can create a new order.
6. **Admin moderation**: log in as an admin → view a pending guestbook entry → approve it → verify it appears on the public page.

## Environment
- Run against `staging` (not production), with the payment gateway in sandbox mode.
- Test data is cleaned/isolated per run (avoiding test pollution across runs).

## Test Stability
- Avoid flaky tests: use explicit waits for conditions (an element appears/a status changes), not a fixed `sleep`.
- A limited automatic retry (e.g., 1x) to mitigate infrastructure flakiness, BUT consistent failures must still be investigated, not skipped.

## Reporting
- E2E run results are wired into the CI/CD pipeline (DEVOPS/01) — a failure in a critical flow's E2E test blocks promotion to production.

## Screenshot/Video on Failure
- The test runner is configured to record a screenshot/video on failure — speeding up debugging without needing to reproduce it manually.
