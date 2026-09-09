# 08 - API Security

## Input Validation
- Every endpoint validates shape, type, length, and format BEFORE processing (see BACKEND/03-VALIDATION.md) — frontend validation is UX, not a security boundary.
- Whitelist the fields an endpoint may accept (reject unknown fields / strip unrecognized fields) — prevents a mass-assignment vulnerability (e.g., a user sending `role: "admin"` in a profile-update body must be automatically ignored because it isn't in the whitelist).

## Output Encoding / XSS Prevention
- All free-text fields from users (name, quote, guestbook message, RSVP message) are sanitized BEFORE storage (strip/escape dangerous HTML tags, `<script>`, event-handler attributes) — stored XSS is a primary risk since this content is rendered on public pages viewed by many people.
- The frontend STILL applies standard output encoding (React/Vue default escaping) as a second layer — defense in depth, don't rely on only one layer.
- Fields that intentionally support limited formatting (if any, e.g., rich text) use a whitelist-based sanitizer with a very limited allowed tag list (e.g., DOMPurify with a minimal allowlist), not a blacklist.

## SQL Injection
- Parameterized queries/ORM MUST be used — no string concatenation is used to build SQL queries from user input.

## CORS
- Explicit origin whitelist (official application domains); do not use `Access-Control-Allow-Origin: *` for authenticated endpoints.

## CSRF
- For endpoints using cookie-based auth (refresh token), apply CSRF protection (SameSite cookie + CSRF token for state-changing requests if needed) — the access token in the Authorization header (not a cookie) is naturally not vulnerable to CSRF.

## Security Headers
- `Content-Security-Policy` (strict, explicit whitelist for script/style/img/font sources).
- `X-Content-Type-Options: nosniff`.
- `X-Frame-Options: DENY` (except for the public invitation page, which may be intentionally embeddable — evaluate case by case).
- `Strict-Transport-Security` (HSTS).

## Error Handling
- Error responses MUST NOT include a stack trace, SQL query, server file path, or library version — a generic message to the client, full detail only in server logs (see DEVOPS/06-LOGGING.md).

## Mass Data Exposure
- List endpoints (`GET /invitations`, etc.) never accidentally return sensitive fields belonging to another user even if mixed into the query — use an explicit response DTO (whitelisted output fields), not `SELECT *` passed straight through to the response.

## Dependency Security
- Automated dependency scanning (e.g., `npm audit`/`dependabot`) in CI, with regular updates for libraries with known vulnerabilities.
