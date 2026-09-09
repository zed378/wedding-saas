# 01 - Unit Testing

## Scope
Pure functions & isolated logic units (all external dependencies mocked: DB, network, filesystem).

## Backend — Unit Test Priorities (see detail in BACKEND/09-TESTING.md)
- The business rule state machine (PLAN/06-INVITATION-LIFECYCLE.md) — every valid/invalid transition.
- Order price calculation (must never be influenced by client input).
- Field validators (a Zod schema/equivalent) — valid & invalid cases per field type.
- Payment webhook signature verification — a valid vs. a spoofed signature.
- Slug validator — format, blocklist.
- The `required_fields` dot-notation field resolver.

## Frontend — Unit Test Priorities (see detail in FRONTEND/10-TESTING.md)
- Utility formatters (date, currency, relative time "2 minutes ago").
- Editor store reducer/logic (state transitions when a field changes).
- Small isolated components (Button, Badge, FieldInput) with various props/states.

## Writing Principles
- Descriptive test names: `describe('InvitationService.publish')` → `it('rejects publishing if a required field is empty')`.
- A consistent Arrange-Act-Assert pattern.
- Explicit dependency mocking (no hidden network/DB calls in a unit test — if that happens, it's actually an integration test, move it to that category).

## Coverage
- Target: 80% line coverage for the backend service/logic layer, evaluated per PR (should not drop from the baseline without justification).
- High coverage isn't the end goal — prioritize tests that verify a BUSINESS RULE (PLAN/02) is correct, not just chasing a number.
