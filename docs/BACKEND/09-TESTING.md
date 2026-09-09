# 09 - Backend Testing

## Testing Pyramid
```
        E2E API (few, critical cross-module flows)
      Integration (service + a real DB/testcontainer)
   Unit (many, pure business logic, mocked dependencies)
```

## Unit Test — Mandatory for Critical Business Rules
- `InvitationService.publish()` — scenarios: complete fields (success), missing fields (422 with the correct list), a taken slug (409), a status other than `paid` (422).
- `PaymentWebhookHandler` — scenarios: a valid signature & success (correct state change), an invalid signature (rejected, state does NOT change), a duplicate webhook/idempotency (state changes only once), a payment for an order that doesn't exist.
- `AuthorizationMiddleware`/`requireOwnership` — scenarios: owner access succeeds, non-owner is denied (404), admin bypass with the audit log recorded correctly.
- Order price calculation (`amount_total`) — various package + addon combinations produce the correct number, unaffected by a fake price sent in the request (an explicit test sends a spoofed price in the request → verifies it's ignored).
- Slug validation — valid/invalid formats, the forbidden-word blocklist, uniqueness check.
- The `required_fields` dot-notation field resolver — various invitation data structures.

## Integration Test
- The repository layer with a real database (a Postgres testcontainer) — verifying constraints (FK, unique index) actually work as designed in DATABASE/.
- The full request-response cycle per endpoint (Controller→Service→Repository→DB) using an HTTP test client, including an assertion of the response envelope per API/00-API-STANDARDS.md.

## Security-Focused Tests (mandatory, part of the Definition of Done)
- **Automated IDOR sweep**: for every new `:id` endpoint, a test case "User B requests User A's resource → expect 404" — see SECURITY/04 & SECURITY/05.
- **Mass assignment**: send a forbidden field (`role`, `status`) in the request body → verify it's ignored, doesn't change the data.
- **File upload**: test with a spoofed file signature (a `.jpg` extension but bytes that aren't actually an image) → verify it's rejected (SECURITY/06).

## E2E API Test (Cross-Module Flows)
1. Register → verify email → create an invitation → fill in data → create an order → simulate a payment webhook success (a mocked valid signature) → publish → verify the public endpoint returns the correct data.
2. Refund flow: an admin refunds a `paid` order → verify the invitation reverts to `draft` (BR-5.4), a published invitation stops being publicly reachable including from cache, and the status history plus audit rows both exist.

## Coverage Target
- Service layer (business logic): a minimum of 80% line coverage, prioritizing 100% for functions handling state transitions (lifecycle, payment).
- CI gate: a PR cannot merge if a test fails or coverage of a business-critical module drops significantly from the baseline.
