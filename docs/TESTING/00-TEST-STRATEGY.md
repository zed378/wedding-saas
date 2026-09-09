# 00 - Test Strategy

## Philosophy
The Testing Pyramid is applied consistently in both Frontend (FRONTEND/10-TESTING.md) and Backend (BACKEND/09-TESTING.md): many fast unit tests, a moderate amount of integration tests, and a few but critical E2E tests covering the most important flows.

## Test Categories & Ownership
| Category | Scope | Indicative tools | Cadence |
|---|---|---|---|
| Unit Testing | Isolated functions/components/services | Jest/Vitest | Every PR (CI) |
| Integration Testing | Modules + real dependencies (a DB testcontainer) | Jest + Supertest | Every PR (CI) |
| E2E Testing | Full cross-system user flows | Playwright/Cypress | Every staging deploy |
| Security Testing | IDOR, injection, upload, payment tampering | Manual + Burp/ZAP | Every new feature + a full sweep pre-launch |
| Performance Testing | Load/stress on the public page & API | k6/Artillery | Pre-launch + periodically |
| Cross-Browser Testing | Visual/functional compatibility | BrowserStack/manual | Pre-launch + major releases |
| Acceptance Testing | Business & UX criteria met | Manual checklist | Every major release |

## Definition of Done (Every Feature)
- [ ] Unit tests for new logic.
- [ ] Integration tests for new endpoints.
- [ ] The SECURITY/05 checklist (if it's a `:id` endpoint) is satisfied + a related test case.
- [ ] E2E tests added/updated if a critical flow changed.
- [ ] Passes CI (lint, test, security scan).

## Release Criteria Reference
- PLAN/17-ACCEPTANCE-CRITERIA.md and UI-UX/18-UX-ACCEPTANCE-CRITERIA.md are the final gates before an MVP release — this TESTING/ document explains HOW those criteria are verified.
