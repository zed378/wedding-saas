# 11 - Security Testing

## Test Types & Cadence
| Type | Cadence | Scope |
|---|---|---|
| SAST (static analysis) | Every PR (CI) | Entire backend/frontend codebase |
| Dependency scanning | Every PR + weekly | All dependencies |
| DAST (automated dynamic scan) | Every deploy to staging | API surface |
| Manual penetration testing | Before MVP launch + quarterly thereafter | Focused on IDOR, auth, upload, payment |
| Multi-tenancy isolation testing | Every new feature touching `:id` resources (part of CI) + a full sweep pre-launch | All `:id` endpoints |

## Mandatory Pre-Launch Scenarios (Checklist)
- [ ] IDOR sweep: for every endpoint accepting a resource ID, attempt access with a different user account — verify a consistent **404** with no resource data in the body (API/00 § 403 vs 404). A 403 anywhere in this sweep is a finding, because it confirms the resource exists.
- [ ] Payment tampering: modify redirect query parameters, request body payment status — verify server state does not change.
- [ ] File upload: upload a file with a spoofed extension (e.g., `.php` renamed to `.jpg`), an oversized file, a file with extreme dimensions, a file with GPS EXIF data — verify all mitigations in SECURITY/06 work.
- [ ] XSS: submit a script payload in every free-text field (name, quote, guestbook, RSVP message) — verify it doesn't execute when rendered on the public page.
- [ ] SQL Injection: fuzz query/filter parameters on list & search endpoints.
- [ ] Auth: brute-force login (verify rate limiting is active), expired token handling, refresh token reuse detection.
- [ ] Privilege escalation: a regular user attempting an admin endpoint and trying to inject forbidden fields (`role`/`status`) into the request body.
- [ ] Payment webhook: send a webhook payload with an invalid signature — verify it is rejected & state does not change.
- [ ] Rate limiting: verify limits are active per category as specified in SECURITY/10, for all endpoints.
- [ ] Enumeration: verify IDs (invitation, media, order) are not sequential/predictable.

## Supporting Tools (examples, freely chosen by the team)
- SAST: Semgrep/SonarQube.
- Dependency: `npm audit`/Snyk/Dependabot.
- DAST: OWASP ZAP.
- Manual: Burp Suite for manual exploration of critical endpoints.

## Pass Criteria
- 0 **critical/high** severity findings in the multi-tenancy & payment categories before release (a release blocker, per PLAN/17-ACCEPTANCE-CRITERIA.md).
- Medium/low findings are documented with a remediation plan & timeline, and can be released with the risk accepted by the Product Owner + Security reviewer.

## Result Documentation
- Every testing session produces a report (findings, severity, remediation status), stored as part of the release record.
