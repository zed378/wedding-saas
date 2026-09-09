# 03 - Backend Architecture

## Stack Approach (language-agnostic — choose based on the team's expertise; the following principles are mandatory)
- A conventional REST framework (e.g., NestJS/Express, Laravel, or FastAPI/Django) with middleware support, DI/service layer, and an ORM with migrations.
- Stateless: no session state stored in the process's memory (use Redis/DB-backed sessions or JWT).

## Layered Architecture (per module, see 01-APPLICATION-ARCHITECTURE.md § Layering)
```
Route/Controller  → request parsing, input validation (schema), auth guard
   ↓
Service            → business logic, orchestration across repositories, business rules (PLAN/02)
   ↓
Repository          → DB queries, no business logic here
   ↓
Database
```

## Authentication & Sessions
- Access token (short-lived JWT) + refresh token (HTTP-only cookie, rotation) — details in API/01-AUTHENTICATION.md & SECURITY/03.
- All authenticated endpoints go through middleware that validates the token & injects `current_user` into the request context.

## Validation
- Schema validation (shape, type) at the controller layer using a schema library (e.g., Zod/Joi/class-validator) — see BACKEND/03-VALIDATION.md.
- Business validation (e.g., "required field for publish") at the service layer, since it depends on other state (the active template).

## Idempotency
- Endpoints that may be invoked repeatedly (e.g., payment webhooks) MUST be idempotent — use `provider_reference_id` as a unique constraint to prevent duplicate effects (see BACKEND/05-PAYMENT-FLOW.md).

## Database Transactions
- Operations that modify >1 related table (e.g., successful payment → update Payment + Order + Invitation status) MUST be wrapped in a single DB transaction.

## Rate Limiting
- Applied at the middleware/gateway level for public endpoints (RSVP, guestbook submit, login) — see SECURITY/10-ABUSE-PREVENTION.md.

## Background Jobs
- All non-critical-path operations (email, image processing, expiry checks) run on separate workers via a queue — see 07-QUEUE-WORKER-ARCHITECTURE.md and BACKEND/08-JOBS-WORKERS.md.

## Testing
- Every service must have unit tests for critical business rules (lifecycle, payment, authorization) — see BACKEND/09-TESTING.md.
