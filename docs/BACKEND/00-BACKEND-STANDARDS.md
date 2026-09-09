# 00 - Backend Standards

## Stack (recommended, agnostic)
- Framework: NestJS (TypeScript) / Laravel (PHP) / Django-DRF (Python) — choose based on the team's expertise; the layering principles (ARCHITECTURE/03) are mandatory regardless of the stack chosen.
- An ORM with a built-in migration tool (Prisma/TypeORM, Eloquent, Django ORM).
- Schema validation: Zod/class-validator, or an equivalent in other stacks.

## API Conventions
- Strictly follow API/00-API-STANDARDS.md (response envelope, status codes, error format).

## Code Conventions
- One file per class/module, consistent naming: `PascalCase` for classes, `camelCase` for functions/variables.
- Business logic ONLY in the Service layer; the Controller stays thin (parsing + delegation + response formatting only).
- No raw SQL string concatenation — always parameterized queries/an ORM (SECURITY/08).

## Logging
- Structured logging (JSON), levels: `debug/info/warn/error`, always include a `request_id`/`trace_id` for cross-log correlation (DEVOPS/06).
- NEVER log: passwords, raw tokens, full bank account numbers, raw payment payloads without redaction (SECURITY/09).

## Error Handling
- A global exception filter/handler converts internal errors into the standard response format (API/00), hiding internal details from the client.

## Testing
- See 09-TESTING.md — a minimum coverage requirement for critical business rules (lifecycle, payment, authorization).

## Dependency Management
- Lockfiles always committed, automated dependency auditing (SECURITY/08).

## Code Review
- Every PR touching a `:id` endpoint MUST go through the SECURITY/05 checklist (object-level authorization) before merging.
