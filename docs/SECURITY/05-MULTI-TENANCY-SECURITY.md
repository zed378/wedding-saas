# 05 - Multi-Tenancy Security (CRITICAL)

This document is the product's #1 security priority. Tenancy model: **logical, not physical** — all users share the same database; isolation is guaranteed entirely by application logic. Failure in this area = a leak of personal data (address, photos, bank account) for thousands of users at once.

## Isolation Principle
```
User A                         User A
  ↓                              ↓ (X - MUST BE DENIED)
Invitation A                  Invitation B (owned by User C)
  ↓                              
Media A
```

## Attack Surfaces That MUST Be Tested
1. **IDOR (Insecure Direct Object Reference)** — changing the `:id` in a URL/body to access another user's resource.
2. **Broken Object-Level Authorization (BOLA)** — an endpoint returning data without checking ownership.
3. **Privilege Escalation** — a regular user manipulating the payload to gain admin-level effects (e.g., sending `role: "admin"` in a profile update body — MUST be ignored by the server, whitelist the fields allowed to be updated).
4. **Enumeration** — trying sequential/predictable IDs to discover existing resources (mitigation: non-sequential UUIDs for every entity whose ID can be exposed).
5. **Insecure API Filtering** — a list endpoint (`GET /invitations`) without an implicit `owner_id` filter in the DB query, relying instead on filtering in the response only (client-side filtering) — WRONG, filtering MUST be at the DB query level.
6. **Cross-tenant via sub-resources** — e.g., `POST /invitations/:id/gallery` with an `:id` owned by another user, or a `media_id` belonging to a different invitation attached to one's own invitation (must validate that `media.invitation_id` matches before the operation).
7. **Cross-tenant via indirect references** — e.g., the `bank_id` in the `PATCH /invitations/:id/bank-accounts/:bank_id` endpoint must have its relation validated: `bank_account.invitation_id === :id` AND `invitation.owner_id === current_user.id` — two steps, not just one.

## Mandatory Checklist per Endpoint (Definition of Done)
- [ ] The endpoint filters the query based on `owner_id`/`invitation_id` at the DB query level, not after fetching.
- [ ] All nested (sub-resource) IDs have their relationship validated against a parent resource already confirmed to belong to the user.
- [ ] Fields the user should never be able to change (`role`, payment `status`, `owner_id`) are explicitly whitelisted at the validation layer — not blacklisted.
- [ ] The error response doesn't distinguish "doesn't exist" from "isn't yours" (consistent 404, see SECURITY/04).
- [ ] Automated test: the "User B accesses User A's resource" scenario for EVERY new `:id` endpoint.

## Periodic Testing
- IDOR testing is performed with every new feature release that touches `:id` resources (part of the code review checklist & CI test), NOT just once during pre-launch security testing (see SECURITY/11, TESTING/04).
- A full penetration test before the MVP launch must explicitly cover this scenario as its own category (not mixed in with general testing), ref PLAN/17-ACCEPTANCE-CRITERIA.md.

## Special Case: Admin Access
- The admin query for support purposes (API/09-ADMIN-API.md § Invitation Overview) uses a deliberately separate code path that intentionally bypasses the `owner_id` filter — EVERY use of this path MUST be logged in the audit log (which admin, which invitation, when) because this is a deliberate tenant-isolation bypass and must be auditable.

## Tolerance
Per PLAN/00-PROJECT-OVERVIEW.md § Success Metrics: **zero tolerance** for cross-tenant IDOR/data leak incidents in production. Findings in this category during security testing = a release blocker, and cannot be waived.
