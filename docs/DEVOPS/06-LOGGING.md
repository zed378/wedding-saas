# 06 - Logging

## Format
- Structured JSON logs, with standard fields: `timestamp`, `level`, `service`, `request_id`/`trace_id`, `message`, `context` (an additional object as needed).

## Level
- `debug`: development detail (not active in production by default).
- `info`: important normal flow (an incoming request, a completed job, a status transition).
- `warn`: an abnormal but handled condition (a retry, a fallback used).
- `error`: a failure requiring attention (an uncaught exception, a permanently failed job).

## Mandatory Redaction (Aligned with SECURITY/09)
The following fields NEVER appear in raw form in application logs (automatic redaction at the logger middleware level, not relying on manual developer discipline each time):
- Passwords (plaintext or even the hash need not be logged).
- Tokens (access token, refresh token, API key, signature secret).
- Full bank account numbers (`invitation_bank_accounts.account_number`) — if needed for debugging, mask part of it (e.g., `****1234`).
- The full raw payment payload from the provider (redact potentially sensitive fields; store the complete version only in the `payments.raw_callback_payload` table with restricted DB access, not in the application log which may have broader access/a longer retention).
- Full email addresses in high-traffic-level logs (optionally partially masked depending on the need for investigation vs. privacy).

## Request Correlation
- A `request_id` generated at the entry point (the reverse proxy/first middleware), passed along across services & into async jobs (included in the job payload) — enabling end-to-end tracing of a single request flow across different log sources.

## Log Retention
- Application logs: 90 days (enough for short-term debugging & investigation).
- Security event logs (failed logins, detected IDOR attempts, invalid signatures): longer retention (e.g., 1 year) — kept separate from general application logs, for incident investigation purposes (SECURITY/12).
- `audit_logs` (DB table, admin actions): 2-year retention (DATABASE/10).

## Aggregation & Search
- Logs are shipped to a centralized system (e.g., the ELK stack/CloudWatch Logs/Loki) for search & cross-service correlation — not just a local file log per container that's lost on container restart.
