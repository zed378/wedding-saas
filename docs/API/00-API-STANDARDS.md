# 00 - API Standards

## Base URL & Versioning
- `https://app.zedth.my.id/api/v1/...` for the authenticated/internal API.
- `https://invitation.zedth.my.id/public/...` for the public API (no auth: get a public invitation, submit RSVP/guestbook). It is proxied to the same backend, but served from the public invitation host so a guest's submission is same-origin with the page they are reading (PLAN/10, SECURITY/02).
- Version in the path (`/v1/`) — breaking changes require a new version (`/v2/`), the old version is kept for at least 6 months.

## Format
- Request & response: JSON, `Content-Type: application/json` (except file uploads: `multipart/form-data`).
- Field naming: `snake_case`.
- Date/time: ISO 8601 UTC (`2026-06-20T10:00:00Z`); the frontend is responsible for converting to the display timezone.

## Response Envelope
Success:
```json
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "per_page": 20, "total": 57 }
}
```
Error:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "A user-friendly message",
    "details": [ { "field": "email", "message": "Invalid email" } ]
  }
}
```

## HTTP Status Codes
| Code | Usage |
|---|---|
| 200 | Successful GET/PATCH/DELETE |
| 201 | Successful create (POST) |
| 400 | Validation error |
| 401 | Not authenticated |
| 403 | Authenticated, but not permitted to perform this **kind** of action: a `user` calling an `/admin/*` endpoint, or an action gated on `email_verified` (`EMAIL_NOT_VERIFIED`). Never used for another user's resource — see 404 |
| 404 | Resource not found, **and** the response for a resource that exists but does not belong to the current user |
| 409 | Conflict (e.g., slug already taken) |
| 422 | Business rule violation (e.g., publishing without complete data) |
| 429 | Rate limit exceeded |
| 500 | Server error (generic message to the client, detail in server logs) |

### 403 vs 404 — the rule, and why

A request for a resource that exists but belongs to someone else returns **404**, never 403.

403 would confirm the resource exists, which turns any `:id` endpoint into an oracle for enumerating other users' invitations, media and orders. The distinction is invisible to a legitimate user (who never sees either) and valuable only to an attacker, so it is removed: the query filters by owner, and a row that does not come back is indistinguishable from a row that was never there (SECURITY/04 § Example Pseudocode, SECURITY/05 § Mandatory Checklist).

403 remains correct where the resource identity is not the question — a role the caller does not have, or an unverified email blocking checkout. Those responses reveal nothing about anyone else's data.

## Pagination
- Cursor- or offset-based (`page`, `per_page`, default 20, max 100) — consistent across all list endpoints.

## Idempotency
- Sensitive POST endpoints (create order) support an optional `Idempotency-Key` header to prevent duplication from client retries.

## Rate Limiting
- Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. Policy details in SECURITY/10-ABUSE-PREVENTION.md.

## Error Messages
- Error responses MUST NOT leak internal details (stack trace, SQL query, server path) — see SECURITY/08-API-SECURITY.md.

## Authentication
- `Authorization: Bearer <access_token>` header for authenticated endpoints. Details in 01-AUTHENTICATION.md.
