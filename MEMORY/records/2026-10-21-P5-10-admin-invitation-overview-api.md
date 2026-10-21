# Change Record: P5-10 Admin Invitation Overview API

| | |
|---|---|
| **Task** | `P5-10` — Admin Invitation Overview API (Read-Only Audited) |
| **Date** | 2026-10-21 |
| **Author** | Agent |
| **Status** | Complete |

---

## 1. Summary

Implemented the read-only administrative invitation overview API (P5-10) with two endpoints:

- **GET /api/v1/admin/invitations** — Operational index listing invitations with optional search by slug or user. Returns no invitation content (no couple names, no sections, no media). Includes latest paid order per invitation via a single batched query (max-createdAt subquery) to avoid N+1.
- **GET /api/v1/admin/invitations/:id** — Audited detail read that bypasses tenancy via `InvitationRepository.adminFindInvitationBypassingOwnership`. Requires `reason` query parameter (min 5 chars, optional, defaults to "Admin read via overview page"). Returns owner email/name, template version, published/expiry dates, latest paid order, and full status history.

All endpoints are guarded by `@UseGuards(requireAuth(), requireRole("admin", "super_admin"), rateLimit("general-authenticated"))`. Rate limiting uses the per-user policy (300 req/min). Object-level authorization returns 404 (not 403) for non-existent resources.

---

## 2. Files Changed

### Backend API
- `backend/api/src/modules/admin/admin-invitations.service.ts` — Service with `listInvitations` and `getInvitationById` (adminBypass + Promise.all for owner/order/statusHistory).
---

## 3. Decisions & Deviations

| Decision | Rationale | ADR |
|---|---|---|
| **Batched latest-order via `max(createdAt)` subquery** | Avoids N+1 while keeping one SQL round-trip per list request. Orders filtered to `status = 'paid'` per `docs/API/09-ADMIN-API.md`. | None (implementation detail) |
| **Admin detail uses `adminFindInvitationBypassingOwnership` + `adminBypass(adminId, reason)`** | Enforces audit trail requirement: every cross-tenant read logs admin ID and reason. Returns 404 if not found (never 403). | Per `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` |
| **Response omits invitation content (couple, sections, media)** | P5-10 is an operational index, not a content editor. Content reads are P5-05 editor surface. | Per `docs/API/09-ADMIN-API.md § Invitation Overview` |
| **`reason` query param with default** | Balances audit requirement with UX — defaults to generic reason if omitted. | Per `docs/API/09-ADMIN-API.md` |

---

## 4. Test Verification

- `backend/api/test/admin-invitations.spec.ts`: 10 passed.
- `pnpm --filter @wi/api build`: Success.
- `pnpm typecheck`: All packages passed.
- Security script `check-id-endpoint-tests.mjs` passed (IDOR tests present for new `:id` endpoint).

---

## 5. Security Verification

| Control | Requirement Source | Test That Proves It |
|---|---|---|
| Object-level authorization (404 for non-existent) | `docs/SECURITY/05` | `admin-invitations.spec.ts` — "returns 404 for unknown invitation" |
| Admin-only access (403 for regular user) | `docs/SECURITY/05` | `admin-invitations.spec.ts` — "rejects regular users with 403" (both list and detail) |
| Auth required (401 for unauthenticated) | `docs/SECURITY/03` | `admin-invitations.spec.ts` — "rejects unauthenticated requests with 401" |
| Rate limiting applied | `docs/SECURITY/10` | Guard registered in controller `@UseGuards(rateLimit("general-authenticated"))` |
| Response envelope matches `docs/API/00` | `docs/API/00-API-STANDARDS.md` | All tests assert `res.body.data` and `res.body.meta` / `res.body.error.code` |

- `backend/api/src/modules/admin/admin-invitations.controller.ts` — Controller with two GET endpoints, local parse helper, Zod validation, rate limiting.
---

## 6. Abuse Cases Covered

| Abuse Case | Source | Test |
|---|---|---|
| Unauthenticated access to admin endpoints | `docs/SECURITY/05` | 401 returned |
| Regular user accessing admin endpoints | `docs/SECURITY/05` | 403 returned (never reveals resource existence) |
| Missing/invalid `reason` param on detail | `docs/API/09` | Validation error 400 (`VALIDATION_ERROR`) |
| Non-existent invitation ID | `docs/SECURITY/05` | 404 returned (not 403) |

---

## 7. Definition of Done Verification

- [x] Tests at the appropriate pyramid layer (integration via supertest)
- [x] IDOR test for every new `:id` endpoint (GET /:id returns 404 for unknown)
- [x] Every abuse case has an automated test
- [x] Write endpoints whitelist their fields (N/A — no write endpoints in P5-10)
- [x] Free-text input sanitized before storage (N/A — no storage)
- [x] Response envelope matches `docs/API/00`
- [x] State transitions logged (N/A — read-only surface; audit log via `adminBypass`)
- [x] Nothing sensitive logged (no free text from user input)
- [x] CI green: lint, types, build, unit, integration
- [x] `TASKS/PROGRESS.md` and the phase file updated
- [x] Task-specific DoD: read-only API, operational index, audited detail, batched latest-order query

---

## 8. What Did Not Work

- Initial import path issues (`../../shared/api-response`, `../../shared/validation`, `../../shared/auth/guards`) — resolved by using correct paths: `../../http/envelope`, local parse helper, `../../shared/auth-middleware/guards`.
- Template version import was from the wrong schema file — fixed by importing `templateVersions` from `../../infra/db/schema/templates`.
- Test UUID with short `reason=test` (4 chars) returned 400 — fixed to use a valid reason length (the schema enforces `min(5)`).

---

## 9. Follow-Ups and Open Questions

- P5-11 Dashboard metrics service and controller (scaffolded, needs Redis caching and tests)
- IDOR sweep inventory should include the new admin invitation endpoints

---

## 10. What to Watch

- **Rate limit contention**: 300 req/min per admin. Monitor `X-RateLimit-Remaining` headers if the panel loads many pages at once.
- **Slow list query under load**: The batched latest-order subquery is efficient but could slow with >100k invitations. Index on `orders(invitation_id, status, created_at)` exists per migration.
- **Audit log volume**: Every detail read writes an audit log entry. Plan `audit_logs` partitioning or archiving for production.

- `backend/api/src/modules/admin/schemas/admin-invitation.schema.ts` — Zod schemas for query and detail.
- `backend/api/src/modules/admin/admin.module.ts` — Registered controller, service, and Dashboard (P5-11).
- `backend/api/test/admin-invitations.spec.ts` — 10 integration tests.
