# 00 - Security Requirements

The master security document. This application stores fairly sensitive data (names, photos, addresses, home coordinates, bank account numbers, family information, guest lists, RSVPs) — SECURITY/ must NOT be treated as a generic checklist.

## Core Security Principles
1. **Least privilege** — every component/role has only the minimum access it needs.
2. **Defense in depth** — layered validation (the client is NOT trusted at all; everything is revalidated on the server).
3. **Secure by default** — new features default to the safest setting (e.g., `seo_indexable = false`, `guestbook_moderation` can be enabled by the user).
4. **Fail closed** — if authorization/validation cannot be confirmed, deny access (don't allow it).
5. **The server is the single source of truth** — payment status, pricing, and resource ownership are NEVER decided from client input/parameters.

## Mandatory Scope
| Area | Document |
|---|---|
| Threat modeling | 01-THREAT-MODEL.md |
| System trust boundaries | 02-TRUST-BOUNDARIES.md |
| Authentication security | 03-AUTHENTICATION-SECURITY.md |
| RBAC & object-level authorization | 04-AUTHORIZATION-RBAC.md |
| Multi-tenant isolation (MOST CRITICAL) | 05-MULTI-TENANCY-SECURITY.md |
| File upload security | 06-FILE-UPLOAD-SECURITY.md |
| Payment security | 07-PAYMENT-SECURITY.md |
| General API security | 08-API-SECURITY.md |
| Privacy & data protection | 09-PRIVACY-DATA-PROTECTION.md |
| Abuse/spam prevention | 10-ABUSE-PREVENTION.md |
| Security testing | 11-SECURITY-TESTING.md |
| Incident response | 12-INCIDENT-RESPONSE.md |

## Data Classification
| Level | Example | Treatment |
|---|---|---|
| Critical | password hash, refresh token, bank account number, payment payload | Encryption at rest considered, extremely restricted access, never logged |
| Sensitive | name, address, coordinates, personal photos, RSVP | Restricted to owner+admin (moderation) access, not publicly indexed by default |
| Consciously-public | data the user INTENTIONALLY publishes in the invitation | Displayed per the user's toggle, still subject to rate-limiting & abuse prevention |
| Non-sensitive | template metadata, catalog | Freely publicly accessible |

## Compliance
- Indonesian PDP Law (Personal Data Protection) — see 09-PRIVACY-DATA-PROTECTION.md.
- PCI-DSS scope minimization — the system NEVER stores raw credit card data; all card processing is fully delegated to a certified payment gateway (see 07-PAYMENT-SECURITY.md).
