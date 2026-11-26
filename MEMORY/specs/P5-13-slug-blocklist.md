# P5-13 — Slug Blocklist Management

Date: 2026-11-25. Status: reviewed before implementation. Owner approved the API extension in conversation.

## Goal and specification sources
Manage the existing slug_blocklist table without deploying. DATABASE/12 controls schema and exact/substring semantics; SECURITY/10 requires folded profanity matching and route collision checks; PLAN/10 and PLAN/18 R7/R15 control publishing safety. SECURITY/05 and SECURITY/07 remain mandatory. No payment or lifecycle writes.

## API contract
Authenticated admin/super_admin only. `/api/v1/admin/slug-blocklist`: GET paginated entries; POST creates with term, match_type, category, reason. PATCH /:id takes a complete definition; DELETE /:id requires reason. POST /test accepts slug. Writes use strict whitelists and API/00 snake_case envelopes. Create/update return entry, existing_matches (operational id/slug/status, maximum 100), existing_match_count. Errors: invalid input 400, unauthenticated 401, wrong role 403, missing id 404, duplicate/protected route removal 409. Document in API/09 with ADR.

## Data and authorization
Existing slug_blocklist CRUD, audit_logs append, invitation operational match read through a separately named audited admin repository method. No schema migration. No admin content mutation. Cross-tenant reads include actor and purpose in audit. A normal user cannot access configuration IDs. Existing session MFA boundary must be verified.

## Validation and business rules
Term lowercased, 1–60 slug-alphabet characters. Exact comparison matches whole strings; substring comparison folds basic leetspeak through existing foldLeet. Reason 5–500 characters, sanitized before storage and audit. UUID IDs. Reject unknown fields, status/actor overrides. New terms never modify existing invitations. Required public route reservations cannot be removed or changed away from exact matching.

## Transactions and side effects
Mutation and before/after audit share a transaction; audit failure aborts mutation. Invalidate Redis cache after commit. Cached blocklist must not approve a newly blocked slug after failed invalidation: authoritative DB validation confirms cached misses. Redis failure falls back to DB; DB failure fails closed. No invitation state transition, payment action, job or notification.

## Test and abuse plan
Unit matching tests include exact false positives and leetspeak padding. HTTP tests cover auth/role, UUIDs, envelope, mass assignment and errors. Database integration covers atomic audit, CRUD, existing-match counts and unchanged invitations. UI tests cover API-backed CRUD and candidate checking. A route-gate test fails when public static root routes lack exact seeded reservations. Test Redis fallback and mutation invalidation.

## Observability and open questions
Audit actor, reason, resource and safe before/after; no secrets or personal invitation content. Monitor validation/cache failures. No blocking question after API approval. CI/SAST gaps remain P0-17; evidence must distinguish real-DB tests from stubbed HTTP tests.
