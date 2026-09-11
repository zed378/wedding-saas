# 02 - Trust Boundaries

## Trust Boundary Diagram
```
[Internet - UNTRUSTED]
      │
      │  (boundary 1: TLS termination, WAF/rate-limit at the edge)
      ▼
[Public API surface: /public/*]  — anonymous, UNTRUSTED, all input fully validated/sanitized
      │
      │  (boundary 2: authentication)
      ▼
[Authenticated API surface: /api/v1/*]  — authenticated user, STILL UNTRUSTED for authorization purposes
      │                                     (has an identity, but not necessarily rights over a specific resource)
      │  (boundary 3: object-level authorization per request)
      ▼
[Resource owned by that user]  — only TRUSTED after ownership/role is validated
      │
      │  (boundary 4: admin authorization + audit)
      ▼
[Admin surface: /api/v1/admin/*]  — MORE TRUSTED but still fully audited, mandatory 2FA

[Payment Gateway] ──(boundary 5: signature verification)──► [Webhook handler]
      Data from the provider is UNTRUSTED until the signature is validated.

[Worker/Queue] — internal, TRUSTED as part of the system, but still revalidates data
      (e.g., re-validate a file during processing, don't assume data entering the queue is always clean).
```

## Rules per Boundary
- **Boundary 1→2**: no user-specific data is returned without passing through a public status filter (`published` only) and output sanitization.
- **Boundary 2→3**: having a valid token ONLY proves IDENTITY, not AUTHORIZATION over a specific resource — every handler receiving an `:id` MUST query with an ownership filter (see 05-MULTI-TENANCY-SECURITY.md), never relying on "the user is already logged in, so it's safe."
- **Boundary 3→4 (Admin)**: the admin panel runs on a separate hostname (`admin.vizunicum.my.id`) with a session separate from the user application, reducing cross-app CSRF/XSS risk and making it easier to apply a different CSP policy.
- **Boundary 1 is an origin boundary, not only a code boundary.** The public invitation surface runs on its own hostname (`invitation.vizunicum.my.id`), separate from the application (`app.vizunicum.my.id`). This matters because guest-submitted content — RSVP names, guestbook messages — is rendered on that surface: a stored XSS surviving sanitization there must not be able to act against the authenticated application, and the same-origin policy is what guarantees that. Collapsing these onto one host would remove a defence that costs one DNS record to keep (MEMORY ADR-024).
- **Boundary 5**: the webhook endpoint does NOT have the usual user-auth middleware (no user token), but rather a provider-specific signature verification — this endpoint should be whitelisted separately from general rate-limiting so it isn't blocked during periods of legitimately high traffic from the provider.

## Data Zones
| Zone | Example Data | Who Can Read |
|---|---|---|
| Fully public | Template catalog, `published` invitations (per active sections) | Anyone |
| Owner-private | Draft invitations, orders, original media | Owner + admin (limited moderation/support) |
| Internal | Raw payment payload, audit log, refresh token hash | System + admin with restricted access |
