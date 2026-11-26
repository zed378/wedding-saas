# P5-14 — Admin UI verification and development proxy

| | |
|---|---|
| Date | 2026-11-26 |
| Task / phase | P5-14, Phase 5 acceptance continuation |
| Surface / author | Admin / parallel coding agent |
| Commits / PR | Existing shared uncommitted work preserved; no commit or deployment |
| Status | Local development correction and targeted verification completed; phase acceptance remains incomplete |

## What Changed

Vite now forwards `/api` to the established local API at `http://localhost:3000`. Login, MFA, user management, orders, moderation and blocklist use relative API paths; without a proxy their requests reached Vite instead of the backend when using the documented development port. The admin README now documents both local ports.

Three old component assertions assumed template data existed synchronously in production. The shell navigation test and two template workflow tests now supply API fixtures and wait for the asynchronously loaded catalog, preserving the production loading/error behavior and the affected-invitation assertions.

## Why and How

The owner requested parallel continuation. P5-10–13 remain REVIEW and P5-14 requires functional authenticated administration. PLAN/10 specifies the admin host proxies its API; the development proxy mirrors that existing routing contract. Existing pages already identify port 3000 as the local API. No runtime dependency or production hosting change was introduced.

Required task cards, memory index and relevant prior transport/auth records, PLAN/00 and 16, API/09, PLAN/12 and 14, SECURITY/04, 05, 07 and 10, DATABASE/10, SECURITY/12, PLAN/10 and 18, PLAN/17 and TESTING/03 were read. Graph tools were unavailable; localized source searches/reads were used.

## Files and Components Touched

| Path | Change |
|---|---|
| `admin/vite.config.ts` | Development-only `/api` proxy |
| `admin/README.md` | Local backend/frontend routing instructions |
| `admin/src/App.spec.tsx` | API fixture, async catalog assertion and mock cleanup |
| `admin/src/pages/templates.spec.tsx` | Explicit template response fixture and async workflow assertions |
| This record | Results and remaining limits |

## Decisions and Deviations

No architecture or business-rule decision and no docs deviation. The proxy reuses the backend origin already present in admin source. Historical records are unchanged. Parent coordinates shared indexes, boards and changelog.

## Tests Added and Run

No new test file: existing workflow tests were corrected to exercise the asynchronous API-backed page. Full admin execution (`vitest run --maxWorkers=1 --reporter=verbose`) ran all 15 files / 82 cases: 79 passed and the three synchronous template assertions failed. After correcting only those fixtures/waits, both affected files passed all 12 cases. This is a complete initial suite plus successful affected-file rerun, not a claim that a second full suite ran.

Admin `tsc --noEmit -p admin/tsconfig.json` passed before and after changes. Prettier formatted the changed TypeScript files. Production `vite build` passed: 183 modules, 868.52 kB JS (205.82 kB gzip), with the existing chunk-size warning. No browser, PostgreSQL, provider or E2E test was performed by this lane; parent owns those results. The development proxy configuration was typechecked and built but was not exercised against a running backend in this lane.

## Security Verification and Abuse Cases

No backend authorization, stored input, payment decision, upload or state-transition code changed. Existing UI cases passed in the complete run: `does not invent an MFA ticket after network failure`, `does not invent an MFA ticket after credentials failure`, `cannot mint an administrative session when verification has no ticket`, and `does not show fabricated secrets or enable enrollment when setup fails` in `auth-fail-closed.spec.tsx`. Its `reads the real auth/me nested user envelope on the same origin` also passed.

`requires fresh MFA before sending authenticated suspension with its audit reason` and `keeps suspension uncommitted and displays an API rejection after verified MFA` passed in `users.spec.tsx`. `exchanges the factor for a token before refund with X-MFA-Step-Up and reason only` and `does not submit refund when factor verification fails` passed in `orders.spec.tsx`. These establish UI boundaries only; database ownership/audit atomicity and payment webhook controls remain independently tested by the API lanes.

`shows changed, added and removed fields while escaping stored HTML` passed in audit viewer tests; `shows operational histories and exposes no edit action` passed in invitation tests. No new resource endpoint or storage write exists, so new IDOR, sanitization, mass-assignment and upload-spoofing tests are not applicable to this change.

## Definition of Done Verification

Appropriate component checks, full initial regression execution, corrected-file rerun, types and bundling completed. Existing template deprecation/preview assertions remain intact. Global workspace checks, integration evidence, shared boards/index updates and actual browser acceptance belong to the parent. P5-14 is not declared DONE, no criterion is waived, no Phase 6 work started.

## What Did Not Work

The full suite exposed stale tests that depended on removed fabricated production data, rather than a production catalog regression. Supplying a real-shaped API fixture and waiting for the catalog fixed them without restoring demo fallback behavior. The full run took 495.52 seconds, primarily jsdom startup; affected-file rerun took 107.98 seconds. Test timeout limits were not raised.

## Follow-Ups and What to Watch

Parent owns browser/no-deploy moderation/template acceptance and complete global results. The local API must listen on port 3000 for the new proxy; connection failures remain visible if it is stopped. Cookies with Secure enabled require HTTPS, so this development HTTP proxy does not certify production cookie scope or login behavior. Bundle size warning remains a future measured performance concern.
# Final coordinated verification

After the fixture corrections, parent reran the entire admin suite with threads/maxWorkers=1: 15 files / 82 tests passed in 375.88 seconds. Workspace production build passed; browser bootstrap still failed before interaction, so no visual or browser acceptance is claimed.
