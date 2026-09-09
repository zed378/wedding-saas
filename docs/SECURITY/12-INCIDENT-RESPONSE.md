# 12 - Incident Response

## Severity Classification
| Level | Example | Initial Response Target |
|---|---|---|
| P0 - Critical | Mass cross-tenant data leak, active payment fraud, compromised admin account | < 30 minutes |
| P1 - High | Confirmed single-tenant data leak, RCE vulnerability found | < 2 hours |
| P2 - Medium | A vulnerability found with no evidence of exploitation yet, partial downtime | < 8 hours |
| P3 - Low | Minor vulnerability, no direct impact | < 3 days |

## Response Flow
1. **Detection** — from monitoring/alerting (DEVOPS/07), a user report, or security testing.
2. **Triage** — determine severity, activate the response team per the level.
3. **Containment** — immediate steps to limit impact, for example:
   - Cross-tenant data leak: disable the affected endpoint temporarily (feature flag/kill-switch) while a hotfix is prepared.
   - Payment fraud: pause automated webhook processing, manually review suspicious transactions.
   - Compromised admin account: revoke all sessions & refresh tokens for that account, force a password reset + re-2FA.
4. **Eradication** — fix the root cause (deploy a fix, patch the dependency, etc.).
5. **Recovery** — restore normal service, verify the fix is effective (targeted regression test for the vulnerability).
6. **Notification** — if the incident involves personal data (per the PDP Law), evaluate the obligation to notify affected users & relevant authorities within the applicable time frame.
7. **Post-mortem (Blameless)** — within 5 working days after a P0/P1 incident is resolved: document the timeline, root cause, impact, short- and long-term corrective actions, update the risk register (PLAN/18) if relevant.

## Contacts & Escalation
- Every production deployment has an on-call contact list (defined in a separate operational runbook, outside the scope of this product document) — this document defines the PROCESS, not the specific contact list.

## Evidence Preservation
- Upon detecting an incident, related logs & data (audit_logs, raw payment payload, access log) are secured (snapshotted/copied) before remediation actions that could potentially destroy evidence, for investigation & forensic purposes.

## Drills (Tabletop Exercise)
- An incident simulation (e.g., a "IDOR leak found by an external researcher" scenario) is recommended at least once before launch to test the readiness of this process, not just as documentation on paper.
