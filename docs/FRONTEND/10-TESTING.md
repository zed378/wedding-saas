# 10 - Frontend Testing

## Testing Pyramid
```
        E2E (few, critical flows)
      Integration (component + interaction)
   Unit (many, pure logic & small components)
```

## Unit Test
- Utility functions (the dot-notation field resolver, form validators, date/time formatter).
- Small isolated components (Button, Badge, FieldInput) — snapshot + interaction tests.
- Tools: Jest/Vitest + React Testing Library.

## Integration Test
- Editor Form: fill in a field → verify the store state updates → verify the Live Preview reflects the change (without mocking real network calls, use MSW to mock the API).
- TemplateRenderer: render with dummy data across various `enabled_sections` combinations → verify inactive sections don't appear in the DOM.

## E2E Test (Playwright/Cypress)
Critical flows that MUST be covered:
1. Register → log in → create an invitation → fill in minimal data → publish (with a payment gateway sandbox/mock).
2. Change template → verify data isn't lost, unsupported sections are hidden.
3. Submit RSVP & guestbook on the public page → verify it appears on the owner's dashboard (guestbook with moderation: verify it doesn't appear publicly before approval).
4. Log in as a different user → verify they CANNOT access the first user's invitation (a UI-side IDOR test, complementing the backend security test in SECURITY/11).

## Visual Regression (optional but recommended)
- A visual snapshot for TemplateRenderer components per section (catching unintended changes when refactoring a shared component, given it's used across many templates).

## CI Integration
- Unit + integration tests must pass on every PR.
- Critical E2E flows are run on staging before deploying to production (part of DEVOPS/01-CI-CD.md).

## Accessibility Testing
- axe-core integrated into the test suite for key pages (see UI-UX/17-ACCESSIBILITY.md).
