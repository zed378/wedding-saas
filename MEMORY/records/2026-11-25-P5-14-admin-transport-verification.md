# P5-14 — Admin Transport Correction and Regression Verification

| | |
|---|---|
| Date | 2026-11-25 |
| Task | TASKS/PHASE-5-ADMIN-PANEL.md § P5-14 |
| Phase / surface | Phase 5; shared API client, admin |
| Author | Parallel coding agent |
| Commits / PR | Uncommitted shared Phase 5 working branch |
| Status | Transport correction and automated admin verification completed; broader acceptance tracked separately |

## What Changed

The shared API client now resolves an empty or path-relative API base against the browser origin. Existing absolute API bases retain their original behavior, including non-browser callers. The admin order/refund test fixtures now use the real API/00 success envelope and accept resolved absolute request URLs.

## Why

The admin production pages use `baseUrl: ""` for same-origin requests. Previously `ApiClient.#url` passed a relative string to `new URL` without a base, raising `Invalid URL` before `fetch` ran. Unit tests which mocked `ApiClient.get` did not expose the failure. The full admin regression run and actual order-page transport revealed it during P5-14 acceptance preparation. FRONTEND/08 § Global Fetch Error Handling and API/00 require these pages to use the common functioning transport.

## How

URL construction supplies `location.origin` only when a browser location exists. `new URL` still treats absolute targets as absolute; server callers with an absolute configured base require no location. Existing query encoding, bearer headers, credential inclusion, refresh callback and error handling are unchanged. No endpoint, request body or stored record changes.

## Files and Components Touched

| Path | Change |
|---|---|
| packages/api-client/src/client.ts | Browser-origin URL resolution and configuration comment |
| packages/api-client/src/client.spec.ts | Same-origin URL/query and absolute cross-origin regressions |
| admin/src/pages/orders.spec.tsx | Real response envelope and resolved URL assertion |
| MEMORY/records/2026-11-25-P5-14-admin-transport-verification.md | This record |

The client distribution was rebuilt locally before tests/build because package exports target `dist`. Build outputs are generated, ignored artifacts.

## Decisions Made

Correct shared URL construction rather than repeat caller workarounds across admin pages. This is a backward-compatible implementation correction, not an architectural or product decision; no ADR is required. The concurrent invitation page's explicit-origin correction is preserved.

## Deviations from docs/

None. Absolute server API bases and the browser's same-origin host retain their intended separation.

## Tests Added and Run

| Layer | Evidence |
|---|---|
| Client unit regressions | `resolves same-origin browser requests and query parameters against the admin host`; `preserves an absolute API base when the browser has a different origin` |
| Entire client package | `rtk proxy node node_modules/vitest/vitest.mjs run --maxWorkers=1` in packages/api-client: **2 files / 33 tests passed** |
| Client build | `rtk proxy node node_modules/typescript/bin/tsc -p packages/api-client/tsconfig.json`: passed |
| Admin types | `rtk proxy node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` in admin: passed |
| Entire admin suite | `rtk proxy node node_modules/vitest/vitest.mjs run --maxWorkers=1 --reporter=verbose` in admin: **14 files / 73 tests passed**, 208.09 seconds |
| Admin production build | `rtk proxy node node_modules/vite/bin/vite.js build` in admin after client rebuild: passed, 183 modules; JS 873.09 kB / gzip 207.20 kB |
| Formatting | Prettier check passed for all three changed TypeScript files |
| Browser visual verification | Browser skill read; Node browser bootstrap rejected before code execution by `codex/sandbox-state-meta: missing field sandboxPolicy`. No browser interaction, screenshot or visual QA claimed |

## Security Verification

No authorization, tenant query, payment status write, upload or sanitization path changes. Client tests `sends the bearer token when there is one`, `includes credentials so the HTTP-only refresh cookie travels`, and existing concurrent refresh/session termination cases all passed. Admin tests `loads API data with bearer authentication`, `exchanges the factor for a token before refund with X-MFA-Step-Up and reason only`, `does not submit refund when factor verification fails`, and the StepUpModal fail-closed suite passed through the unchanged transport/auth contracts. These automated UI tests do not establish real-provider money movement or database audit atomicity; separate integration tests own those controls.

## Abuse Cases Covered

The cross-origin-base regression proves browser location cannot redirect a deliberately configured absolute API base to the current page host. Existing bearer/refresh tests and the full admin role-boundary suite remain green. Same-origin admin reads now reach their intended host rather than failing before any access check runs.

## Definition of Done Verification

Focused and full client/admin unit/UI tests, package build, admin typecheck and production bundling passed. No new `:id` endpoint, write-field schema, stored text, response contract, lifecycle transition or sensitive logging was added. Root coordinates database tests, full workspace gates, dependency/SAST checks and shared board/index/changelog entries. P5-14 no-deploy template flow, complete audit-count acceptance and real browser verification are not declared complete by this record; no gate is waived.

## What Did Not Work

The first broad run exposed an obsolete `{status: "success"}` fixture envelope; fixing that alone did not solve the failures. A focused rerun proved the actual relative-URL construction defect. The first two broad admin runs were canceled after prolonged output stalls; they are not passing evidence. The final verbose run completed every test without increasing assertion timeouts. Vite reports an existing large single-chunk warning above 500 kB; it is a warning, not a failed build. Moderation and user tests emit existing React `act` warnings while passing.

## Follow-Ups and Open Questions

P5-14 owns remaining end-to-end acceptance and browser verification once the environment metadata issue is fixed. The shared verification backlog retains outstanding global gates. Optional future bundle splitting belongs to a separate measured performance task; no dependency or bundling redesign was introduced here.

## What to Watch

An empty API base is valid only in a browser; server-side callers still need an absolute base and existing package tests use that configuration. The admin bundle warning should be revisited with actual admin navigation performance measurements. Browser-origin resolution intentionally ignores an HTML document's base element and uses the origin, matching same-host API routing.
