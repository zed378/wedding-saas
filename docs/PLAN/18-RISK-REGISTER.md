# 18 - Risk Register

| ID | Risk | Category | Impact | Likelihood | Mitigation | Ref |
|---|---|---|---|---|---|---|
| R1 | IDOR/broken object-level auth exposes another user's invitation | Security | Very High | Medium | Mandatory ownership-check middleware on all `:id` endpoints, automated testing in CI | SECURITY/05 |
| R2 | Payment status manipulated via the client | Security | High | Medium | Status only from a signature-validated webhook, never from the client | SECURITY/07 |
| R3 | Traffic spike on the day before/of the event brings the public page down | Availability | High | High | Aggressive caching + CDN, load testing before launch | ARCHITECTURE/06, TESTING/05 |
| R4 | Malicious file upload (malware/decompression bomb) | Security | High | Low-Medium | Multi-layer upload validation, scanning | SECURITY/06 |
| R5 | New template breaks old invitations because a shared component was changed | Product/Eng | Medium | Medium | Strict versioning, new component for breaking changes | PLAN/07 |
| R6 | Sensitive data (bank account, address) leaks via logs/error messages | Security/Privacy | High | Medium | Redaction in logging, review of error handlers | SECURITY/09, DEVOPS/06 |
| R7 | Slug hijacking / squatting of popular names | Abuse | Low | Medium | Word blocklist, rate limiting on new invitation creation | SECURITY/10 |
| R8 | RSVP/Guestbook spam disrupts UX & storage | Abuse | Medium | High | Rate limiting per IP/device, CAPTCHA if needed | SECURITY/10 |
| R9 | Vendor lock-in to a single payment gateway | Business | Medium | Low | Abstract the payment provider in the service layer | BACKEND/02, BACKEND/05 |
| R10 | Data loss due to backup failure | Availability | Very High | Low | Scheduled backups + routine restore testing | ARCHITECTURE/09, DEVOPS/04 |
| R11 | Editor feature scope creep delays the MVP timeline | Project | Medium | High | Strict phased roadmap, Phase 2 features explicitly rejected for MVP | PLAN/00, PLAN/16 |
| R12 | Dependency on a single admin/engineer (bus factor) | Project | Medium | Medium | This complete documentation set + onboarding checklist | Entire docs/ |
| R13 | Single-vendor edge dependency: one provider carries object storage, CDN, DNS, WAF and CAPTCHA, so one outage removes media, cached pages and the abuse challenge together | Availability | High | Low | Storage behind a `StoragePort` so the bucket can be moved by configuration; CDN cache and DNS failover documented in the DR runbook; the invitation page degrades to origin rather than disappearing | MEMORY ADR-011, ARCHITECTURE/05, ARCHITECTURE/09 |
| R15 | Path-based publishing: an application route could shadow a published invitation, taking a live wedding page offline silently | Availability | High | Low | The public invitation host serves only invitations, previews and the proxied public API; every reserved path segment is a row in `slug_blocklist` and CI fails on an unreserved route | MEMORY ADR-024, PLAN/10, SECURITY/10 |
| R14 | Single-host deployment: the MVP runs on one VPS, so a host failure exceeds the 4-hour RTO in the worst case | Availability | Very High | Low-Medium | Accepted deliberately for the MVP budget. Mitigated by CDN-cached invitation pages surviving an origin outage, nightly backups plus WAL archiving to a different provider, and a rehearsed rebuild runbook (P6-12). Re-evaluated before the platform carries weddings it cannot afford to disappoint | MEMORY ADR-015, ARCHITECTURE/09 |

## Review Cadence
The risk register is reviewed at the end of every roadmap phase (16-IMPLEMENTATION-ROADMAP.md), with status & mitigation updated.
