# P5-10 — Feature Spec: Admin invitation overview completion

| | |
|---|---|
| Task | P5-10 |
| Date | 2026-11-25 |
| Author | Coding agent |
| Status | Implemented; integration/security review pending |

## 1. Goal

Support can search invitations by slug or owner, inspect operational state and histories, and receive explicit loading/error states in the admin UI. Existing partial API is completed without exposing invitation content.

## 2. Specification Sources

API/09 Invitation Overview defines read-only list/detail endpoints; PLAN/12 section 6 forbids content editing; SECURITY/05 Special Case requires an audit row for every ownership bypass; API/00 requires snake_case envelopes; SECURITY/07 prohibits payment status changes from clients. TASKS/PHASE-5 defines operational history, rate limiting and minimization requirements. PLAN/00 and PLAN/16 constrain scope to current Phase 5.

## 3. Business Rules Implemented

No new lifecycle rules. Admin reads deliberately bypass tenant ownership and must be separately named and audited. No content mutation endpoint is added.

## 4. API Contract

GET /api/v1/admin/invitations accepts search_slug, search_user, page and limit; GET /api/v1/admin/invitations/:id optionally accepts a bounded reason for the audit. Success uses API/00 envelope, snake_case properties and operational data only. Errors: 401 unauthenticated, 403 wrong role/unverified admin factor, 400 invalid query or UUID, 404 unknown invitation, 429 rate limited. No write methods.

## 5. Data Model Impact

Read invitations, users, templates, template_versions, orders, invitation_status_history and confirmed MFA factors. Write only audit_logs with actor, resource, time and reason. No migration.

## 6. Authorization

Only authenticated admin/super_admin sessions. Existing challenge/setup JWT audiences are separate from access tokens. No factor-only guard is added: ordinary session/refresh issuance has no verified-MFA session claim and remains a P5-14 security review item. Detail uses InvitationRepository.adminFindInvitationBypassingOwnership; list uses a separately named adminFind path whose selected IDs are audited inside the transaction before any response is returned. Ordinary user denial is role-based 403, independent of resource existence; owner API remains unchanged. Unknown valid UUID returns 404. Nested history queries filter by the selected invitation ID.

## 7. Validation and Sanitization

Zod bounds page/limit, search text and reason. UUID is validated before reaching PostgreSQL. Search strings are parameters, never SQL text. Audit reason is sanitized before storage. Client cannot set status, owner_id, role, content, or timestamps through this read-only surface.

## 8. State Transitions

None. Orders, invitations and payment records are never modified.

## 9. Side Effects

Cross-tenant reads write audit rows. Failure to write audit data fails the read. No queues, notifications or cache mutation.

## 10. Failure Modes

Database or audit failure returns an error; no unaudited data is returned. Existing authenticated rate policy handles Redis failures. UI displays empty/loading/error states and never substitutes demo data.

## 11. Abuse Cases

Unauthenticated and ordinary users cannot enumerate; malformed UUID/query is rejected; rate limit rejects before service invocation; list and detail are audited; unavailable audit storage fails closed; no PATCH/POST/DELETE content route exists; response omits personal content and credentials.

## 12. Test Plan

HTTP controller tests cover guards, queries, UUID, absent write routes and 404. Service tests assert list transaction audits and projections plus operational histories. Component tests cover authenticated list/search/pagination/detail and transport errors. Parent runs full suite and integration gates.

## 13. Observability

Audit rows identify actor and every returned invitation; query metadata excludes private content. Existing rate metrics expose repeated enumeration. Watch audit write volume and query latency.

## 14. Open Questions

No contract decisions needed; MFA claims/session enforcement remains an inspection item before implementation. This spec supplements the incomplete 2026-10-21 API record without rewriting that record.
